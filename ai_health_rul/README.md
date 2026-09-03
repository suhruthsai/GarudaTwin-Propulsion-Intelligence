# AI Health & Remaining Useful Life (RUL) Module

## Overview
This module provides a production-grade, self-contained AI Health Monitoring and Remaining Useful Life (RUL) prediction architecture for MALE (Medium-Altitude Long-Endurance) UAV propulsion systems.

It combines machine learning models (Isolation Forest, StandardScaler, Fault Classifiers, RUL Regressor) with first-principles Rotax 915/916 iS engine thermodynamics, TreeSHAP explainability, and Adaptive Pilot Advisories.

---

## Directory Structure

```text
ai_health_rul/
│
├── models/                     # Trained ML models and feature definitions
│   ├── isolation_forest.pkl
│   ├── scaler_anomaly.pkl
│   ├── fault_classifier.pkl
│   ├── label_encoder.pkl
│   ├── rul_regressor.pkl
│   ├── model_feature_cols.json
│   └── anomaly_feature_cols.json
│
├── preprocessing/              # Data validation & rolling window transforms
│   ├── validation.py           # DataQualityGuard (Missing values, outliers, rate limits)
│   └── feature_engineering.py  # RollingFeatureExtractor (30s & 60s window statistics)
│
├── inference/                  # Scikit-learn ML inference engines
│   ├── health_predictor.py     # Isolation Forest & Fault Classification
│   └── rul_predictor.py        # RUL Regression & 50-hour trajectory forecaster
│
├── services/                   # High-level unified service interface
│   └── health_rul_service.py   # HealthRulService (predict, explain, advisory)
│
├── schemas/                    # Pydantic data models
│   └── health_rul_schema.py
│
├── config/                     # System configuration & threshold limits
│   └── config.py
│
├── utils/                      # Utilities & monitoring
│   └── performance_monitor.py  # Latency tracking across pipeline stages
│
├── tests/                      # Pytest unit & integration test suite
│   └── test_health_rul.py
│
└── README.md                   # System documentation
```

---

## Usage

```python
from ai_health_rul.services.health_rul_service import HealthRulService

service = HealthRulService()

telemetry_frame = {
    "timestamp_s": 120.0,
    "rpm": 4850.0,
    "true_cht": 107.5,
    "sensor_cht": 107.5,
    "egt": 842.0,
    "oil_pressure": 3.85,
    "oil_temp": 98.4,
    "fuel_flow": 26.4,
    "vibration": 0.28,
    "battery_voltage": 28.4,
    "injection_timing": 18.5,
    "health_index": 0.98,
    "altitude": 14500.0,
    "ambient_temp": -12.5,
    "throttle": 78.5
}

response = service.predict(telemetry_frame)

print(f"Health Score: {response.rul.healthIndexScore}")
print(f"Diagnosed Fault: {response.health.diagnosed_fault}")
print(f"RUL Hours: {response.rul.rulHours} hours")
print(f"Pilot Advisory Level: {response.advisory.level}")
```

---

## Testing

Run the test suite using `pytest`:

```bash
python -m pytest ai_health_rul/tests/
```
