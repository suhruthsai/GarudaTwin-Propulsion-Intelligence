"""
Physics-Informed Feature Engineering
====================================
Features are residuals between measured sensors and a golden-twin nominal model that
depends only on measured quantities — operating point (throttle, RPM), air data (ambient
pressure, OAT) and the measured electrical load / battery state — with first-order thermal
lag so transients are not mistaken for faults. Rolling statistics over the
last ROLLING_WINDOW samples capture oscillatory signatures (e.g. oil-pump cavitation).

No feature is derived from a health score or fault label.

GoldenTwin mirrors src/engine/EngineSimulator.js (GoldenTwin) — keep them in sync;
tests/test_health_rul.py::test_golden_twin_parity checks this against the JS output.
"""

import math
from collections import deque
from typing import Dict, Any, List, Tuple, Optional
import numpy as np

from ..config.config import ROLLING_WINDOW, CYLINDERS, REF_AMBIENT_PRESSURE, REF_OAT

# Mirror of PHYS in src/engine/EngineSimulator.js (engineering assumptions, not Rotax data)
PHYS = {
    "P0_BAR": 1.01325, "T0_K": 288.15, "PR_MAX": 3.0, "COOLING_EXP": 0.8,
    "EGT_PER_OAT": 0.6, "EGT_PER_POWER_LOSS": 40.0, "LAMBDA_TARGET": 0.94,
    "INJ_FLOW_MM3_PER_MS": 3.33, "INJ_DEAD_MS": 0.8,
    "ALT_MAX_A": 70.0, "BATT_R_OHM": 0.05, "BUS_SET_V": 28.4,
}


def _density_ratio(p_bar: float, oat_c: float) -> float:
    return (p_bar / PHYS["P0_BAR"]) * (PHYS["T0_K"] / (oat_c + 273.15))


_REF_SIGMA = _density_ratio(REF_AMBIENT_PRESSURE, REF_OAT)


def ambient_factors(throttle: float, p_bar: float, oat_c: float) -> Dict[str, float]:
    map_target = 1.42 + (throttle - 78.5) * 0.015
    map_avail = p_bar * PHYS["PR_MAX"]
    map_ = min(map_target, map_avail)
    pf = map_ / map_target
    cf = (_REF_SIGMA / _density_ratio(p_bar, oat_c)) ** PHYS["COOLING_EXP"]
    return {"map": map_, "pf": pf, "cf": cf, "d_oat": oat_c - REF_OAT}


def thermal_targets(throttle: float, rpm: float, p_bar: float, oat_c: float) -> Dict[str, float]:
    a = ambient_factors(throttle, p_bar, oat_c)
    scale = lambda cal: oat_c + (cal - REF_OAT) * a["cf"] * a["pf"]  # noqa: E731
    return {
        "egt": 840.0 + (throttle - 78.5) * 1.8 + (rpm - 4800.0) * 0.03 + PHYS["EGT_PER_OAT"] * a["d_oat"]
               - PHYS["EGT_PER_POWER_LOSS"] * (1 - a["pf"]),
        "cht": scale(106.0 + (throttle - 78.5) * 0.6),
        "oil_temp": scale(98.0 + (throttle - 78.5) * 0.25),
        "coolant_temp": scale(88.5),
        **a,
    }


def nominal_fuel_lph(throttle: float, pf: float) -> float:
    return (26.0 + (throttle - 78.5) * 0.4) * pf


def inj_pulse_ms(fuel_lph: float, rpm: float) -> float:
    mm3 = (fuel_lph / 4.0) / (max(rpm, 500.0) / 2.0 * 60.0) * 1e6
    return mm3 / PHYS["INJ_FLOW_MM3_PER_MS"] + PHYS["INJ_DEAD_MS"]


def charge_request_a(soc: float) -> float:
    return max(0.3, min(8.0, 0.3 + 40.0 * (1.0 - soc)))


def electrical_state(rpm: float, load_a: float, soc: float) -> Dict[str, float]:
    cap = PHYS["ALT_MAX_A"] * max(0.0, min(1.0, (rpm - 1500.0) / 1500.0))
    req = charge_request_a(soc)
    ocv = 23.6 + 1.8 * soc
    if cap >= load_a + req:
        return {"i_bat": req, "v_bus": PHYS["BUS_SET_V"]}
    if cap >= load_a:
        i_bat = cap - load_a
        return {"i_bat": i_bat, "v_bus": ocv + (PHYS["BUS_SET_V"] - ocv) * (i_bat / req)}
    i_bat = cap - load_a
    return {"i_bat": i_bat, "v_bus": ocv + i_bat * PHYS["BATT_R_OHM"]}


class GoldenTwin:
    """Nominal engine model driven by measured operating point, air data and electrical load."""
    K = {"egt": 0.8, "cht": 0.05, "oil_temp": 0.02, "coolant_temp": 0.05}

    def __init__(self):
        self.state: Optional[Dict[str, float]] = None

    def reset(self):
        self.state = None

    @staticmethod
    def targets(throttle: float, rpm: float, p_bar: float = REF_AMBIENT_PRESSURE, oat_c: float = REF_OAT) -> Dict[str, float]:
        return thermal_targets(throttle, rpm, p_bar, oat_c)

    def update(self, frame: Dict[str, Any], dt: float) -> Dict[str, float]:
        throttle, rpm = frame["throttle"], frame["rpm"]
        p_bar = frame.get("ambient_pressure") or REF_AMBIENT_PRESSURE
        oat_c = frame.get("oat") if frame.get("oat") is not None else REF_OAT
        tgt = self.targets(throttle, rpm, p_bar, oat_c)
        if self.state is None:
            self.state = {k: tgt[k] for k in self.K}
        else:
            for k, rate in self.K.items():
                self.state[k] += (1.0 - math.exp(-rate * dt)) * (tgt[k] - self.state[k])
        # Electrical: load observable as alternator current - battery current
        i_alt, i_bat = frame.get("gen_current"), frame.get("battery_current")
        soc = (frame.get("battery_soc") if frame.get("battery_soc") is not None else 98.0) / 100.0
        es = electrical_state(rpm, (i_alt - i_bat) if (i_alt is not None and i_bat is not None) else 40.0, soc)
        fuel = nominal_fuel_lph(throttle, tgt["pf"])
        return {
            "egt": self.state["egt"],
            "cht": self.state["cht"],
            "oil_temp": self.state["oil_temp"],
            "oil_pressure": 3.85 - (self.state["oil_temp"] - 98.0) * 0.015,
            "map_bar": tgt["map"],
            "vibration": 0.28 + ((rpm - 4800.0) / 5800.0) * 0.12,
            "fuel_flow": fuel,
            "inj_pw": inj_pulse_ms(fuel, rpm),
            "fuel_trim": 0.0,
            "lambda": PHYS["LAMBDA_TARGET"],
            "gen_voltage": es["v_bus"],
            "battery_current": es["i_bat"],
            "coolant_temp": self.state["coolant_temp"],
        }


# Per-sample residual features
BASE_FEATURES: List[str] = [
    "egt_res_mean", "egt_spread", "cht_res_mean", "cht_spread",
    "map_res", "oil_press_res", "oil_temp_res", "vib_res",
    "fuel_flow_res", "lambda_res", "gen_v_res", "batt_i_res", "coolant_res",
    # cold-cylinder imbalance (misfire: one cylinder stops producing heat) and crank-speed jitter
    "egt_cold_spread", "cht_cold_spread", "rpm_step",
    # ECU injection: injection time vs nominal (%) and closed-loop fuel trim (%)
    "inj_pw_res_pct", "fuel_trim_res",
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
        "gen_v_res": "electrical", "batt_i_res": "electrical", "coolant_res": "coolant",
        "egt_cold_spread": "egt", "cht_cold_spread": "cht", "rpm_step": "rpm",
        "inj_pw_res_pct": "injection", "fuel_trim_res": "injection",
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
        nom = self.twin.update(frame, dt)

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
            "batt_i_res": res("battery_current"),
            "coolant_res": res("coolant_temp"),
            "inj_pw_res_pct": 0.0 if frame.get("inj_pw") is None else 100.0 * (frame["inj_pw"] - nom["inj_pw"]) / nom["inj_pw"],
            "fuel_trim_res": res("fuel_trim"),
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
