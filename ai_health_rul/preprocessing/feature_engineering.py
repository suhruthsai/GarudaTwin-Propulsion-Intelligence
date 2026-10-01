"""
Physics-Informed Feature Engineering
====================================
Features are residuals between measured sensors and a golden-twin nominal model that
depends only on the measured operating point (throttle, RPM), with first-order thermal
lag so throttle transients are not mistaken for faults. Rolling statistics over the
last ROLLING_WINDOW samples capture oscillatory signatures (e.g. oil-pump cavitation).

No feature is derived from a health score or fault label.

GoldenTwin mirrors src/engine/EngineSimulator.js (GoldenTwin) — keep them in sync;
tests/test_health_rul.py::test_golden_twin_parity checks this against the JS output.
"""

import math
from collections import deque
from typing import Dict, Any, List, Tuple, Optional
import numpy as np

from ..config.config import ROLLING_WINDOW, CYLINDERS


class GoldenTwin:
    """Nominal engine model driven by measured throttle and RPM only."""
    K = {"egt": 0.8, "cht": 0.05, "oil_temp": 0.02}

    def __init__(self):
        self.state: Optional[Dict[str, float]] = None

    def reset(self):
        self.state = None

    @staticmethod
    def targets(throttle: float, rpm: float) -> Dict[str, float]:
        return {
            "egt": 840.0 + (throttle - 78.5) * 1.8 + (rpm - 4800.0) * 0.03,
            "cht": 106.0 + (throttle - 78.5) * 0.6,
            "oil_temp": 98.0 + (throttle - 78.5) * 0.25,
        }

    def update(self, throttle: float, rpm: float, dt: float) -> Dict[str, float]:
        tgt = self.targets(throttle, rpm)
        if self.state is None:
            self.state = dict(tgt)
        else:
            for k, rate in self.K.items():
                self.state[k] += (1.0 - math.exp(-rate * dt)) * (tgt[k] - self.state[k])
        return {
            "egt": self.state["egt"],
            "cht": self.state["cht"],
            "oil_temp": self.state["oil_temp"],
            "oil_pressure": 3.85 - (self.state["oil_temp"] - 98.0) * 0.015,
            "map_bar": 1.42 + (throttle - 78.5) * 0.015,
            "vibration": 0.28 + ((rpm - 4800.0) / 5800.0) * 0.12,
            "fuel_flow": 26.0 + (throttle - 78.5) * 0.4,
            "lambda": 0.94,
            "gen_voltage": 28.4,
            "gen_current": 45.2,
            "coolant_temp": 88.5,
        }


# Per-sample residual features
BASE_FEATURES: List[str] = [
    "egt_res_mean", "egt_spread", "cht_res_mean", "cht_spread",
    "map_res", "oil_press_res", "oil_temp_res", "vib_res",
    "fuel_flow_res", "lambda_res", "gen_v_res", "gen_i_res", "coolant_res",
    # cold-cylinder imbalance (misfire: one cylinder stops producing heat) and crank-speed jitter
    "egt_cold_spread", "cht_cold_spread", "rpm_step",
]
# Rolling-std features (oscillation / instability signatures)
STD_FEATURES: List[str] = ["egt_spread", "oil_press_res", "vib_res", "map_res", "oil_temp_res", "lambda_res",
                           "egt_res_mean", "egt_cold_spread", "rpm_step"]
# Sensor noise floor: median rolling std of each channel in nominal simulator operation.
# Rolling std is clipped to at least this value (training and inference alike), so
# noise-free inputs (hand-entered sandbox values, single frames) look like ordinary
# nominal telemetry instead of an out-of-distribution "zero noise" state. Being quieter
# than normal is not a fault signature, so no fault information is lost.
STD_NOISE_FLOOR: Dict[str, float] = {
    "egt_spread": 0.70, "oil_press_res": 0.018, "vib_res": 0.0071,
    "map_res": 0.0046, "oil_temp_res": 0.093, "lambda_res": 0.0027,
    # measured by training/measure_noise_floor.py (median nominal rolling std)
    "egt_res_mean": 0.60, "egt_cold_spread": 0.69, "rpm_step": 5.52,
}

FEATURE_NAMES: List[str] = (
    BASE_FEATURES
    + [f"{f}_rmean" for f in BASE_FEATURES]
    + [f"{f}_rstd" for f in STD_FEATURES]
)

# Sensor group for each feature (used to aggregate TreeSHAP into human-readable attributions)
FEATURE_GROUP: Dict[str, str] = {}
for _f in FEATURE_NAMES:
    base = _f.replace("_rmean", "").replace("_rstd", "")
    FEATURE_GROUP[_f] = {
        "egt_res_mean": "egt", "egt_spread": "egt", "cht_res_mean": "cht", "cht_spread": "cht",
        "map_res": "map", "oil_press_res": "oil_pressure", "oil_temp_res": "oil_temp",
        "vib_res": "vibration", "fuel_flow_res": "fuel_flow", "lambda_res": "lambda",
        "gen_v_res": "electrical", "gen_i_res": "electrical", "coolant_res": "coolant",
        "egt_cold_spread": "egt", "cht_cold_spread": "cht", "rpm_step": "rpm",
    }[base]


def _spread(res: List[float]) -> float:
    """Cylinder imbalance: hottest cylinder vs median (cylinder-agnostic)."""
    return float(max(res) - np.median(res))


def _cold_spread(res: List[float]) -> float:
    """Cylinder imbalance: median vs coldest cylinder (a non-firing cylinder runs cold)."""
    return float(np.median(res) - min(res))


class FeatureExtractor:
    """Stateful per-engine feature extractor (golden twin + rolling window)."""

    def __init__(self, window: int = ROLLING_WINDOW):
        self.twin = GoldenTwin()
        self.buf: deque = deque(maxlen=window)
        self.prev_rpm: Optional[float] = None

    def reset(self):
        self.twin.reset()
        self.buf.clear()
        self.prev_rpm = None

    def update(self, frame: Dict[str, Any], dt: float) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        frame: canonical cleaned frame (None = missing channel -> imputed as nominal).
        Returns (feature vector ordered as FEATURE_NAMES, context with nominal/residuals).
        """
        nom = self.twin.update(frame["throttle"], frame["rpm"], dt)

        def res(ch: str) -> float:
            v = frame.get(ch)
            return 0.0 if v is None else float(v) - nom[ch]

        egt = frame.get("egt") or [nom["egt"]] * CYLINDERS
        cht = frame.get("cht") or [nom["cht"]] * CYLINDERS
        egt_res = [v - nom["egt"] for v in egt]
        cht_res = [v - nom["cht"] for v in cht]

        base = {
            "egt_res_mean": float(np.mean(egt_res)),
            "egt_spread": _spread(egt_res),
            "cht_res_mean": float(np.mean(cht_res)),
            "cht_spread": _spread(cht_res),
            "map_res": res("map_bar"),
            "oil_press_res": res("oil_pressure"),
            "oil_temp_res": res("oil_temp"),
            "vib_res": res("vibration"),
            "fuel_flow_res": res("fuel_flow"),
            "lambda_res": res("lambda"),
            "gen_v_res": res("gen_voltage"),
            "gen_i_res": res("gen_current"),
            "coolant_res": res("coolant_temp"),
            "egt_cold_spread": _cold_spread(egt_res),
            "cht_cold_spread": _cold_spread(cht_res),
            # sample-to-sample RPM change: its rolling std measures crank-speed jitter
            "rpm_step": 0.0 if self.prev_rpm is None else float(frame["rpm"]) - self.prev_rpm,
        }
        self.prev_rpm = float(frame["rpm"])
        self.buf.append([base[f] for f in BASE_FEATURES])
        win = np.asarray(self.buf, dtype=np.float64)
        rmean = win.mean(axis=0)
        rstd = win.std(axis=0)
        idx = {f: i for i, f in enumerate(BASE_FEATURES)}

        vec = np.concatenate([
            [base[f] for f in BASE_FEATURES],
            rmean,
            [max(rstd[idx[f]], STD_NOISE_FLOOR[f]) for f in STD_FEATURES],
        ]).astype(np.float32)

        context = {
            "nominal": nom,
            "egt_res": egt_res,
            "cht_res": cht_res,
            "hottest_egt_cyl": int(np.argmax(egt_res)) + 1,
            "hottest_cht_cyl": int(np.argmax(cht_res)) + 1,
            "coldest_egt_cyl": int(np.argmin(egt_res)) + 1,
            "coldest_cht_cyl": int(np.argmin(cht_res)) + 1,
            "base": base,
            "rstd": {f: float(rstd[idx[f]]) for f in STD_FEATURES},
        }
        return vec, context
