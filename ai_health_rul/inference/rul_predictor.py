"""
RUL Predictor Inference Module
Uses the XGBoost quantile regressor (2.5 / 50 / 97.5 %) trained by training/train_models.py
to estimate hours to functional failure when a fault is diagnosed. With no fault diagnosed,
RUL is the remaining scheduled TBO (not a prediction).

Derived quantities are computed from the model outputs so they stay mutually consistent:
  EDI = 100 - health,  degradation rate = health / RUL,  risk(h) = P(RUL < h) from the quantiles.
Physics stress factors are descriptive only (they do not feed the prediction).
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List, Optional

import numpy as np
import xgboost as xgb

from ..config.config import (
    MODEL_DIR, RUL_REGRESSOR_FILE, MODEL_CARD_FILE, BASE_TBO_HOURS,
    MEL_THRESHOLD_SCORE, MIN_SAFE_RUL_HOURS, FAULT_CLASSES, SENSOR_FAULT_CLASSES,
)
from ..preprocessing.feature_engineering import FEATURE_NAMES
from ..schemas.health_rul_schema import (
    PrognosticsResult, RulTrajectoryPoint, HistoricalTrendPoint, StressBreakdown, SubsystemDegradation,
)


def _pow(val: float, exp: float) -> float:
    return math.pow(val, exp) if val > 0 else 0.0


def _norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


class RulPredictor:
    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir) if model_dir else MODEL_DIR
        self.models_loaded = False
        self._load_models()

    def _load_models(self):
        try:
            self.reg = xgb.Booster(model_file=str(self.model_dir / RUL_REGRESSOR_FILE))
            with open(self.model_dir / MODEL_CARD_FILE) as f:
                card = json.load(f)
            self.cqr_margin = float(card.get("rul_conformal_log_margin", 0.0))
            self.models_loaded = True
        except Exception as e:
            print(f"[ERROR] RulPredictor failed to load model: {e}")
            self.models_loaded = False

    @staticmethod
    def _stress(frame: Dict[str, Any], nominal: Dict[str, float]) -> StressBreakdown:
        """Descriptive physics stress factors (1.0 = nominal) from absolute sensor levels."""
        egt = max(frame.get("egt") or [nominal["egt"]])
        cht = max(frame.get("cht") or [nominal["cht"]])
        oil_t = frame.get("oil_temp") or nominal["oil_temp"]
        oil_p = frame.get("oil_pressure") or nominal["oil_pressure"]
        vib = frame.get("vibration") or nominal["vibration"]
        rpm, map_bar = frame["rpm"], frame.get("map_bar") or nominal["map_bar"]
        thermal = 1.0 + _pow((cht - 118.0) / 14.0, 1.8) + 0.7 * _pow((oil_t - 105.0) / 12.0, 1.6) + 0.6 * _pow((egt - 900.0) / 25.0, 1.5)
        mechanical = 1.0 + _pow((vib - 0.35) / 0.22, 2.0)
        lubrication = 1.0 + _pow((2.8 - oil_p) / 0.8, 2.2)
        combustion = 1.0 + max(0.0, (egt - 920.0) / 30.0)
        operating = 1.0 + max(0.0, (rpm - 5200.0) / 600.0) * 0.5 + max(0.0, (map_bar - 1.65) / 0.25) * 0.4
        r = lambda v: float(round(v, 2))
        return StressBreakdown(
            thermalStress=r(thermal), mechanicalStress=r(mechanical), lubricationStress=r(lubrication),
            combustionStress=r(combustion), operatingStress=r(operating),
            # Largest single factor (factors are not independent, so they are not multiplied)
            combinedStress=r(max(thermal, mechanical, lubrication, combustion, operating)),
        )

    def predict(
        self,
        vec: np.ndarray,
        frame: Dict[str, Any],
        nominal: Dict[str, float],
        diagnosis: str,
        health_index: float,
        confidence: float,
        attributions: List[Dict[str, Any]],
        total_flight_hours: float = 450.0,
        mission_demand_hours: float = 6.0,
        change_point_hours_ago: Optional[float] = None,
        out_of_distribution: bool = False,
    ) -> PrognosticsResult:
        remaining_tbo = max(10.0, BASE_TBO_HOURS - total_flight_hours)
        # Sensor faults do not degrade the engine: RUL stays on the scheduled-TBO path
        faulted = diagnosis != "NONE" and diagnosis not in SENSOR_FAULT_CLASSES

        if faulted and self.models_loaded:
            q = np.sort(self.reg.inplace_predict(vec.reshape(1, -1))[0])
            # Conformal margin calibrated on validation episodes -> 95 % interval coverage
            lo, med, hi = (float(math.exp(v)) for v in (q[0] - self.cqr_margin, q[1], q[2] + self.cqr_margin))
            lo, med, hi = (min(v, remaining_tbo) for v in (lo, med, hi))
        else:
            lo = med = hi = remaining_tbo
        med = max(MIN_SAFE_RUL_HOURS, med)
        lo = max(MIN_SAFE_RUL_HOURS, min(lo, med))
        hi = max(med, hi)

        edi = round(100.0 - health_index, 1)
        if faulted:
            rate = health_index / med                  # health %-points lost per hour until failure
            rate_fast, rate_slow = health_index / lo, health_index / hi
        else:
            # No engine fault diagnosed: RUL is the scheduled TBO, and using up scheduled life is not
            # degradation. Reporting health/TBO as a "rate" made a healthy high-hours engine look
            # "Degrading" and triggered inspections purely from its flight hours.
            rate = rate_fast = rate_slow = 0.0

        if rate > 1.0:
            trend = "Rapidly Degrading"
        elif rate > 0.1:
            trend = "Degrading"
        else:
            trend = "Stable"

        # Failure probability within h hours: lognormal fitted to the RUL quantiles when faulted,
        # otherwise a constant hazard with MTBF = TBO (assumption).
        if faulted:
            mu, sigma = math.log(med), max(0.05, (math.log(hi) - math.log(lo)) / (2 * 1.96))
            risk = lambda h: _norm_cdf((math.log(h) - mu) / sigma)
        else:
            risk = lambda h: 1.0 - math.exp(-h / BASE_TBO_HOURS)
        risk_score = round(min(0.99, risk(max(0.1, mission_demand_hours))), 4)
        level = "LOW" if risk_score < 0.05 else "MEDIUM" if risk_score < 0.20 else "HIGH" if risk_score < 0.50 else "CRITICAL"
        multi = {k: round(min(99.0, risk(h) * 100.0), 2) for k, h in (("1hr", 1), ("4hr", 4), ("8hr", 8), ("24hr", 24))}

        # 50-hour forecast; the band comes from the RUL quantiles
        trajectory = []
        for step in range(0, 55, 5):
            trajectory.append(RulTrajectoryPoint(
                hoursElapsed=float(step),
                predictedHealth=round(max(0.0, health_index - rate * step), 1),
                upperConfidence=round(min(100.0, max(0.0, health_index - rate_slow * step)), 1),
                lowerConfidence=round(max(0.0, health_index - rate_fast * step), 1),
                thresholdLimit=MEL_THRESHOLD_SCORE,
            ))

        # Model backcast (NOT recorded history): extrapolate the current rate backwards
        hist_h, hist_r = [], []
        for off in (-50, -40, -30, -20, -10, 0):
            label = "NOW" if off == 0 else f"T{off}h (backcast)"
            hist_h.append(HistoricalTrendPoint(hoursOffset=off, label=label, value=round(min(100.0, health_index - rate * off), 1)))
            hist_r.append(HistoricalTrendPoint(hoursOffset=off, label=label, value=round(med - off, 1)))

        stress = self._stress(frame, nominal)
        # Subsystem degradation: severity (100 - health) split by TreeSHAP sensor-group share
        share = {a["group"]: a["importance_pct"] / 100.0 for a in attributions if a["direction"] == "increases_risk"}
        deg = 100.0 - health_index
        sub = lambda *groups: float(round(min(100.0, deg * sum(share.get(g, 0.0) for g in groups)), 1))
        subsystems = SubsystemDegradation(
            thermal=sub("cht", "coolant", "oil_temp"), mechanical=sub("vibration"),
            lubrication=sub("oil_pressure"), combustion=sub("egt", "lambda", "map"),
            fuel=sub("fuel_flow"), electrical=sub("electrical"),
        )

        return PrognosticsResult(
            rulHours=round(med, 1),
            rulHoursLower95=round(lo, 1),
            rulHoursUpper95=round(hi, 1),
            degradationRatePercentPerHour=round(rate, 3),
            healthIndexScore=health_index,
            engineDegradationIndex=edi,
            degradationTrend=trend,
            confidencePct=round(confidence * 100.0, 1),
            trajectory=trajectory,
            historicalHealthPoints=hist_h,
            historicalRulPoints=hist_r,
            stressBreakdown=stress,
            subsystemDegradation=subsystems,
            overhaulThresholdHours=BASE_TBO_HOURS,
            missionMarginHours=round(med - mission_demand_hours, 2),
            changePointHoursAgo=change_point_hours_ago,
            failureRiskScore=risk_score,
            failureRiskLevel=level,
            multiHorizonRisk=multi,
            outOfDistribution=out_of_distribution,
        )
