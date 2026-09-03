"""
Data Quality Guard & Preprocessing Validation Module
Performs telemetry schema validation, physical boundary checking, outlier detection,
missing-value imputation, and rate-of-change limit enforcement.
"""

import math
from typing import Dict, Any, List, Optional
import numpy as np

from ..config.config import SENSOR_COLS, NOMINAL_DEFAULTS
from ..schemas.health_rul_schema import DataQualitySummary


class DataQualityGuard:
    """
    Guards ML model pipeline against bad sensor data, missing telemetry frames,
    transient spike noise, and out-of-range physical readings.
    """

    # Physical operating boundaries for Rotax 915/916 iS engine parameters
    PHYSICAL_BOUNDS = {
        "rpm": (1500.0, 6200.0),
        "true_cht": (20.0, 200.0),
        "sensor_cht": (20.0, 200.0),
        "egt": (400.0, 1050.0),
        "oil_pressure": (0.5, 7.0),
        "oil_temp": (20.0, 160.0),
        "fuel_flow": (2.0, 60.0),
        "vibration": (0.05, 5.0),
        "battery_voltage": (18.0, 32.0),
        "injection_timing": (5.0, 35.0),
        "health_index": (0.0, 1.0),
        "altitude": (-100.0, 35000.0),
        "ambient_temp": (-60.0, 60.0),
        "throttle": (0.0, 100.0),
    }

    # Maximum plausible physical change per second (rate-of-change limits)
    MAX_RATE_OF_CHANGE = {
        "rpm": 1200.0,          # 1200 RPM/s max acceleration
        "true_cht": 15.0,       # 15°C/s max thermal rate
        "sensor_cht": 15.0,
        "egt": 60.0,            # 60°C/s max EGT transient
        "oil_pressure": 2.5,    # 2.5 bar/s max delta
        "oil_temp": 5.0,        # 5°C/s max thermal inertia
        "fuel_flow": 12.0,
        "vibration": 1.5,
        "battery_voltage": 4.0,
        "injection_timing": 10.0,
        "health_index": 0.25,
        "altitude": 100.0,      # 100 m/s ascent rate (~20,000 fpm)
        "ambient_temp": 2.0,
        "throttle": 50.0,       # 50%/s throttle step
    }

    def __init__(self):
        self.reset()

    def reset(self):
        """Resets historical rolling buffer used for imputation and rate checking."""
        self._last_valid_frame: Dict[str, float] = NOMINAL_DEFAULTS.copy()

    def validate_and_clean_frame(
        self,
        raw_frame: Dict[str, Any],
        dt: float = 1.0,
        simulated_packet_loss: float = 0.0
    ) -> Dict[str, Any]:
        """
        Validates, cleans, and imputes a single incoming telemetry dictionary frame.
        
        Returns:
            {
                "cleaned_frame": Dict[str, float],
                "summary": DataQualitySummary
            }
        """
        cleaned: Dict[str, float] = {}
        missing_fields: List[str] = []
        imputed_fields: List[str] = []
        outliers_detected: List[str] = []

        # 1. Packet Loss Simulation (impute entire frame from last valid state if loss occurs)
        packet_lost = False
        if simulated_packet_loss > 0.0 and np.random.random() < simulated_packet_loss:
            packet_lost = True

        for col in SENSOR_COLS:
            val = raw_frame.get(col)
            # Support alternative naming keys from UI payloads
            if val is None:
                if col == "egt" and "egt_c" in raw_frame:
                    val = raw_frame["egt_c"]
                elif col == "true_cht" and "cht" in raw_frame:
                    val = raw_frame["cht"]
                elif col == "sensor_cht" and "cht" in raw_frame:
                    val = raw_frame["cht"]
                elif col == "altitude" and "altitude_ft" in raw_frame:
                    val = raw_frame["altitude_ft"]
                elif col == "throttle" and "throttle_pct" in raw_frame:
                    val = raw_frame["throttle_pct"]
                elif col == "oil_pressure" and "oil_press_bar" in raw_frame:
                    val = raw_frame["oil_press_bar"]
                elif col == "oil_temp" and "oil_temp_c" in raw_frame:
                    val = raw_frame["oil_temp_c"]
                elif col == "vibration" and "vibration_grms" in raw_frame:
                    val = raw_frame["vibration_grms"]
                elif col == "battery_voltage" and "gen_voltage_v" in raw_frame:
                    val = raw_frame["gen_voltage_v"]

            # If value is a list (e.g. egt=[842, 839, 844, 841] or cht=[106, 107, 105, 108]), take maximum or mean
            if isinstance(val, (list, tuple)):
                val = max(val) if len(val) > 0 else None

            # Check missing or NaN
            is_missing = (
                val is None
                or packet_lost
                or (isinstance(val, float) and math.isnan(val))
                or (isinstance(val, float) and math.isinf(val))
            )

            if is_missing:
                missing_fields.append(col)
                imputed_val = self._last_valid_frame.get(col, NOMINAL_DEFAULTS.get(col, 0.0))
                cleaned[col] = float(imputed_val)
                imputed_fields.append(col)
                continue

            val_float = float(val)
            min_b, max_b = self.PHYSICAL_BOUNDS.get(col, (-1e6, 1e6))

            # 2. Outlier / Out-of-bounds Check
            if val_float < min_b or val_float > max_b:
                outliers_detected.append(col)
                # Clamp to physical range
                val_float = max(min_b, min(max_b, val_float))

            # 3. Rate-of-change Spike Suppression
            last_val = self._last_valid_frame.get(col)
            if last_val is not None and dt > 0.0:
                max_rate = self.MAX_RATE_OF_CHANGE.get(col, 1e6)
                max_allowed_delta = max_rate * dt
                delta = abs(val_float - last_val)

                if delta > max_allowed_delta:
                    outliers_detected.append(f"{col}_spike")
                    # Smooth transient spike with 80% weight on prior valid state
                    val_float = last_val + math.copysign(max_allowed_delta, val_float - last_val)

            cleaned[col] = float(val_float)
            self._last_valid_frame[col] = cleaned[col]

        summary = DataQualitySummary(
            valid=len(outliers_detected) == 0 and len(missing_fields) == 0,
            missing_count=len(missing_fields),
            imputed_fields=imputed_fields,
            outliers_detected=outliers_detected,
            packet_loss_simulated=packet_lost
        )

        return {
            "cleaned_frame": cleaned,
            "summary": summary
        }
