"""
Unified Health & RUL Service Module
Full pipeline orchestrator:
  Raw Sensor Data → Data Quality → Feature Engineering → Health/Anomaly →
  RUL/EDI/Subsystem Degradation → SHAP Attributions → Maintenance Advisory → Response
"""

import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np

from ..config.config import MODEL_DIR, FEATURE_COLS_FILE
from ..preprocessing.validation import DataQualityGuard
from ..preprocessing.feature_engineering import RollingFeatureExtractor
from ..inference.health_predictor import HealthPredictor
from ..inference.rul_predictor import RulPredictor
from ..services.maintenance_advisor import MaintenanceAdvisorEngine
from ..utils.performance_monitor import PerformanceMonitor
from ..schemas.health_rul_schema import (
    UnifiedHealthRulResponse,
    XaiFeatureAttribution,
    PilotAdvisoryOutput,
    DataQualitySummary,
    ModelMetadata,
    MaintenanceAdvisory,
)

# Try to load validation metrics from model artifacts
def _load_model_metrics() -> Dict[str, float]:
    try:
        with open(MODEL_DIR / "phase5_metrics.json") as f:
            m = json.load(f)
        return m
    except Exception:
        return {}

def _load_anomaly_metrics() -> Dict[str, float]:
    try:
        with open(MODEL_DIR / "anomaly_metrics.json") as f:
            m = json.load(f)
        return m
    except Exception:
        return {}


class HealthRulService:
    """
    Production service interface encapsulating the complete AI Health + RUL pipeline.
    """

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir) if model_dir else MODEL_DIR
        self.data_guard = DataQualityGuard()
        self.health_predictor = HealthPredictor(self.model_dir)
        self.rul_predictor = RulPredictor(self.model_dir)
        self.advisor = MaintenanceAdvisorEngine()
        self.history: List[Dict[str, float]] = []

        # Load feature column definitions
        try:
            with open(self.model_dir / FEATURE_COLS_FILE, "r") as f:
                self.feature_cols = json.load(f)
        except Exception:
            self.feature_cols = []

        # Cache model metadata
        rul_m = _load_model_metrics()
        anom_m = _load_anomaly_metrics()
        self.model_metadata = ModelMetadata(
            model_name="RUL-XGBoost + IsolationForest",
            version="1.2.0",
            training_dataset="Rotax 915iS Physics-Informed Synthetic (C-MAPSS derived)",
            num_features=len(self.feature_cols) or 71,
            feature_engineering="Rolling mean/std 30s & 60s windows (71 features)",
            validation_mae_hours=float(rul_m.get("mae", 0.0)),
            validation_rmse_hours=float(rul_m.get("rmse", 0.0)),
            anomaly_precision=float(anom_m.get("precision", 0.0)),
            anomaly_recall=float(anom_m.get("recall", 0.0)),
            inference_latency_ms=0.0,
            tbo_hours=2000.0,
            mel_threshold=50.0,
            data_source_note=(
                "AI-assisted prototype advisory. Physics-informed simulation data. "
                "NOT certified aircraft maintenance. Follows Rotax 915iS AMM reference only."
            ),
        )

    def reset_history(self):
        """Clears rolling historical window buffer."""
        self.history.clear()
        self.data_guard.reset()

    def predict(
        self,
        raw_telemetry: Dict[str, Any],
        dt: float = 1.0,
        simulated_packet_loss: float = 0.0,
        total_flight_hours: float = 450.0,
        mission_demand_hours: float = 6.0,
    ) -> UnifiedHealthRulResponse:
        """
        Executes end-to-end AI prediction pipeline.
        """
        perf = PerformanceMonitor()
        t0 = time.perf_counter()

        # 1. Data Quality Validation & Imputation
        t_dq = time.perf_counter()
        dq_res = self.data_guard.validate_and_clean_frame(
            raw_telemetry, dt=dt, simulated_packet_loss=simulated_packet_loss
        )
        cleaned_frame = dq_res["cleaned_frame"]
        dq_summary_raw: DataQualitySummary = dq_res["summary"]

        # Compute quality scores
        missing_penalty = dq_summary_raw.missing_count * 4.0
        outlier_count = len([o for o in dq_summary_raw.outliers_detected if "_spike" not in o])
        outlier_penalty = outlier_count * 3.0
        quality_score = max(60.0, 100.0 - missing_penalty - outlier_penalty)
        sensor_confidence = max(55.0, quality_score - outlier_penalty * 0.5)

        dq_summary = DataQualitySummary(
            valid=dq_summary_raw.valid,
            missing_count=dq_summary_raw.missing_count,
            imputed_fields=dq_summary_raw.imputed_fields,
            outliers_detected=dq_summary_raw.outliers_detected,
            packet_loss_simulated=dq_summary_raw.packet_loss_simulated,
            quality_score_pct=round(quality_score, 1),
            sensor_confidence_pct=round(sensor_confidence, 1),
            telemetry_age_ms=100.0,
        )
        perf.record_stage("data_quality_ms", (time.perf_counter() - t_dq) * 1000.0)

        self.history.append(cleaned_frame)
        if len(self.history) > 120:
            self.history.pop(0)

        # 2. Rolling Window Feature Engineering
        t_fe = time.perf_counter()
        df_hist = pd.DataFrame(self.history)
        feature_df = RollingFeatureExtractor.compute_features(df_hist, self.feature_cols)
        perf.record_stage("feature_engineering_ms", (time.perf_counter() - t_fe) * 1000.0)

        # 3. Health & Anomaly Prediction
        t_health = time.perf_counter()
        health_res = self.health_predictor.predict(feature_df)
        perf.record_stage("health_prediction_ms", (time.perf_counter() - t_health) * 1000.0)

        # 4. RUL + EDI + Subsystem Degradation
        t_rul = time.perf_counter()
        rul_res = self.rul_predictor.predict(
            feature_df=feature_df,
            raw_telemetry=cleaned_frame,
            anomaly_score=health_res.anomaly_score,
            diagnosed_fault=health_res.diagnosed_fault,
            total_flight_hours=total_flight_hours,
            mission_demand_hours=mission_demand_hours,
        )
        perf.record_stage("rul_prediction_ms", (time.perf_counter() - t_rul) * 1000.0)

        # 5. SHAP Feature Attributions
        t_shap = time.perf_counter()
        feature_attributions = self._compute_shap_attributions(
            cleaned_frame, health_res.diagnosed_fault
        )
        perf.record_stage("shap_explainability_ms", (time.perf_counter() - t_shap) * 1000.0)

        # 6. Pilot Advisory (legacy — kept for backward compatibility)
        t_adv = time.perf_counter()
        pilot_advisory = self._generate_pilot_advisory(health_res, rul_res, cleaned_frame)

        # 7. Maintenance Advisory Engine (new)
        maintenance_advisory = self.advisor.generate(
            health_index=rul_res.healthIndexScore,
            edi=rul_res.engineDegradationIndex,
            rul_hours=rul_res.rulHours,
            degradation_trend=rul_res.degradationTrend,
            degradation_rate=rul_res.degradationRatePercentPerHour,
            diagnosed_fault=health_res.diagnosed_fault,
            severity_level=health_res.severity_level,
            stress=rul_res.stressBreakdown,
            subsys=rul_res.subsystemDegradation,
            mission_demand_hours=mission_demand_hours,
            feature_attributions=feature_attributions,
            raw_telemetry=cleaned_frame,
        )
        perf.record_stage("advisory_generation_ms", (time.perf_counter() - t_adv) * 1000.0)

        total_latency_ms = (time.perf_counter() - t0) * 1000.0
        self.model_metadata.inference_latency_ms = round(total_latency_ms, 2)

        return UnifiedHealthRulResponse(
            timestamp_s=float(cleaned_frame.get("timestamp_s", time.time())),
            health=health_res,
            rul=rul_res,
            data_quality=dq_summary,
            feature_attributions=feature_attributions,
            advisory=pilot_advisory,
            maintenance=maintenance_advisory,
            model_metadata=self.model_metadata,
            pipeline_latency_ms=round(total_latency_ms, 2),
        )

    def _compute_shap_attributions(
        self,
        telemetry: Dict[str, float],
        diagnosed_fault: str,
    ) -> List[XaiFeatureAttribution]:
        """
        Computes physics-residual-based feature attributions (SHAP-style).
        """
        cht = telemetry.get("true_cht", telemetry.get("sensor_cht", 106.0))
        egt = telemetry.get("egt", 840.0)
        oil_p = telemetry.get("oil_pressure", 3.85)
        oil_t = telemetry.get("oil_temp", 98.0)
        vib = telemetry.get("vibration", 0.28)
        fuel = telemetry.get("fuel_flow", 26.0)
        bat  = telemetry.get("battery_voltage", 28.4)

        devs = [
            ("Exhaust Gas Temperature (EGT)",   abs(egt - 840.0) / 840.0 * 100.0,    "egt",      egt > 840.0),
            ("Oil Pressure",                     abs(oil_p - 3.85) / 3.85 * 100.0,   "oil_pressure", oil_p < 3.85),
            ("Cylinder Head Temp (CHT)",         abs(cht - 106.0) / 106.0 * 100.0,   "cht",      cht > 106.0),
            ("Engine Vibration (g-RMS)",         abs(vib - 0.28) / 0.28 * 100.0,     "vibration", vib > 0.28),
            ("Oil Temperature",                  abs(oil_t - 98.0) / 98.0 * 100.0,   "oil_temp", oil_t > 98.0),
            ("Fuel Flow",                        abs(fuel - 26.0) / 26.0 * 100.0,    "fuel_flow", fuel > 28.0),
            ("Battery Voltage",                  abs(bat - 28.4) / 28.4 * 100.0,     "battery_voltage", bat < 26.0),
        ]

        sorted_devs = sorted(devs, key=lambda x: x[1], reverse=True)
        total_dev = max(1.0, sum(d[1] for d in sorted_devs))

        attributions: List[XaiFeatureAttribution] = []
        for name, pct, key, is_risk in sorted_devs[:5]:
            importance_weight = float(np.round((pct / total_dev) * 100.0, 1))
            direction = "increases_risk" if is_risk else "normalizing"

            desc_map = {
                "egt":          f"EGT deviation ({egt:.1f}°C) — lean combustion or thermal imbalance",
                "oil_pressure": f"Oil pressure decay ({oil_p:.2f} bar) — hydrodynamic bearing lubrication risk",
                "vibration":    f"Vibration ({vib:.3f} g-RMS) — rotational asymmetry or bearing distress",
                "cht":          f"CHT elevation ({cht:.1f}°C) — thermal dissipation degraded",
                "oil_temp":     f"Oil temperature ({oil_t:.1f}°C) — lubrication viscosity degraded",
                "fuel_flow":    f"Fuel flow deviation ({fuel:.1f} L/h) — injector or pump anomaly",
                "battery_voltage": f"Bus voltage ({bat:.1f}V) — electrical system anomaly",
            }
            desc = desc_map.get(key, "Parameter within ±1.5σ nominal operating band")

            attributions.append(XaiFeatureAttribution(
                feature=name,
                importance_pct=importance_weight,
                direction=direction,
                description=desc,
            ))

        return attributions

    def _generate_pilot_advisory(self, health: Any, rul: Any, telemetry: Dict[str, float]) -> PilotAdvisoryOutput:
        """Generates actionable in-flight pilot advisories (legacy output)."""
        fault = health.diagnosed_fault
        rul_h = rul.rulHours
        health_score = rul.healthIndexScore

        if health.severity_level == "CRITICAL" or rul_h < 1.5 or health_score < 40.0:
            level = "CRITICAL"
            action_plan = [
                f"1. EMERGENCY: Fault [{fault}] active. Initiate Return-to-Base (RTB) or Divert.",
                f"2. Reduce throttle to 65% MCP to preserve remaining {rul_h:.1f} RUL flight hours.",
                "3. Pitch down to maintain 115 kts airspeed for cylinder head ram-air cooling.",
                "4. Notify Ground Control Station (GCS) and squawk 7700 emergency.",
            ]
            derate, rec_rpm, target = 65.0, 4200.0, "Auxiliary Recovery Strip 04"
        elif health.severity_level == "ELEVATED" or health_score < 70.0:
            level = "WARNING"
            action_plan = [
                f"1. CAUTION: Elevated degradation detected in [{fault}].",
                "2. Restrict aggressive throttle transients and high-boost MAP maneuvers.",
                "3. Monitor oil pressure and cylinder head temperature trends closely.",
                f"4. Plan mission termination within {rul_h:.1f} flight hours.",
            ]
            derate, rec_rpm, target = 75.0, 4600.0, "Forward Operating Base Bravo"
        else:
            level = "NOMINAL"
            action_plan = [
                "All engine subsystems operating within certified Rotax 915/916 iS limits.",
                "Propulsion state nominal. No pilot intervention required.",
            ]
            derate = rec_rpm = target = None

        return PilotAdvisoryOutput(
            level=level,
            action_plan=action_plan,
            derate_throttle_pct=derate,
            recommended_rpm=rec_rpm,
            target_recovery_field=target,
        )
