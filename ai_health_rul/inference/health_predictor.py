"""
Health Predictor Inference Module
Loads the Mahalanobis residual anomaly detector, XGBoost fault classifier and XGBoost severity
regressor trained by training/train_models.py, and produces anomaly score, diagnosis,
health index and TreeSHAP attributions from physics-residual features.

Inputs are features only — there is no health score or fault label among them.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List

import numpy as np
import xgboost as xgb

from ..config.config import (
    MODEL_DIR, ANOMALY_DETECTOR_FILE, FAULT_CLASSIFIER_FILE, ROLLING_WINDOW,
    SEVERITY_REGRESSOR_FILE, MODEL_CARD_FILE, ANOMALY_THRESHOLD, FAULT_CLASSES,
)
from ..preprocessing.feature_engineering import FEATURE_NAMES, FEATURE_GROUP
from ..schemas.health_rul_schema import HealthPredictionResult
from .decision import decide, persist, latch, severity_level

GROUP_LABELS = {
    "egt": "Exhaust Gas Temperature (EGT)",
    "cht": "Cylinder Head Temp (CHT)",
    "map": "Manifold Pressure (MAP)",
    "oil_pressure": "Oil Pressure",
    "oil_temp": "Oil Temperature",
    "vibration": "Engine Vibration (g-RMS)",
    "fuel_flow": "Fuel Flow",
    "lambda": "Mixture (Lambda)",
    "electrical": "Generator / Bus Voltage",
    "coolant": "Coolant Temperature",
    "rpm": "Engine Speed Stability (RPM)",
}


class HealthPredictor:
    """Anomaly detection, fault classification and health index from residual features."""

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir) if model_dir else MODEL_DIR
        self.models_loaded = False
        self._load_models()

    def _load_models(self):
        try:
            det = np.load(self.model_dir / ANOMALY_DETECTOR_FILE)
            self.det_mean, self.det_std = det["feature_mean"], det["feature_std"]
            self.det_loc, self.det_prec = det["location"], det["precision"]
            self.clf = xgb.Booster(model_file=str(self.model_dir / FAULT_CLASSIFIER_FILE))
            self.sreg = xgb.Booster(model_file=str(self.model_dir / SEVERITY_REGRESSOR_FILE))
            with open(self.model_dir / MODEL_CARD_FILE) as f:
                self.card = json.load(f)
            if self.card["features"] != FEATURE_NAMES:
                raise ValueError("model_card features do not match FEATURE_NAMES — retrain the models")
            cal = self.card["anomaly_calibration"]
            self.thr, self.p50 = float(cal["threshold"]), float(cal["nominal_median"])
            self.range_lo = np.asarray(self.card["feature_ranges"]["low"])
            self.range_hi = np.asarray(self.card["feature_ranges"]["high"])
            self.models_loaded = True
        except Exception as e:
            print(f"[ERROR] HealthPredictor failed to load models from {self.model_dir}: {e}")
            self.models_loaded = False

    def _attributions(self, contribs: np.ndarray, top: int = 5) -> List[Dict[str, Any]]:
        """Aggregate per-feature TreeSHAP values into sensor groups (% of total |SHAP|)."""
        groups: Dict[str, float] = {}
        for name, v in zip(FEATURE_NAMES, contribs[:-1]):  # last column is the bias term
            groups[FEATURE_GROUP[name]] = groups.get(FEATURE_GROUP[name], 0.0) + float(v)
        total = sum(abs(v) for v in groups.values()) or 1.0
        ranked = sorted(groups.items(), key=lambda kv: abs(kv[1]), reverse=True)[:top]
        return [
            {"group": g, "feature": GROUP_LABELS[g], "importance_pct": round(abs(v) / total * 100.0, 1),
             "direction": "increases_risk" if v > 0 else "normalizing", "shap": v}
            for g, v in ranked
        ]

    def anomaly_distance(self, vec: np.ndarray) -> float:
        """Mahalanobis distance of the standardised residual vector from the nominal distribution."""
        d = (vec - self.det_mean) / self.det_std - self.det_loc
        return float(np.sqrt(d @ self.det_prec @ d))

    def predict(self, vec: np.ndarray, prev_raw_anomaly: bool = False,
                prev_raw_diagnosis: str = "NONE", last_known: str = "NONE",
                samples_since_known: int = 10 ** 6) -> Tuple[HealthPredictionResult, Dict[str, Any]]:
        """
        prev_raw_anomaly: whether the previous sample of this vehicle exceeded the threshold.
        An anomaly is reported only when two consecutive samples exceed it (same rule as training eval).
        """
        if not self.models_loaded:
            self._load_models()
        if not self.models_loaded:
            raise RuntimeError("AI health models are not available — run training/train_models.py")

        x = vec.reshape(1, -1)
        # 1. Unsupervised anomaly detector (fitted on nominal data only)
        s = self.anomaly_distance(vec)
        anomaly_score = float(np.clip((s - self.p50) / (2.0 * (self.thr - self.p50)), 0.0, 1.0))
        raw_anomaly = s > self.thr
        is_anomaly = raw_anomaly and prev_raw_anomaly

        # 2. Fault classifier + shared decision rule (saved boosters contain only best-iteration trees)
        probs = self.clf.inplace_predict(x)[0]
        raw_diagnosis, confidence = decide(probs, is_anomaly)
        diagnosis = persist(raw_diagnosis, prev_raw_diagnosis)  # same rules as the training evaluation
        diagnosis, last_known, samples_since_known = latch(diagnosis, last_known, samples_since_known, ROLLING_WINDOW)
        if diagnosis == "NONE":
            confidence = float(probs[0])

        # 3. Severity regressor -> health index
        severity = float(np.clip(self.sreg.inplace_predict(x)[0], 0.0, 1.0))
        health = round(100.0 * (1.0 - severity), 1)

        # 4. TreeSHAP on the classifier: evidence FOR the diagnosed class, or evidence AGAINST
        #    "NONE" (negated) when the engine is nominal or the anomaly is unclassified
        contribs_all = self.clf.predict(xgb.DMatrix(x, feature_names=FEATURE_NAMES), pred_contribs=True)[0]
        if diagnosis in FAULT_CLASSES and diagnosis != "NONE":
            contribs = contribs_all[FAULT_CLASSES.index(diagnosis)]
        else:
            contribs = -contribs_all[0]

        ood = [FEATURE_NAMES[i] for i in np.flatnonzero((vec < self.range_lo) | (vec > self.range_hi))]

        result = HealthPredictionResult(
            is_anomaly=bool(is_anomaly),
            anomaly_score=round(anomaly_score, 4),
            reconstruction_mse=round(s, 6),   # raw Mahalanobis distance
            threshold=ANOMALY_THRESHOLD,
            confidence_pct=round(confidence * 100.0, 1),
            diagnosed_fault=diagnosis,
            severity_level=severity_level(diagnosis, health),
            class_probabilities={c: round(float(p), 4) for c, p in zip(FAULT_CLASSES, probs)},
        )
        extras = {
            "severity": severity,
            "health_index": health,
            "attributions": self._attributions(contribs),
            "ood_features": ood,
            "confidence": confidence,
            "raw_anomaly": bool(raw_anomaly),
            "raw_diagnosis": raw_diagnosis,
            "last_known": last_known,
            "samples_since_known": samples_since_known,
        }
        return result, extras
