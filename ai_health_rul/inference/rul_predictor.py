"""
RUL Predictor Inference Module — Extended
Loads rul_regressor.pkl and computes:
  - Dynamic flight-hour Remaining Useful Life
  - Engine Degradation Index (EDI 0-100)
  - Per-subsystem degradation scores
  - Multi-physics fatigue stress decomposition
  - Bayesian confidence bounds and 50-hour forecast trajectory
  - Failure risk score (probabilistic)
  - Multi-horizon risk (1h, 4h, 8h, 24h)
  - Changepoint estimation
  - Out-of-distribution detection
"""

import json
import pickle
from pathlib import Path
from typing import Dict, Any, List, Optional
import pandas as pd
import numpy as np

from ..config.config import (
    MODEL_DIR,
    RUL_REGRESSOR_FILE,
    FEATURE_COLS_FILE,
    BASE_TBO_HOURS,
    MEL_THRESHOLD_SCORE,
    MIN_SAFE_RUL_HOURS,
)
from ..schemas.health_rul_schema import (
    PrognosticsResult,
    RulTrajectoryPoint,
    HistoricalTrendPoint,
    StressBreakdown,
    SubsystemDegradation,
)


def _safe_pow(val: float, exp: float) -> float:
    """Safely calculates power for non-negative floats."""
    import math
    return math.pow(max(0.0, val), exp) if val > 0 else 0.0


# ---------------------------------------------------------------------------
# Out-of-Distribution Training Bounds (derived from Rotax 915iS normal envelope)
# ---------------------------------------------------------------------------
OOD_BOUNDS = {
    "egt":          (350.0, 1080.0),
    "cht":          (40.0,  180.0),
    "oil_pressure": (0.4,   7.5),
    "oil_temp":     (30.0,  165.0),
    "vibration":    (0.02,  5.5),
    "rpm":          (1200.0, 6500.0),
}


class KalmanFilter1D:
    """1D Kalman Filter for tracking RUL & Engine Degradation Index."""
    def __init__(self, initial_state: float, initial_variance: float, process_noise: float, measurement_noise: float):
        self.x = initial_state
        self.p = initial_variance
        self.q = process_noise      # Process noise covariance
        self.r = measurement_noise  # Measurement noise covariance

    def update(self, measurement: float) -> float:
        # Prediction
        x_pred = self.x
        p_pred = self.p + self.q
        
        # Update
        k = p_pred / (p_pred + self.r)
        self.x = x_pred + k * (measurement - x_pred)
        self.p = (1 - k) * p_pred
        
        return self.x

    def get_confidence_interval(self, z_score: float = 1.96):
        std_dev = np.sqrt(self.p)
        return self.x - z_score * std_dev, self.x + z_score * std_dev

class RulPredictor:
    """
    Inference engine for propulsion Remaining Useful Life (RUL) regression
    and multi-physics fatigue prognostics.

    ML model (rul_regressor.pkl) is used when a non-nominal fault is active.
    For nominal conditions, physics-informed fatigue integration is used.
    Both paths converge to the same output schema.
    """

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir) if model_dir else MODEL_DIR
        self.models_loaded = False
        self._load_models()
        self.rul_kf = KalmanFilter1D(initial_state=2000.0, initial_variance=100.0, process_noise=0.1, measurement_noise=10.0)

    def _load_models(self):
        """Loads RUL regression model and feature column JSON."""
        try:
            with open(self.model_dir / RUL_REGRESSOR_FILE, "rb") as f:
                self.reg = pickle.load(f)
            with open(self.model_dir / FEATURE_COLS_FILE, "r") as f:
                self.feature_cols = json.load(f)
            self.models_loaded = True
        except Exception as e:
            print(f"[WARN] RulPredictor: model load failed ({e}). Physics fallback active.")
            self.models_loaded = False

    def predict(
        self,
        feature_df: pd.DataFrame,
        raw_telemetry: Dict[str, float],
        anomaly_score: float,
        diagnosed_fault: str = "none",
        total_flight_hours: float = 450.0,
        mission_demand_hours: float = 6.0,
    ) -> PrognosticsResult:
        """
        Full prognostic pipeline:
          1. ML Regressor (when fault active)
          2. Multi-physics fatigue stress decomposition
          3. EDI and subsystem degradation
          4. Health index
          5. RUL calculation
          6. Failure risk & multi-horizon risk
          7. Trajectory forecast
          8. Historical trend reconstruction
          9. Changepoint estimation
         10. OOD detection
        """
        # ---------------------------------------------------------------
        # Extract telemetry parameters
        # ---------------------------------------------------------------
        rpm       = raw_telemetry.get("rpm", 4800.0)
        cht       = raw_telemetry.get("true_cht", raw_telemetry.get("sensor_cht", 106.0))
        egt       = raw_telemetry.get("egt", 840.0)
        oil_press = raw_telemetry.get("oil_pressure", 3.85)
        oil_temp  = raw_telemetry.get("oil_temp", 98.0)
        vib       = raw_telemetry.get("vibration", 0.28)
        map_bar   = raw_telemetry.get("map_bar", raw_telemetry.get("boost_map", 1.42))
        fuel_flow = raw_telemetry.get("fuel_flow", 26.0)
        bat_v     = raw_telemetry.get("battery_voltage", 28.4)

        is_nominal_fault = diagnosed_fault in ("none", "NOMINAL", "NOMINAL_OPERATION", "healthy", "MODEL_DISAGREEMENT")

        # ---------------------------------------------------------------
        # 1. ML Regressor Prediction (non-nominal only)
        # ---------------------------------------------------------------
        ml_rul_seconds: Optional[float] = None
        if self.models_loaded and not is_nominal_fault:
            try:
                X_in = feature_df[self.feature_cols].iloc[[-1]]
                pred_sec = float(self.reg.predict(X_in)[0])
                ml_rul_seconds = max(0.0, pred_sec)
            except Exception:
                ml_rul_seconds = None

        # ---------------------------------------------------------------
        # 2. Multi-Physics Fatigue Stress Decomposition
        # ---------------------------------------------------------------

        # Thermal Stress — EGT and CHT contributions
        thermal_stress = 1.0
        if cht > 118.0:
            thermal_stress += _safe_pow((cht - 118.0) / 14.0, 1.8)
        if oil_temp > 95.0:
            thermal_stress += _safe_pow((oil_temp - 95.0) / 12.0, 1.6) * 0.7
        if egt > 880.0:
            thermal_stress += _safe_pow((egt - 880.0) / 25.0, 1.5) * 0.6

        # Mechanical & Vibrational Stress
        mechanical_stress = 1.0
        if vib > 0.35:
            mechanical_stress += _safe_pow((vib - 0.35) / 0.22, 2.0)

        # Lubrication Stress
        lubrication_stress = 1.0
        if oil_press < 2.8:
            lubrication_stress += _safe_pow((2.8 - oil_press) / 0.8, 2.2)
        if oil_temp > 110.0 and oil_press < 2.5:
            lubrication_stress += 1.4

        # Combustion Stress — lean burn / EGT excess
        combustion_stress = 1.0
        if egt > 920.0:
            combustion_stress += (egt - 920.0) / 30.0

        # Operating Load Stress
        operating_stress = 1.0
        if rpm > 5200.0:
            operating_stress += ((rpm - 5200.0) / 600.0) * 0.5
        if map_bar > 1.65:
            operating_stress += ((map_bar - 1.65) / 0.25) * 0.4

        # Electrical stress (minor — voltage sag)
        elec_stress = 1.0
        if bat_v < 24.0:
            elec_stress += (24.0 - bat_v) / 6.0

        # Fault multiplier
        fault_multiplier = 1.0
        if not is_nominal_fault:
            fault_multiplier = 2.4

        anomaly_factor = 1.0 + max(0.0, anomaly_score) * 3.2

        combined_stress = float(np.round(
            max(1.0, thermal_stress) *
            max(1.0, mechanical_stress) *
            max(1.0, lubrication_stress) *
            max(1.0, combustion_stress) *
            max(1.0, operating_stress) *
            fault_multiplier *
            anomaly_factor,
            2
        ))

        # ---------------------------------------------------------------
        # 3. Engine Degradation Index (EDI 0-100)
        #    Distinct from Health Index (which goes 100→0)
        #    EDI = normalised fatigue accumulation
        # ---------------------------------------------------------------
        raw_edi = (combined_stress - 1.0) * 14.0 + anomaly_score * 22.0
        if not is_nominal_fault:
            raw_edi += (fault_multiplier - 1.0) * 8.0
        edi = float(np.round(max(0.0, min(100.0, raw_edi)), 1))

        # ---------------------------------------------------------------
        # 4. Per-Subsystem Degradation Scores (0-100)
        # ---------------------------------------------------------------
        subsys = SubsystemDegradation(
            thermal=float(np.round(min(100.0, max(0.0, (thermal_stress - 1.0) * 48.0)), 1)),
            mechanical=float(np.round(min(100.0, max(0.0, (mechanical_stress - 1.0) * 52.0)), 1)),
            lubrication=float(np.round(min(100.0, max(0.0, (lubrication_stress - 1.0) * 38.0)), 1)),
            combustion=float(np.round(min(100.0, max(0.0, (combustion_stress - 1.0) * 42.0)), 1)),
            fuel=float(np.round(min(100.0, max(0.0,
                abs(fuel_flow - 26.0) / 26.0 * 60.0 + anomaly_score * 10.0
            )), 1)),
            electrical=float(np.round(min(100.0, max(0.0, (elec_stress - 1.0) * 55.0)), 1)),
        )

        # ---------------------------------------------------------------
        # 5. Health Index (0-100, inverse of EDI)
        # ---------------------------------------------------------------
        deduction = min(88.0,
            anomaly_score * 48.0
            + (combined_stress - 1.0) * 3.5
            + (fault_multiplier - 1.0) * 12.0
        )
        health_index_score = float(np.round(max(12.0, min(100.0, 100.0 - deduction)), 1))

        # Consistency check: EDI + Health should approximately sum to 100
        edi = float(np.round(min(edi, 100.0 - health_index_score + 5.0), 1))

        # ---------------------------------------------------------------
        # 6. Degradation Rate & RUL
        # ---------------------------------------------------------------
        base_degradation_per_hour = 0.045  # Nominal %/hr (~2000h life)
        active_degradation_rate = base_degradation_per_hour * combined_stress

        if ml_rul_seconds is not None and ml_rul_seconds > 0:
            raw_rul_hours = ml_rul_seconds / 3600.0
        else:
            delta_to_mel = max(1.0, health_index_score - MEL_THRESHOLD_SCORE)
            raw_rul_hours = delta_to_mel / max(0.04, active_degradation_rate)

        remaining_tbo = max(10.0, BASE_TBO_HOURS - total_flight_hours)
        raw_rul_hours = min(raw_rul_hours, remaining_tbo * 0.85)
        raw_rul_hours = max(MIN_SAFE_RUL_HOURS, raw_rul_hours)

        # Kalman Filter Update (Phase 3 Integration)
        self.rul_kf.q = 0.05 + (combined_stress - 1.0) * 0.5  # Dynamic process noise based on stress
        rul_hours_kf = self.rul_kf.update(raw_rul_hours)
        rul_hours = float(np.round(rul_hours_kf, 1))

        # Confidence interval (Bayesian ±1.96σ via Kalman Covariance)
        lower_bound, upper_bound = self.rul_kf.get_confidence_interval(z_score=1.96)
        rul_lower = float(np.round(max(MIN_SAFE_RUL_HOURS, lower_bound), 1))
        rul_upper = float(np.round(upper_bound, 1))

        # ---------------------------------------------------------------
        # 7. Degradation Trend
        # ---------------------------------------------------------------
        if active_degradation_rate > 0.22 or combined_stress > 3.2 or anomaly_score > 0.45:
            degradation_trend = "Rapidly Degrading"
        elif active_degradation_rate > 0.075 or combined_stress > 1.45 or anomaly_score > 0.15:
            degradation_trend = "Degrading"
        else:
            degradation_trend = "Stable"

        # ---------------------------------------------------------------
        # 8. Bayesian Confidence Score
        # ---------------------------------------------------------------
        raw_confidence = 88.0 - (combined_stress - 1.0) * 1.8 - anomaly_score * 8.0
        confidence_pct = float(np.round(max(68.0, min(95.0, raw_confidence)), 1))

        # ---------------------------------------------------------------
        # 9. Failure Risk Score & Multi-Horizon Risk
        # ---------------------------------------------------------------
        # Base failure probability from Weibull-inspired model
        # P(failure) ≈ 1 - exp(-(EDI/50)^β) where β captures degradation regime
        beta = 2.0 if degradation_trend == "Rapidly Degrading" else 1.5
        failure_risk_score = float(np.round(
            min(0.99, 1.0 - np.exp(-((edi / 55.0) ** beta))), 4
        ))

        if failure_risk_score < 0.05:
            failure_risk_level = "LOW"
        elif failure_risk_score < 0.20:
            failure_risk_level = "MEDIUM"
        elif failure_risk_score < 0.50:
            failure_risk_level = "HIGH"
        else:
            failure_risk_level = "CRITICAL"

        # Multi-horizon risk: project degradation forward
        def horizon_risk(hours_ahead: float) -> float:
            projected_health = max(0.0, health_index_score - active_degradation_rate * hours_ahead)
            projected_edi = min(100.0, edi + active_degradation_rate * hours_ahead * 18.0)
            return float(np.round(
                min(0.99, 1.0 - np.exp(-((projected_edi / 55.0) ** beta))) * 100.0, 2
            ))

        multi_horizon_risk = {
            "1hr":  horizon_risk(1.0),
            "4hr":  horizon_risk(4.0),
            "8hr":  horizon_risk(8.0),
            "24hr": horizon_risk(24.0),
        }

        # ---------------------------------------------------------------
        # 10. Mission Margin
        # ---------------------------------------------------------------
        mission_margin = float(np.round(rul_hours - mission_demand_hours, 2))

        # ---------------------------------------------------------------
        # 11. Historical Degradation Points (T-50h → NOW)
        # ---------------------------------------------------------------
        historical_health_points: List[HistoricalTrendPoint] = []
        historical_rul_points: List[HistoricalTrendPoint] = []
        past_offsets = [-50, -40, -30, -20, -10, 0]

        for offset in past_offsets:
            label = "NOW" if offset == 0 else f"T{offset}h"
            if offset == 0:
                historical_health_points.append(HistoricalTrendPoint(
                    hoursOffset=0, label=label, value=health_index_score))
                historical_rul_points.append(HistoricalTrendPoint(
                    hoursOffset=0, label=label, value=rul_hours))
            else:
                hours_back = abs(offset)
                past_health = float(np.round(
                    min(100.0, 100.0 if is_nominal_fault else
                        max(0.0, 100.0 - max(0.0, (100.0 - health_index_score) - hours_back * 0.4))),
                    1
                ))
                past_rul = float(np.round(
                    min(remaining_tbo + hours_back,
                        (past_health - MEL_THRESHOLD_SCORE) / base_degradation_per_hour),
                    1
                ))
                historical_health_points.append(HistoricalTrendPoint(
                    hoursOffset=offset, label=label, value=past_health))
                historical_rul_points.append(HistoricalTrendPoint(
                    hoursOffset=offset, label=label, value=past_rul))

        # ---------------------------------------------------------------
        # 12. 50-Hour RUL Forecast Trajectory
        # ---------------------------------------------------------------
        trajectory: List[RulTrajectoryPoint] = []
        for step in [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]:
            wear_delta = active_degradation_rate * step * (1.0 + (step / 120.0))
            predicted_health = float(np.round(max(0.0, health_index_score - wear_delta), 1))
            uncertainty = 1.0 + np.sqrt(step) * (0.9 + combined_stress * 0.35)
            upper_conf = float(np.round(min(100.0, predicted_health + uncertainty), 1))
            lower_conf = float(np.round(max(0.0, predicted_health - uncertainty), 1))
            trajectory.append(RulTrajectoryPoint(
                hoursElapsed=float(step),
                predictedHealth=predicted_health,
                upperConfidence=upper_conf,
                lowerConfidence=lower_conf,
                thresholdLimit=MEL_THRESHOLD_SCORE
            ))

        # ---------------------------------------------------------------
        # 13. Changepoint Detection (simplified)
        # ---------------------------------------------------------------
        change_point_hrs_ago: Optional[float] = None
        if not is_nominal_fault and edi > 10:
            change_point_hrs_ago = float(np.round(
                max(0.1, (edi / max(0.01, active_degradation_rate)) * 0.06), 1
            ))

        # ---------------------------------------------------------------
        # 14. Out-of-Distribution Detection
        # ---------------------------------------------------------------
        ood_flags = []
        check_vals = {
            "egt": egt, "cht": cht, "oil_pressure": oil_press,
            "oil_temp": oil_temp, "vibration": vib, "rpm": rpm
        }
        for param, val in check_vals.items():
            lo, hi = OOD_BOUNDS.get(param, (-1e9, 1e9))
            if val < lo or val > hi:
                ood_flags.append(param)
        
        if len(ood_flags) > 0:
            raise ValueError(f"OUT_OF_DISTRIBUTION: Inputs out of bounds for {', '.join(ood_flags)}")
        
        out_of_distribution = False

        return PrognosticsResult(
            rulHours=rul_hours,
            rulHoursLower95=rul_lower,
            rulHoursUpper95=rul_upper,
            degradationRatePercentPerHour=float(np.round(active_degradation_rate, 3)),
            healthIndexScore=health_index_score,
            engineDegradationIndex=edi,
            degradationTrend=degradation_trend,
            confidencePct=confidence_pct,
            trajectory=trajectory,
            historicalHealthPoints=historical_health_points,
            historicalRulPoints=historical_rul_points,
            stressBreakdown=StressBreakdown(
                thermalStress=float(np.round(thermal_stress, 2)),
                mechanicalStress=float(np.round(mechanical_stress, 2)),
                lubricationStress=float(np.round(lubrication_stress, 2)),
                combustionStress=float(np.round(combustion_stress, 2)),
                operatingStress=float(np.round(operating_stress, 2)),
                combinedStress=combined_stress,
            ),
            subsystemDegradation=subsys,
            overhaulThresholdHours=BASE_TBO_HOURS,
            missionMarginHours=mission_margin,
            changePointHoursAgo=change_point_hrs_ago,
            failureRiskScore=failure_risk_score,
            failureRiskLevel=failure_risk_level,
            multiHorizonRisk=multi_horizon_risk,
            outOfDistribution=out_of_distribution,
        )
