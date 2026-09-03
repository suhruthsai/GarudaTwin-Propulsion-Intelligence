"""
AI Health & RUL Configuration Module
Manages model paths, sensor parameters, default thresholds, and feature dimensions.
"""

from pathlib import Path
from typing import List

# Base Paths
MODULE_ROOT = Path(__file__).parent.parent.resolve()
MODEL_DIR = MODULE_ROOT / "models"

# Model Artifact Filenames
ISOLATION_FOREST_FILE = "isolation_forest.pkl"
SCALER_FILE = "scaler_anomaly.pkl"
FAULT_CLASSIFIER_FILE = "fault_classifier.pkl"
LABEL_ENCODER_FILE = "label_encoder.pkl"
RUL_REGRESSOR_FILE = "rul_regressor.pkl"
FEATURE_COLS_FILE = "model_feature_cols.json"
ANOMALY_FEATURE_COLS_FILE = "anomaly_feature_cols.json"

# Canonical Telemetry Sensors Expected by Feature Engineering
SENSOR_COLS: List[str] = [
    "rpm",
    "true_cht",
    "sensor_cht",
    "egt",
    "oil_pressure",
    "oil_temp",
    "fuel_flow",
    "vibration",
    "battery_voltage",
    "injection_timing",
    "health_index",
    "altitude",
    "ambient_temp",
    "throttle",
]

# Rolling Window Window Sizes (in Timesteps)
ROLLING_WINDOWS: List[int] = [30, 60]

# Operational Thresholds & Physics Baselines
BASE_TBO_HOURS: float = 2000.0          # Rotax 915/916 iS Time Between Overhaul
MEL_THRESHOLD_SCORE: float = 50.0        # Minimum Equipment List health threshold (50%)
MIN_SAFE_RUL_HOURS: float = 2.0          # Safe Emergency Recovery Margin (Hours)
ANOMALY_THRESHOLD: float = 0.085         # Isolation Forest / MSE Anomaly Cutoff

# Default Nominal Engine Baselines
NOMINAL_DEFAULTS = {
    "rpm": 4800.0,
    "true_cht": 106.0,
    "sensor_cht": 106.0,
    "egt": 840.0,
    "oil_pressure": 3.85,
    "oil_temp": 98.0,
    "fuel_flow": 26.0,
    "vibration": 0.28,
    "battery_voltage": 28.4,
    "injection_timing": 18.5,
    "health_index": 0.98,
    "altitude": 14500.0,
    "ambient_temp": -12.5,
    "throttle": 78.5,
}
