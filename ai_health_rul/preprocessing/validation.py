"""
Data Quality Guard & Preprocessing Validation Module
Parses heterogeneous telemetry payloads into canonical channels, checks physical bounds,
suppresses single-sample sensor glitches and marks missing channels for imputation.

The same guard runs during training (training/train_models.py) and live inference,
so both see identically cleaned data.
"""

import math
from typing import Dict, Any, List, Optional
import numpy as np

from ..config.config import SCALAR_CHANNELS, ARRAY_CHANNELS, CYLINDERS, NOMINAL_OPERATING_POINT
from ..schemas.health_rul_schema import DataQualitySummary

# Alternative key names used by the different UI payloads (live stream, sandbox, legacy)
ALIASES: Dict[str, List[str]] = {
    "rpm": ["rpm"],
    "throttle": ["throttle", "throttle_pct", "throttlePct"],
    "map_bar": ["map_bar", "mapBar", "boost_map"],
    "oil_pressure": ["oil_pressure", "oil_press_bar", "oilPressBar"],
    "oil_temp": ["oil_temp", "oil_temp_c", "oilTempC"],
    "vibration": ["vibration", "vibration_grms", "vibrationGrms"],
    "fuel_flow": ["fuel_flow", "fuel_flow_lph", "fuelFlowLph"],
    "lambda": ["lambda"],
    "gen_voltage": ["gen_voltage", "gen_voltage_v", "genVoltageV", "battery_voltage"],
    "gen_current": ["gen_current", "gen_current_a", "genCurrentA"],
    "coolant_temp": ["coolant_temp", "coolant_temp_c", "coolantTempC"],
    "egt": ["egt", "egt_c"],
    "cht": ["cht", "true_cht", "sensor_cht"],
}


def _is_number(v: Any) -> bool:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return not (math.isnan(f) or math.isinf(f))


class DataQualityGuard:
    """
    Guards the ML pipeline against bad sensor data, missing channels, single-sample
    spikes and out-of-range physical readings.
    """

    # Physical operating boundaries for Rotax 915/916 iS engine parameters
    PHYSICAL_BOUNDS = {
        "rpm": (1500.0, 6200.0),
        "throttle": (0.0, 100.0),
        "egt": (400.0, 1050.0),
        "cht": (20.0, 200.0),
        "map_bar": (0.5, 2.5),
        "oil_pressure": (0.5, 7.0),
        "oil_temp": (20.0, 160.0),
        "vibration": (0.05, 5.0),
        "fuel_flow": (2.0, 60.0),
        "lambda": (0.6, 1.5),
        "gen_voltage": (18.0, 32.0),
        "gen_current": (0.0, 120.0),
        "coolant_temp": (20.0, 140.0),
    }

    # Maximum plausible change per second. Generous enough not to clip legitimate
    # rapid throttle transitions; only catches single-sample sensor glitches.
    MAX_RATE_OF_CHANGE = {
        "rpm": 4000.0,
        "throttle": 1000.0,
        "egt": 250.0,
        "cht": 30.0,
        "map_bar": 1.5,
        "oil_pressure": 5.0,
        "oil_temp": 10.0,
        "vibration": 4.0,
        "fuel_flow": 60.0,
        "lambda": 0.5,
        "gen_voltage": 8.0,
        "gen_current": 60.0,
        "coolant_temp": 15.0,
    }

    # Consecutive identical readings after which a sensor is declared stuck (failed).
    # A live sensor always shows noise, so long exact repeats mean a frozen or dead channel.
    # Values = 2 x the longest identical run observed per channel in healthy simulator data
    # (training/measure_noise_floor.py). Fuel flow and generator voltage/current are quantised or
    # deterministic in the simulator (identical repeats are normal), so they are not checked.
    STUCK_SAMPLES: Dict[str, int] = {
        # measured longest healthy run -> threshold:  egt 3->6, cht 6->12, oil_temp 13->26,
        # oil_pressure 9->18, coolant 7->14, map 3->6, vibration 5->10, lambda 6->12, rpm 2->6, gen_current 1->6
        "egt": 6, "cht": 12, "oil_temp": 26, "oil_pressure": 18, "coolant_temp": 14,
        "map_bar": 6, "vibration": 10, "lambda": 12, "rpm": 6, "gen_current": 6,
    }

    # Transducer full-scale limits (match the simulator's sensor ranges). A reading pinned at a
    # limit is saturated — a genuine extreme value — so it never counts towards "stuck".
    SENSOR_FULL_SCALE: Dict[str, tuple] = {
        "rpm": (2000.0, 5800.0), "oil_temp": (50.0, 150.0), "oil_pressure": (0.5, 6.0),
        "vibration": (0.08, 3.5), "map_bar": (0.6, 2.4),
    }

    def __init__(self):
        self.reset()

    def reset(self):
        """Clears the last-valid frame used for rate checks, imputation and stuck detection."""
        self._last: Dict[str, Any] = {}
        self._prev_raw: Dict[str, float] = {}
        self._repeats: Dict[str, int] = {}

    def _is_stuck(self, key: str, channel: str, raw: float) -> bool:
        """True once `raw` has repeated exactly for STUCK_SAMPLES[channel] consecutive samples."""
        limit = self.STUCK_SAMPLES.get(channel)
        if limit is None:
            return False
        lo, hi = self.SENSOR_FULL_SCALE.get(channel, (-math.inf, math.inf))
        if raw <= lo or raw >= hi:  # saturated, not frozen
            self._repeats[key] = 0
            self._prev_raw[key] = raw
            return False
        self._repeats[key] = self._repeats.get(key, 0) + 1 if self._prev_raw.get(key) == raw else 0
        self._prev_raw[key] = raw
        return self._repeats[key] >= limit

    @staticmethod
    def parse(raw: Dict[str, Any]) -> Dict[str, Any]:
        """Resolves key aliases. Arrays (egt/cht) become 4-element lists; scalars are replicated."""
        out: Dict[str, Any] = {}
        for ch, keys in ALIASES.items():
            val = next((raw[k] for k in keys if k in raw and raw[k] is not None), None)
            if ch in ARRAY_CHANNELS:
                if isinstance(val, (list, tuple)):
                    vals = [float(v) for v in val if _is_number(v)][:CYLINDERS]
                    if vals:
                        vals = vals + [float(np.mean(vals))] * (CYLINDERS - len(vals))
                        out[ch] = vals
                    else:
                        out[ch] = None
                elif _is_number(val):
                    out[ch] = [float(val)] * CYLINDERS
                else:
                    out[ch] = None
            else:
                out[ch] = float(val) if _is_number(val) else None
        return out

    def _clean_value(self, key: str, bound_key: str, val: float, dt: float, check_rate: bool, outliers: List[str]) -> float:
        lo, hi = self.PHYSICAL_BOUNDS[bound_key]
        if val < lo or val > hi:
            outliers.append(bound_key)
            val = max(lo, min(hi, val))
        last = self._last.get(key)
        if check_rate and last is not None and dt > 0:
            max_delta = self.MAX_RATE_OF_CHANGE[bound_key] * dt
            if abs(val - last) > max_delta:
                outliers.append(f"{bound_key}_spike")
                val = last + math.copysign(max_delta, val - last)
        self._last[key] = val
        return val

    def validate_and_clean_frame(
        self,
        raw_frame: Dict[str, Any],
        dt: float = 1.0,
        simulated_packet_loss: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Returns {"cleaned_frame": canonical dict (None = channel missing), "summary": DataQualitySummary}.
        Missing channels are left as None; the feature extractor imputes them with the
        golden-twin nominal value so they contribute zero residual.
        """
        parsed = self.parse(raw_frame)
        is_sandbox = bool(raw_frame.get("is_sandbox", False) or raw_frame.get("mode") in ("SANDBOX", "BENCHMARK"))
        packet_lost = simulated_packet_loss > 0.0 and np.random.random() < simulated_packet_loss

        cleaned: Dict[str, Any] = {}
        missing: List[str] = []
        imputed: List[str] = []
        outliers: List[str] = []
        failed: List[str] = []

        for ch in SCALAR_CHANNELS + ARRAY_CHANNELS:
            val = None if packet_lost else parsed.get(ch)
            if val is None:
                missing.append(ch)
                last = [self._last.get(f"{ch}{i}") for i in range(CYLINDERS)] if ch in ARRAY_CHANNELS else self._last.get(ch)
                if ch in ("rpm", "throttle"):
                    # Operating point is required by the golden twin: hold last value or loiter point
                    cleaned[ch] = last if last is not None else NOMINAL_OPERATING_POINT[ch]
                    imputed.append(ch)
                else:
                    cleaned[ch] = None
                continue
            if ch in ARRAY_CHANNELS:
                vals = [self._clean_value(f"{ch}{i}", ch, v, dt, not is_sandbox, outliers) for i, v in enumerate(val)]
                stuck = [not is_sandbox and self._is_stuck(f"{ch}{i}", ch, v) for i, v in enumerate(val)]
                healthy = [v for v, s in zip(vals, stuck) if not s]
                if any(stuck):
                    failed += [f"{ch}{i + 1}" for i, s in enumerate(stuck) if s]
                    # Cross-cylinder redundancy: a failed cylinder sensor reads the median of the others
                    vals = [float(np.median(healthy)) if s else v for v, s in zip(vals, stuck)] if healthy else None
                cleaned[ch] = vals
            else:
                cleaned[ch] = self._clean_value(ch, ch, val, dt, not is_sandbox, outliers)
                if not is_sandbox and self._is_stuck(ch, ch, val):
                    failed.append(ch)
                    if ch not in ("rpm", "throttle"):  # the operating point is always required
                        cleaned[ch] = None  # excluded; the feature extractor uses the golden-twin value

        summary = DataQualitySummary(
            valid=not outliers and not missing,
            missing_count=len(missing),
            imputed_fields=imputed + [m for m in missing if m not in imputed],
            outliers_detected=sorted(set(outliers)),
            packet_loss_simulated=packet_lost,
            failed_sensors=failed,
        )
        return {"cleaned_frame": cleaned, "summary": summary}
