"""
Unified Health & RUL Service Module
Pipeline per request:
  Raw payload -> DataQualityGuard -> golden-twin residual features (per-UAV rolling window)
  -> Mahalanobis anomaly detector + XGBoost classifier/severity -> XGBoost RUL quantiles
  -> TreeSHAP attributions -> maintenance advisory -> response

State (rolling window, golden twin, fault onset) is kept per `uav_id`, so vehicles and
clients never share history. Any `health_index` field in the payload is ignored.
"""

import json
import time
from collections import OrderedDict
from pathlib import Path
from typing import Dict, Any, List, Optional

from ..config.config import MODEL_DIR, MODEL_CARD_FILE, BASE_TBO_HOURS, MEL_THRESHOLD_SCORE, SENSOR_FAULT_CLASSES
from ..inference.decision import UNCLASSIFIED
from ..preprocessing.validation import DataQualityGuard
from ..preprocessing.feature_engineering import FeatureExtractor, FEATURE_NAMES
from ..inference.health_predictor import HealthPredictor
from ..inference.rul_predictor import RulPredictor
from ..services.maintenance_advisor import MaintenanceAdvisorEngine
from ..schemas.health_rul_schema import (
    UnifiedHealthRulResponse,
    XaiFeatureAttribution,
    PilotAdvisoryOutput,
    DataQualitySummary,
    ModelMetadata,
)

MAX_SESSIONS = 64


class _Session:
    """Per-UAV inference state."""

    def __init__(self):
        self.guard = DataQualityGuard()
        self.fx = FeatureExtractor()
        self.last_t: Optional[float] = None
        self.fault_onset_t: Optional[float] = None
        self.prev_raw_anomaly = False
        self.prev_raw_diagnosis = "NONE"
        self.last_known_fault = "NONE"
        self.samples_since_known = 10 ** 6
        self.clock = 0.0


class HealthRulService:
    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir) if model_dir else MODEL_DIR
        self.health_predictor = HealthPredictor(self.model_dir)
        self.rul_predictor = RulPredictor(self.model_dir)
        self.advisor = MaintenanceAdvisorEngine()
        self.sessions: "OrderedDict[str, _Session]" = OrderedDict()
        self.model_metadata = self._metadata()

    def _metadata(self) -> ModelMetadata:
        try:
            with open(self.model_dir / MODEL_CARD_FILE) as f:
                card = json.load(f)
        except Exception:
            card = {"metrics": {}}
        m = card.get("metrics", {})
        det = m.get("detection_end_to_end", {})
        rul = m.get("rul", {})
        td = card.get("training_data", {})
        return ModelMetadata(
            model_name="Mahalanobis residual detector + XGBoost fault classifier / severity / RUL-quantile",
            version=card.get("version", "unknown"),
            training_dataset=f"GarudaTwin engine simulator: {td.get('samples', 0):,} samples, {td.get('episodes', 0):,} episodes",
            num_features=len(FEATURE_NAMES),
            feature_engineering="Golden-twin physics residuals + rolling mean/std (8 samples); no health/label inputs",
            validation_mae_hours=float(rul.get("mae_hours", 0.0)),
            validation_rmse_hours=None,
            anomaly_precision=float(det.get("precision", 0.0)),
            anomaly_recall=float(det.get("recall", 0.0)),
            inference_latency_ms=0.0,
            tbo_hours=BASE_TBO_HOURS,
            mel_threshold=MEL_THRESHOLD_SCORE,
            data_source_note=(
                "AI-assisted prototype advisory trained on simulator data (metrics are simulator-domain). "
                "NOT certified aircraft maintenance. Follows Rotax 915iS AMM reference only."
            ),
        )

    # ------------------------------------------------------------------
    def _session(self, uav_id: str) -> _Session:
        s = self.sessions.get(uav_id)
        if s is None:
            s = self.sessions[uav_id] = _Session()
            if len(self.sessions) > MAX_SESSIONS:
                self.sessions.popitem(last=False)
        self.sessions.move_to_end(uav_id)
        return s

    def reset_history(self, uav_id: Optional[str] = None):
        if uav_id is None:
            self.sessions.clear()
        else:
            self.sessions.pop(uav_id, None)

    @staticmethod
    def _uav_id(raw: Dict[str, Any]) -> str:
        if raw.get("uav_id"):
            return str(raw["uav_id"])[:64]
        if raw.get("is_sandbox") or raw.get("mode") in ("SANDBOX", "BENCHMARK"):
            return "SANDBOX"
        return "default"

    # ------------------------------------------------------------------
    def predict(
        self,
        raw_telemetry: Dict[str, Any],
        dt: Optional[float] = None,
        simulated_packet_loss: float = 0.0,
        total_flight_hours: float = 450.0,
        mission_demand_hours: float = 6.0,
        persistence: bool = True,
    ) -> UnifiedHealthRulResponse:
        """persistence=False: one-shot assessment of a single frame (no 2-sample confirmation).
        raw_telemetry["one_shot"] = True: assess this frame on its own — the session is restarted first,
        so earlier frames (e.g. a previous what-if profile) cannot leak into the rolling window."""
        t0 = time.perf_counter()
        if raw_telemetry.get("one_shot"):
            self.reset_history(self._uav_id(raw_telemetry))
            persistence = False
        sess = self._session(self._uav_id(raw_telemetry))

        # Time base: simulator time if supplied, else client timestamp, else 1 s
        t = raw_telemetry.get("sim_time_s", raw_telemetry.get("timestamp_s"))
        try:
            t = float(t) if t is not None else None
        except (TypeError, ValueError):
            t = None
        if dt is None:
            dt = (t - sess.last_t) if (t is not None and sess.last_t is not None) else 1.0
            dt = min(5.0, max(0.05, dt))
        if t is not None:
            sess.last_t = t
        sess.clock += dt

        # 1. Data quality
        dq = sess.guard.validate_and_clean_frame(raw_telemetry, dt=dt, simulated_packet_loss=simulated_packet_loss)
        frame = dq["cleaned_frame"]
        raw_dq: DataQualitySummary = dq["summary"]
        n_out = len([o for o in raw_dq.outliers_detected if not o.endswith("_spike")])
        quality = max(40.0, 100.0 - raw_dq.missing_count * 4.0 - n_out * 3.0)

        # 2. Features  3. Health / anomaly / diagnosis
        vec, ctx = sess.fx.update(frame, dt)
        health, extras = self.health_predictor.predict(vec, prev_raw_anomaly=sess.prev_raw_anomaly if persistence else True,
                                                       prev_raw_diagnosis=sess.prev_raw_diagnosis if persistence else None,
                                                       last_known=sess.last_known_fault,
                                                       samples_since_known=sess.samples_since_known)
        sess.prev_raw_anomaly = extras["raw_anomaly"]
        sess.prev_raw_diagnosis = extras["raw_diagnosis"]
        sess.last_known_fault = extras["last_known"]
        sess.samples_since_known = extras["samples_since_known"]
        ood = extras["ood_features"]
        confidence_scale = 0.8 if ood else 1.0

        # Sensor faults: a stuck sensor (data-quality rule) or a drifting one (classifier).
        # Neither reduces engine health; both name the implicated channel.
        if raw_dq.failed_sensors and health.diagnosed_fault in ("NONE", UNCLASSIFIED):
            health.diagnosed_fault = "SENSOR_FAILURE"
            health.severity_level = "ELEVATED"
            health.confidence_pct = 100.0  # deterministic rule: reading frozen far longer than sensor noise allows
        if health.diagnosed_fault == "SENSOR_FAILURE":
            health.suspect_sensor = ", ".join(raw_dq.failed_sensors)
        elif health.diagnosed_fault == "SENSOR_DRIFT":
            health.suspect_sensor = self._suspect_drift_channel(extras["attributions"], ctx)

        # Fault onset tracking (per session) for change-point reporting
        if health.diagnosed_fault != "NONE":
            if sess.fault_onset_t is None:
                sess.fault_onset_t = sess.clock
            change_point = round((sess.clock - sess.fault_onset_t) / 3600.0, 4)
        else:
            sess.fault_onset_t = None
            change_point = None

        # 4. RUL
        rul = self.rul_predictor.predict(
            vec, frame, ctx["nominal"], health.diagnosed_fault, extras["health_index"],
            extras["confidence"] * confidence_scale, extras["attributions"],
            total_flight_hours=total_flight_hours, mission_demand_hours=mission_demand_hours,
            change_point_hours_ago=change_point, out_of_distribution=bool(ood),
        )

        # 5. TreeSHAP attributions
        attributions = [
            XaiFeatureAttribution(
                feature=a["feature"], importance_pct=a["importance_pct"], direction=a["direction"],
                description=self._describe(a["group"], ctx, health.diagnosed_fault),
            )
            for a in extras["attributions"]
        ]

        # 6. Advisories
        summary = self._summary_frame(frame, ctx)
        pilot_advisory = self._generate_pilot_advisory(health, rul)
        if health.diagnosed_fault in SENSOR_FAULT_CLASSES:
            pilot_advisory = self._sensor_pilot_advisory(health)
        maintenance = self.advisor.generate(
            health_index=rul.healthIndexScore, edi=rul.engineDegradationIndex, rul_hours=rul.rulHours,
            degradation_trend=rul.degradationTrend, degradation_rate=rul.degradationRatePercentPerHour,
            diagnosed_fault=health.diagnosed_fault, severity_level=health.severity_level,
            stress=rul.stressBreakdown, subsys=rul.subsystemDegradation,
            mission_demand_hours=mission_demand_hours, feature_attributions=attributions,
            raw_telemetry=summary, nominal=ctx["nominal"], suspect_sensor=health.suspect_sensor,
        )

        latency = (time.perf_counter() - t0) * 1000.0
        self.model_metadata.inference_latency_ms = round(latency, 2)
        return UnifiedHealthRulResponse(
            timestamp_s=float(t if t is not None else time.time()),
            health=health,
            rul=rul,
            data_quality=DataQualitySummary(
                valid=raw_dq.valid, missing_count=raw_dq.missing_count, imputed_fields=raw_dq.imputed_fields,
                outliers_detected=raw_dq.outliers_detected + [f"ood:{f}" for f in ood],
                failed_sensors=raw_dq.failed_sensors,
                packet_loss_simulated=raw_dq.packet_loss_simulated,
                quality_score_pct=round(quality, 1),
                sensor_confidence_pct=round(quality * confidence_scale, 1),
                telemetry_age_ms=round(dt * 1000.0, 0),
            ),
            feature_attributions=attributions,
            advisory=pilot_advisory,
            maintenance=maintenance,
            model_metadata=self.model_metadata,
            model_features={n: round(float(v), 4) for n, v in zip(FEATURE_NAMES, vec)},
            pipeline_latency_ms=round(latency, 2),
        )

    # ------------------------------------------------------------------
    @staticmethod
    def _summary_frame(frame: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, float]:
        """Scalar view of the frame for the advisory evidence table (hottest cylinder for EGT/CHT)."""
        nom = ctx["nominal"]
        pick = lambda k: frame.get(k) if frame.get(k) is not None else nom[k]
        return {
            "rpm": frame["rpm"],
            "egt": max(frame.get("egt") or [nom["egt"]]),
            "cht": max(frame.get("cht") or [nom["cht"]]),
            "oil_pressure": pick("oil_pressure"),
            "oil_temp": pick("oil_temp"),
            "vibration": pick("vibration"),
            "map_bar": pick("map_bar"),
            "gen_voltage": pick("gen_voltage"),
            "coolant_temp": pick("coolant_temp"),
        }

    @staticmethod
    def _suspect_drift_channel(attributions, ctx: Dict[str, Any]) -> str:
        """Sensor group = strongest TreeSHAP group for SENSOR_DRIFT; cylinder = largest deviation from the others."""
        names = {"oil_temp": "oil temperature", "oil_pressure": "oil pressure", "coolant": "coolant temperature"}
        for a in attributions:
            g = a["group"]
            if g in ("egt", "cht"):
                res = ctx[f"{g}_res"]
                med = sorted(res)[1:3]
                med = sum(med) / 2
                cyl = max(range(4), key=lambda i: abs(res[i] - med)) + 1
                return f"{g.upper()} cylinder {cyl} ({res[cyl - 1] - med:+.1f} °C vs other cylinders)"
            if g in names:
                return names[g]
        return "unidentified"

    @staticmethod
    def _describe(group: str, ctx: Dict[str, Any], diagnosis: str) -> str:
        b, sd = ctx["base"], ctx["rstd"]
        # Rolling-window fluctuation (std over the last 8 samples) — what instability signatures rely on
        fluct = {
            "egt": f"; EGT fluctuation σ {sd['egt_res_mean']:.1f}°C",
            "lambda": f"; lambda fluctuation σ {sd['lambda_res']:.3f}",
            "map": f"; MAP fluctuation σ {sd['map_res']:.3f} bar",
            "oil_pressure": f"; oil-pressure fluctuation σ {sd['oil_press_res']:.2f} bar",
            "vibration": f"; vibration fluctuation σ {sd['vib_res']:.3f} g",
        }.get(group, "")
        return {
            "egt": (f"EGT residual {b['egt_res_mean']:+.1f}°C mean; hottest cylinder {ctx['hottest_egt_cyl']} "
                    f"{b['egt_spread']:+.1f}°C, coldest cylinder {ctx['coldest_egt_cyl']} {-b['egt_cold_spread']:+.1f}°C vs median"),
            "cht": (f"CHT residual {b['cht_res_mean']:+.1f}°C mean; hottest cylinder {ctx['hottest_cht_cyl']} "
                    f"{b['cht_spread']:+.1f}°C, coldest cylinder {ctx['coldest_cht_cyl']} {-b['cht_cold_spread']:+.1f}°C vs median"),
            "rpm": f"Crank-speed jitter {ctx['rstd']['rpm_step']:.1f} rpm sample-to-sample std",
            "map": f"Manifold pressure residual {b['map_res']:+.3f} bar vs commanded throttle",
            "oil_pressure": f"Oil pressure residual {b['oil_press_res']:+.2f} bar",
            "oil_temp": f"Oil temperature residual {b['oil_temp_res']:+.1f}°C",
            "vibration": f"Vibration residual {b['vib_res']:+.3f} g-RMS",
            "fuel_flow": f"Fuel flow residual {b['fuel_flow_res']:+.1f} L/h",
            "lambda": f"Lambda residual {b['lambda_res']:+.3f} (lean shift if positive)",
            "electrical": f"Bus voltage residual {b['gen_v_res']:+.1f} V, battery current residual {b['batt_i_res']:+.1f} A (negative = discharging)",
            "injection": f"Injection time {b['inj_pw_res_pct']:+.1f} % vs nominal, ECU fuel trim {b['fuel_trim_res']:+.1f} %",
            "coolant": f"Coolant temperature residual {b['coolant_res']:+.1f}°C",
        }[group] + fluct + f" — TreeSHAP contribution to {'diagnosis ' + diagnosis if diagnosis != 'NONE' else 'health estimate'}"

    @staticmethod
    def _sensor_pilot_advisory(health: Any) -> PilotAdvisoryOutput:
        sensor = health.suspect_sensor or "unidentified sensor"
        return PilotAdvisoryOutput(
            level="WARNING",
            action_plan=[
                f"1. SENSOR FAULT [{health.diagnosed_fault}]: {sensor} reading is not physically consistent with the coupled channels.",
                "2. Do not act on that reading alone; cross-check the redundant/coupled parameters.",
                "3. Engine health estimate is otherwise nominal — continue the mission with monitoring.",
                "4. Log for sensor inspection / recalibration after landing.",
            ],
        )

    @staticmethod
    def _generate_pilot_advisory(health: Any, rul: Any) -> PilotAdvisoryOutput:
        fault = health.diagnosed_fault
        rul_h = rul.rulHours
        if health.severity_level == "CRITICAL" or rul_h < 1.5:
            return PilotAdvisoryOutput(
                level="CRITICAL",
                action_plan=[
                    f"1. EMERGENCY: Fault [{fault}] diagnosed. Initiate Return-to-Base (RTB) or divert.",
                    f"2. Reduce throttle to 65% MCP to preserve remaining {rul_h:.1f} h estimated RUL.",
                    "3. Pitch down to maintain 115 kts airspeed for ram-air cooling.",
                    "4. Notify GCS mission commander and declare UAV emergency to ATC.",
                ],
                derate_throttle_pct=65.0, recommended_rpm=4200.0, target_recovery_field="Auxiliary Recovery Strip 04",
            )
        if health.severity_level == "ELEVATED":
            return PilotAdvisoryOutput(
                level="WARNING",
                action_plan=[
                    f"1. CAUTION: Degradation diagnosed [{fault}].",
                    "2. Restrict aggressive throttle transients and high-boost MAP manoeuvres.",
                    "3. Monitor oil pressure and cylinder head temperature trends closely.",
                    f"4. Plan mission termination within {rul_h:.1f} flight hours.",
                ],
                derate_throttle_pct=75.0, recommended_rpm=4600.0, target_recovery_field="Forward Operating Base Bravo",
            )
        return PilotAdvisoryOutput(
            level="NOMINAL",
            action_plan=[
                "All engine subsystems operating within certified Rotax 915/916 iS limits.",
                "Propulsion state nominal. No pilot intervention required.",
            ],
        )
