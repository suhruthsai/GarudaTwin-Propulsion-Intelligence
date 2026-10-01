"""
AI Health & RUL Configuration Module
Manages model paths, sensor channels, thresholds and feature dimensions.
"""

from pathlib import Path
from typing import List

# Base Paths
MODULE_ROOT = Path(__file__).parent.parent.resolve()
MODEL_DIR = MODULE_ROOT / "models"

# Model Artifact Filenames (XGBoost models are stored as portable JSON, not pickles)
ANOMALY_DETECTOR_FILE = "anomaly_detector.npz"   # Mahalanobis residual detector (plain arrays)
FAULT_CLASSIFIER_FILE = "fault_classifier.json"
SEVERITY_REGRESSOR_FILE = "severity_regressor.json"
RUL_REGRESSOR_FILE = "rul_quantile_regressor.json"
MODEL_CARD_FILE = "model_card.json"
AUTOENCODER_FILE = "autoencoder.pt"

# Canonical sensor channels accepted by the pipeline.
# NOTE: there is deliberately no `health_index` input. Health is a model OUTPUT;
# feeding a health score in as a feature leaks the label into the model.
CYLINDERS = 4
SCALAR_CHANNELS: List[str] = [
    "rpm",
    "throttle",
    "map_bar",
    "oil_pressure",
    "oil_temp",
    "vibration",
    "fuel_flow",
    "lambda",
    "gen_voltage",
    "gen_current",
    "coolant_temp",
]
ARRAY_CHANNELS: List[str] = ["egt", "cht"]

# Rolling window length (samples at ~1 Hz)
ROLLING_WINDOW: int = 8

# Operational Thresholds & Physics Baselines
BASE_TBO_HOURS: float = 2000.0          # Rotax 915/916 iS Time Between Overhaul
MEL_THRESHOLD_SCORE: float = 50.0        # Minimum Equipment List health threshold (50%)
MIN_SAFE_RUL_HOURS: float = 0.1          # Floor for displayed RUL
ANOMALY_THRESHOLD: float = 0.5           # anomaly_score at the calibrated Mahalanobis threshold
FAULT_PROB_THRESHOLD: float = 0.5        # min classifier posterior to report a fault class

FAULT_CLASSES: List[str] = [
    "NONE", "CYL3_INJECTOR", "BLOW_BY", "OIL_PUMP_CAVITATION", "TURBO_WASTEGATE_STUCK",
    "COOLING_DEGRADATION", "GENERATOR_FAILURE", "PRGB_DEGRADATION",
    "MISFIRE", "COMBUSTION_INSTABILITY", "INJECTOR_COKING", "SENSOR_DRIFT",
]
# Measurement-chain faults: the engine itself is healthy (no health/RUL penalty).
# SENSOR_FAILURE (stuck sensor) comes from the data-quality layer, not the classifier.
SENSOR_FAULT_CLASSES = {"SENSOR_DRIFT", "SENSOR_FAILURE"}

# Nominal loiter operating point (used only to impute throttle/RPM when missing)
NOMINAL_OPERATING_POINT = {"rpm": 4800.0, "throttle": 78.5}
