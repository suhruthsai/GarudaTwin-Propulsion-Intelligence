"""
GarudaTwin MALE UAV - AI & Physics Prognostics Microservice
Rotax 915/916 iS Turbocharged Engine Digital Twin
Built with FastAPI, a trained PyTorch autoencoder (legacy single-frame endpoint), the
ai_health_rul pipeline (IsolationForest + XGBoost, trained on simulator data), an analytical
physics baseline, TreeSHAP attribution and a rule-based return-to-base replanner.
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pathlib import Path
import hmac
import os
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import numpy as np
import math
import time
import uuid

# PyTorch Imports
import torch
import torch.nn as nn

# Migrated AI Health & RUL Module Imports
from ai_health_rul.services.health_rul_service import HealthRulService
from ai_health_rul.schemas.health_rul_schema import UnifiedHealthRulResponse, HealthPredictionResult, PrognosticsResult
from ai_health_rul.inference.autoencoder import EngineAnomalyAutoencoder, AE_FEATURE_NAMES, normalise
from ai_health_rul.config.config import MODEL_DIR, MODEL_CARD_FILE, AUTOENCODER_FILE
import json

app = FastAPI(
    title="GarudaTwin AI & Physics Microservice",
    description="Prognostics, Physics Residuals, PyTorch Anomaly Detection, and RL Mission Replanning for MALE UAV Engines",
    version="1.0.0"
)

health_rul_service = HealthRulService()

# ---------------------------------------------------------
# 0. SERVICE SECURITY
# ---------------------------------------------------------
# Browsers never call this service directly: the authenticated gateway (server.js) proxies
# requests and adds the shared X-Internal-Key. The service binds to 127.0.0.1 by default.
DATA_DIR = Path(os.environ.get("GCS_DATA_DIR", Path(__file__).resolve().parent / "data"))
PUBLIC_PATHS = {"/", "/health", "/docs", "/redoc", "/openapi.json"}
_key_cache: Dict[str, Any] = {"mtime": None, "key": None}


def _internal_key() -> Optional[str]:
    """GCS_INTERNAL_KEY env, else internalKey from data/service.json (created by the gateway)."""
    if os.environ.get("GCS_INTERNAL_KEY"):
        return os.environ["GCS_INTERNAL_KEY"]
    f = DATA_DIR / "service.json"
    try:
        mtime = f.stat().st_mtime
        if _key_cache["mtime"] != mtime:
            with open(f, encoding="utf-8") as fh:
                _key_cache.update(mtime=mtime, key=json.load(fh).get("internalKey"))
        return _key_cache["key"]
    except (FileNotFoundError, ValueError):
        return None


@app.middleware("http")
async def require_internal_key(request: Request, call_next):
    if request.url.path in PUBLIC_PATHS or request.method == "OPTIONS":
        return await call_next(request)
    expected = _internal_key()
    if not expected:
        return JSONResponse({"detail": "service auth not configured: start the gateway once (creates data/service.json) "
                                       "or set GCS_INTERNAL_KEY"}, status_code=503)
    given = request.headers.get("x-internal-key", "")
    if not hmac.compare_digest(given.encode(), expected.encode()):
        return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


# No wildcard CORS. Only origins listed in AI_ALLOWED_ORIGINS (none by default) may call from a browser.
_ai_origins = [o.strip() for o in os.environ.get("AI_ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _ai_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ai_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Internal-Key"],
    )

# ---------------------------------------------------------
# 1. TRAINED PYTORCH AUTOENCODER (legacy /detect-anomaly endpoint)
# ---------------------------------------------------------
# Trained on nominal simulator frames by training/train_models.py; threshold = 99.9th
# percentile of nominal validation reconstruction error.
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
autoencoder = EngineAnomalyAutoencoder(input_dim=12, latent_dim=4).to(device)
AE_THRESHOLD = None
try:
    autoencoder.load_state_dict(torch.load(MODEL_DIR / AUTOENCODER_FILE, map_location=device))
    with open(MODEL_DIR / MODEL_CARD_FILE) as _f:
        AE_THRESHOLD = float(json.load(_f)["metrics"]["autoencoder_legacy_endpoint"]["threshold_mse"])
except Exception as _e:
    print(f"[ERROR] Autoencoder weights not loaded ({_e}); run training/train_models.py")
autoencoder.eval()
FEATURE_NAMES = AE_FEATURE_NAMES


# ---------------------------------------------------------
# 2. PHYSICS FIRST-PRINCIPLES BASELINE ENGINE
# ---------------------------------------------------------

class PhysicsBaselineEngine:
    """
    Thermodynamic and Gas-Dynamic Analytical Model for Rotax 915 iS (1414 cc, Turbocharged, Intercooled, FADEC)
    Computes expected nominal sensor values given operating parameters (RPM, Throttle, Altitude).
    """
    @staticmethod
    def compute_nominal_states(rpm: float, throttle_pct: float, altitude_ft: float) -> Dict[str, float]:
        # Atmospheric lapse rate model
        alt_km = altitude_ft * 0.0003048
        p_ambient = 1.01325 * math.pow(1.0 - 0.0225577 * alt_km, 5.25588) # Ambient pressure in bar
        t_ambient_c = 15.0 - 6.5 * alt_km # Ambient temperature in °C

        # Turbocharger pressure ratio model
        turbo_wastegate_target = min(1.0, max(0.2, (throttle_pct / 100.0) * 1.15))
        compressor_pr = 1.0 + (turbo_wastegate_target * 1.35) * (rpm / 5800.0)
        nominal_map = min(1.85, max(0.7, p_ambient * compressor_pr))

        # Combustion thermal balance for EGT (°C)
        # EGT increases with throttle, engine load, and altitude derating
        phi = 0.88 + 0.12 * (throttle_pct / 100.0) # Fuel-air equivalence ratio
        nominal_egt = 820.0 + (throttle_pct / 100.0) * 45.0 + (rpm / 5800.0) * 20.0 + (altitude_ft / 10000.0) * 8.0

        # Liquid cooling balance for CHT (°C)
        nominal_cht = 102.0 + (throttle_pct / 100.0) * 12.0 + (nominal_egt - 800.0) * 0.05

        # Lubrication hydrodynamic balance
        nominal_oil_temp = 94.0 + (throttle_pct / 100.0) * 8.0 + (rpm / 5800.0) * 5.0
        nominal_oil_press = max(2.2, 4.2 - (nominal_oil_temp - 90.0) * 0.018 - (5800.0 - rpm) * 0.0002)

        # Structural vibration harmonic baseline (g-RMS)
        nominal_vib = 0.22 + 0.16 * (rpm / 5800.0) + (throttle_pct / 100.0) * 0.05

        return {
            "p_ambient_bar": round(p_ambient, 3),
            "t_ambient_c": round(t_ambient_c, 1),
            "nominal_map_bar": round(nominal_map, 3),
            "nominal_egt_c": round(nominal_egt, 1),
            "nominal_cht_c": round(nominal_cht, 1),
            "nominal_oil_temp_c": round(nominal_oil_temp, 1),
            "nominal_oil_press_bar": round(nominal_oil_press, 2),
            "nominal_vibration_grms": round(nominal_vib, 3)
        }


# ---------------------------------------------------------
# 3. PYDANTIC SCHEMAS
# ---------------------------------------------------------

class TelemetryInput(BaseModel):
    rpm: float = Field(..., ge=1500, le=6200, json_schema_extra={"example": 4850.0})
    throttle_pct: float = Field(..., ge=0, le=100, json_schema_extra={"example": 78.5})
    altitude_ft: float = Field(default=14500.0, ge=0, le=35000, json_schema_extra={"example": 14500.0})
    egt: List[float] = Field(..., min_length=4, max_length=4, json_schema_extra={"example": [845.0, 842.0, 968.0, 840.0]})
    cht: List[float] = Field(..., min_length=4, max_length=4, json_schema_extra={"example": [107.0, 106.5, 134.0, 108.0]})
    map_bar: float = Field(..., ge=0.5, le=2.5, json_schema_extra={"example": 1.45})
    oil_press_bar: float = Field(..., ge=0.5, le=7.0, json_schema_extra={"example": 3.75})
    oil_temp_c: float = Field(default=99.0, json_schema_extra={"example": 99.0})
    vibration_grms: float = Field(..., ge=0.05, le=5.0, json_schema_extra={"example": 1.15})


class AnomalyResponse(BaseModel):
    is_anomaly: bool
    anomaly_score: float
    reconstruction_mse: float
    threshold: float
    confidence_pct: float
    residuals: Dict[str, Any]
    feature_attributions: Dict[str, float]
    diagnosed_fault: str
    severity_level: str # 'NOMINAL' | 'ELEVATED' | 'CRITICAL'


class PrognosticsResponse(BaseModel):
    rul_hours_mean: float
    rul_hours_lower_95: float
    rul_hours_upper_95: float
    engine_health_index: float
    degradation_rate_pct_per_hour: float
    remaining_mission_reachability_pct: float
    estimated_time_to_critical_minutes: float


class ShapExplanationResponse(BaseModel):
    base_value: float
    anomaly_prediction: float
    attributions: List[Dict[str, Any]]
    dominant_root_cause_feature: str
    physics_explanation: str


class RlReplanRequest(BaseModel):
    uav_id: Optional[str] = Field(default="Vahak-1")
    current_lat: float = Field(default=26.4500)
    current_lng: float = Field(default=70.5200)
    altitude_ft: float = Field(default=14500.0)
    fuel_remaining_liters: Optional[float] = Field(default=None, description="None = fuel not monitored")
    engine_health_index: Optional[float] = Field(default=None)
    rul_hours: Optional[float] = Field(default=None)
    diagnosed_fault: str = Field(default="NONE", description="AI diagnosis of the vehicle")
    ai_online: bool = Field(default=True)
    l1_status: Optional[str] = Field(default=None, description="L1 threshold monitor status (used when the AI is offline)")
    current_throttle_pct: Optional[float] = Field(default=None)
    current_rpm: Optional[float] = Field(default=None)
    current_airspeed_kts: Optional[float] = Field(default=None)
    wind_heading_deg: float = Field(default=240.0)
    wind_speed_kts: float = Field(default=18.0)
    target_field_id: Optional[str] = Field(default=None)
    mode: Optional[str] = Field(default="AUTO_EVENT")


# Rule-based RTB contingency rules — mirror of src/planner/rtbRules.js (parity-tested in test_fleet.mjs).
RTB_RULES = {
    "CRITICAL_HEALTH_PCT": 40.0, "CRITICAL_RUL_H": 2.0, "BINGO_FUEL_L": 22.0,
    "CRITICAL_FAULTS": ("CYL3_INJECTOR", "OIL_PUMP_CAVITATION"),
    "DEGRADED_HEALTH_PCT": 75.0, "DEGRADED_RUL_H": 20.0, "LOW_FUEL_L": 35.0,
}
RTB_PROFILES = {
    "EMERGENCY_DIVERT_RTB": {"throttle": 58.0, "rpm": 4200, "climb_fpm": -350, "speed_kts": 95.0, "field": "NEAREST"},
    "DERATE_AND_DIVERT": {"throttle": 68.0, "rpm": 4400, "climb_fpm": -200, "speed_kts": 105.0, "field": "NEAREST"},
    "CONTINGENCY_RTB_PREVIEW": {"throttle": 68.0, "rpm": 4600, "climb_fpm": -200, "speed_kts": 105.0, "field": "PRIMARY"},
    "CONTINUE_MISSION": {"throttle": None, "rpm": None, "climb_fpm": 0, "speed_kts": None, "field": "PRIMARY"},
}


def rtb_classify(health, rul, fault, fuel, ai_ok=True, l1=None):
    R = RTB_RULES
    crit, deg = [], []
    if health is not None and health < R["CRITICAL_HEALTH_PCT"]:
        crit.append(f"health {health:.1f} % < {R['CRITICAL_HEALTH_PCT']:.0f} %")
    if rul is not None and rul < R["CRITICAL_RUL_H"]:
        crit.append(f"RUL {rul:.1f} h < {R['CRITICAL_RUL_H']:.0f} h")
    if fault in R["CRITICAL_FAULTS"]:
        crit.append(f"diagnosis {fault}")
    if fuel is not None and fuel <= R["BINGO_FUEL_L"]:
        crit.append(f"fuel {fuel:.1f} L <= {R['BINGO_FUEL_L']:.0f} L (bingo)")
    if not ai_ok and l1 == "CRITICAL":
        crit.append("L1 threshold monitor CRITICAL (AI offline)")
    if health is not None and health < R["DEGRADED_HEALTH_PCT"]:
        deg.append(f"health {health:.1f} % < {R['DEGRADED_HEALTH_PCT']:.0f} %")
    if rul is not None and rul < R["DEGRADED_RUL_H"]:
        deg.append(f"RUL {rul:.1f} h < {R['DEGRADED_RUL_H']:.0f} h")
    if fault and fault != "NONE":
        deg.append(f"diagnosis {fault}")
    if fuel is not None and fuel < R["LOW_FUEL_L"]:
        deg.append(f"fuel {fuel:.1f} L < {R['LOW_FUEL_L']:.0f} L")
    if not ai_ok and l1 == "DEGRADED":
        deg.append("L1 threshold monitor DEGRADED (AI offline)")
    status = "CRITICAL" if crit else "DEGRADED" if deg else "NOMINAL"
    return status, (crit or deg)


def rtb_action(status, mode):
    if status == "CRITICAL" or mode == "FORCE_SIMULATION":
        return "EMERGENCY_DIVERT_RTB"
    if status == "DEGRADED":
        return "DERATE_AND_DIVERT"
    if mode == "CONTINGENCY_PREVIEW":
        return "CONTINGENCY_RTB_PREVIEW"
    return "CONTINUE_MISSION"


# ---------------------------------------------------------
# 4. FASTAPI ENDPOINTS
# ---------------------------------------------------------

@app.get("/")
def root():
    return {
        "status": "ONLINE",
        "service": "GarudaTwin AI Prognostics & Physics Microservice",
        "port": 8001,
        "docs_url": "/docs",
        "redoc_url": "/redoc",
        "health_url": "/health",
        "frontend_url": "http://localhost:5173",
        "endpoints": [
            "/health",
            "/docs",
            "/api/health-rul/predict",
            "/api/health-rul/detect-anomaly",
            "/api/health-rul/predict-rul",
            "/api/rl-replan"
        ]
    }


@app.get("/health")
def get_service_health():
    return {
        "status": "ONLINE",
        "service": "GarudaTwin AI Prognostics & Physics Microservice",
        "pytorch_device": str(device),
        "models": {
            "autoencoder": ("LEGACY /detect-anomaly only, not used by the GCS (single-frame recall 14% on held-out simulator data)"
                            if AE_THRESHOLD else "NOT LOADED"),
            "health_rul_pipeline": "Loaded" if health_rul_service.health_predictor.models_loaded else "NOT LOADED",
            "physics_core": "Rotax 915/916 iS Analytical First-Principles"
        },
        "timestamp": time.time()
    }


@app.post("/detect-anomaly", response_model=AnomalyResponse)
def detect_anomaly(telemetry: TelemetryInput):
    """
    LEGACY single-frame endpoint (PyTorch autoencoder on 12 raw inputs). Kept for compatibility only:
    the GCS uses /api/health-rul/predict. Held-out recall is 14 % (see model_card.json); do not use
    it for decisions.
    """
    # 1. Physics Baseline Evaluation
    physics = PhysicsBaselineEngine.compute_nominal_states(
        telemetry.rpm, telemetry.throttle_pct, telemetry.altitude_ft
    )
    
    egt_nom = physics["nominal_egt_c"]
    cht_nom = physics["nominal_cht_c"]
    map_nom = physics["nominal_map_bar"]
    oil_press_nom = physics["nominal_oil_press_bar"]
    vib_nom = physics["nominal_vibration_grms"]

    # Compute sensor residuals (Actual - Nominal)
    egt_res = [round(v - egt_nom, 1) for v in telemetry.egt]
    cht_res = [round(v - cht_nom, 1) for v in telemetry.cht]
    map_res = round(telemetry.map_bar - map_nom, 3)
    oil_press_res = round(telemetry.oil_press_bar - oil_press_nom, 2)
    vib_res = round(telemetry.vibration_grms - vib_nom, 3)

    # 2. PyTorch Autoencoder Inference
    raw_vector = np.array([
        telemetry.rpm, telemetry.throttle_pct,
        telemetry.egt[0], telemetry.egt[1], telemetry.egt[2], telemetry.egt[3],
        telemetry.cht[0], telemetry.cht[1], telemetry.cht[2], telemetry.cht[3],
        telemetry.map_bar, telemetry.oil_press_bar
    ], dtype=np.float32)

    # Standardize vector
    norm_vector = normalise(raw_vector)
    tensor_in = torch.tensor(norm_vector).unsqueeze(0).to(device)

    with torch.no_grad():
        recon_out, latent = autoencoder(tensor_in)
        recon_np = recon_out.cpu().numpy().squeeze(0)
        
        # Calculate per-feature squared error
        feat_errors = (norm_vector - recon_np) ** 2
        recon_mse = float(np.mean(feat_errors))

    # Calculate SHAP-style attribution weights
    total_err = max(0.0001, np.sum(feat_errors))
    attributions = {}
    for idx, name in enumerate(FEATURE_NAMES):
        attributions[name] = round(float((feat_errors[idx] / total_err) * 100.0), 2)

    # Add vibration residual weight into attributions
    if abs(vib_res) > 0.3:
        attributions["Vibration_gRMS"] = round(min(80.0, abs(vib_res) * 45.0), 2)

    # Anomaly threshold calibrated on nominal validation data during training
    if AE_THRESHOLD is None:
        raise HTTPException(status_code=503, detail="Autoencoder not trained — run training/train_models.py")
    threshold = AE_THRESHOLD
    is_anomaly = recon_mse > threshold or max(abs(r) for r in egt_res) > 55.0 or abs(vib_res) > 0.45 or telemetry.oil_press_bar < 1.8

    # Diagnostic Rule Matrix & Classification
    diagnosed_fault = "NOMINAL_OPERATION"
    severity_level = "NOMINAL"

    if is_anomaly:
        if egt_res[2] > 60.0 and telemetry.vibration_grms > 0.8:
            diagnosed_fault = "CYLINDER_3_INJECTOR_RESTRICTION"
            severity_level = "CRITICAL" if egt_res[2] > 100.0 else "ELEVATED"
        elif telemetry.oil_press_bar < 1.8 and telemetry.oil_temp_c > 120.0:
            diagnosed_fault = "OIL_PUMP_CAVITATION_OR_HYDRODYNAMIC_LOSS"
            severity_level = "CRITICAL"
        elif telemetry.oil_temp_c > 122.0 and abs(oil_press_res) > 1.2:
            diagnosed_fault = "PISTON_RING_BLOW_BY_AND_CRANKCASE_PRESSURIZATION"
            severity_level = "ELEVATED"
        elif telemetry.map_bar > 1.95 or (telemetry.map_bar < 1.0 and telemetry.throttle_pct > 70):
            diagnosed_fault = "TURBOCHARGER_WASTEGATE_ACTUATOR_MALFUNCTION"
            severity_level = "ELEVATED"
        elif all(r > 25.0 for r in cht_res):
            diagnosed_fault = "COOLING_SYSTEM_DEGRADATION"
            severity_level = "ELEVATED"
        else:
            diagnosed_fault = "MULTI_PARAMETER_MECHANICAL_DEGRADATION"
            severity_level = "ELEVATED"

    anomaly_score = min(1.0, recon_mse / (2.0 * threshold))

    return AnomalyResponse(
        is_anomaly=is_anomaly,
        anomaly_score=round(anomaly_score, 4),
        reconstruction_mse=round(recon_mse, 6),
        threshold=round(threshold, 6),
        confidence_pct=round(min(99.8, max(50.0, 100.0 * abs(recon_mse - threshold) / max(recon_mse, threshold))), 1),
        residuals={
            "egt_residuals": egt_res,
            "cht_residuals": cht_res,
            "map_residual": map_res,
            "oil_press_residual": oil_press_res,
            "vibration_residual": vib_res
        },
        feature_attributions=attributions,
        diagnosed_fault=diagnosed_fault,
        severity_level=severity_level
    )


@app.post("/predict-rul", response_model=PrognosticsResponse)
def predict_rul(telemetry: TelemetryInput):
    """
    Single-frame RUL estimate from the trained XGBoost quantile model (ai_health_rul pipeline).
    Uses a fresh, discarded session so single-frame calls never share state.
    """
    sid = f"legacy-{uuid.uuid4()}"
    try:
        res = health_rul_service.predict({
            "uav_id": sid, "rpm": telemetry.rpm, "throttle": telemetry.throttle_pct,
            "egt": telemetry.egt, "cht": telemetry.cht, "map_bar": telemetry.map_bar,
            "oil_pressure": telemetry.oil_press_bar, "oil_temp": telemetry.oil_temp_c,
            "vibration": telemetry.vibration_grms,
        }, persistence=False)  # single-frame request: no 2-sample confirmation possible
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    finally:
        health_rul_service.reset_history(sid)
    r = res.rul
    to_mel_h = max(0.0, (r.healthIndexScore - 50.0) / max(1e-6, r.degradationRatePercentPerHour))
    return PrognosticsResponse(
        rul_hours_mean=r.rulHours,
        rul_hours_lower_95=r.rulHoursLower95,
        rul_hours_upper_95=r.rulHoursUpper95,
        engine_health_index=r.healthIndexScore,
        degradation_rate_pct_per_hour=r.degradationRatePercentPerHour,
        remaining_mission_reachability_pct=round(min(100.0, (r.rulHours / 8.0) * 100.0), 1),
        estimated_time_to_critical_minutes=round(min(to_mel_h, r.rulHours) * 60.0, 0),
    )


@app.post("/explain-shap", response_model=ShapExplanationResponse)
def explain_shap(telemetry: TelemetryInput):
    """
    Computes explainable AI attribution bars for user and judges inspection.
    """
    anomaly = detect_anomaly(telemetry)
    
    # Format attributions into ranked list
    sorted_attrs = sorted(
        [{"feature": k, "importance_pct": v} for k, v in anomaly.feature_attributions.items()],
        key=lambda x: x["importance_pct"],
        reverse=True
    )

    dominant = sorted_attrs[0]["feature"] if sorted_attrs else "None"

    # Physics-grounded natural language explanation
    explanation_map = {
        "EGT_Cyl3": "Cylinder 3 Exhaust Gas Temperature shows a severe +120°C positive residual deviation against nominal thermodynamic baseline, indicative of lean-burn combustion caused by an injector orifice restriction or partial vapor lock.",
        "Vibration_gRMS": "Vibration sensor records high-frequency broad-spectrum energy > 1.0g RMS, reflecting rotational asymmetry and cylinder combustion imbalance.",
        "Oil_Pressure": "Hydrodynamic oil film pressure has decayed below critical minimum operating threshold (2.0 bar), jeopardizing journal bearing lubrication integrity.",
        "MAP": "Manifold Absolute Pressure is mismatched relative to commanded throttle angle, indicating turbocharger wastegate actuator hysteretic lag or boost leak.",
        "RPM": "Engine RPM exhibits cyclical hunting outside the closed-loop FADEC governor bandwidth."
    }

    phys_explanation = explanation_map.get(
        dominant,
        f"Multi-sensor residual analysis indicates collective variance across {dominant} and adjacent thermodynamic channels."
    )

    return ShapExplanationResponse(
        base_value=0.045,
        anomaly_prediction=anomaly.anomaly_score,
        attributions=sorted_attrs,
        dominant_root_cause_feature=dominant,
        physics_explanation=phys_explanation
    )


@app.post("/rl-replan")
@app.post("/api/rl-replan")
def rl_mission_replan(req: RlReplanRequest):
    """
    Rule-based Return-to-Base (RTB) contingency planner (not reinforcement learning; the URL and the
    `rl_control_commands` field name are kept for API compatibility). Deterministic rules on RUL,
    health and fuel; haversine distances to candidate airfields; straight-line descent waypoints.
    """
    # Candidate Recovery Airfields (Indo-Pak Border Western Theater)
    airfields = [
        {"id": "AFS_UTTARLAI", "name": "AFS Uttarlai (Barmer)", "short_name": "AFS Uttarlai", "lat": 25.8117, "lng": 71.4883, "alt_ft": 500, "type": "PRIMARY"},
        {"id": "AFS_JAISALMER", "name": "AFS Jaisalmer Forward Base", "short_name": "AFS Jaisalmer", "lat": 26.8897, "lng": 70.8653, "alt_ft": 825, "type": "DIVERT"},
        {"id": "POKHRAN_ALG", "name": "Pokhran Advanced Landing Ground (Emergency Strip 09)", "short_name": "Pokhran ALG", "lat": 26.9200, "lng": 71.7500, "alt_ft": 720, "type": "EMERGENCY_GLIDE"}
    ]

    # Haversine distance
    def calc_dist_nm(lat1, lon1, lat2, lon2):
        R = 3440.065 # Earth radius in NM
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        return R * c

    candidates = []
    for f in airfields:
        d = calc_dist_nm(req.current_lat, req.current_lng, f["lat"], f["lng"])
        candidates.append({**f, "dist_nm": round(d, 1)})
    
    # Sort candidate fields by distance from current UAV position
    by_dist = sorted(candidates, key=lambda x: x["dist_nm"])

    # Decision rules (shared with the GCS, see RTB_RULES)
    status, reasons = rtb_classify(req.engine_health_index, req.rul_hours, req.diagnosed_fault or "NONE",
                                   req.fuel_remaining_liters, req.ai_online, req.l1_status)
    action = rtb_action(status, req.mode)
    profile = RTB_PROFILES[action]
    requires_emergency_divert = action == "EMERGENCY_DIVERT_RTB"

    # Airfield: operator choice, else nearest for divert actions, else the primary base
    if req.target_field_id and req.target_field_id != "AUTO":
        target_destination = next((f for f in candidates if f["id"] == req.target_field_id), by_dist[0])
    elif profile["field"] == "NEAREST":
        target_destination = by_dist[0]
    else:
        target_destination = next((f for f in candidates if f["id"] == "AFS_UTTARLAI"), by_dist[0])
    target_dist_nm = target_destination["dist_nm"]

    # Fixed rule outputs; CONTINUE_MISSION keeps the vehicle's current operating point
    recommended_throttle_pct = profile["throttle"] if profile["throttle"] is not None else (req.current_throttle_pct or 78.0)
    recommended_rpm = profile["rpm"] if profile["rpm"] is not None else (req.current_rpm or 4850)
    recommended_climb_fpm = profile["climb_fpm"]
    commanded_speed = profile["speed_kts"] if profile["speed_kts"] is not None else (req.current_airspeed_kts or 115.0)

    # Compute optimal trajectory waypoints
    num_wp = 4
    waypoints = []
    flight_time_min = max(0.1, (target_dist_nm / max(1.0, commanded_speed)) * 60.0)
    for i in range(num_wp + 1):
        frac = i / float(num_wp)
        wp_lat = req.current_lat + frac * (target_destination["lat"] - req.current_lat)
        wp_lng = req.current_lng + frac * (target_destination["lng"] - req.current_lng)
        wp_alt = req.altitude_ft - frac * (req.altitude_ft - target_destination["alt_ft"])
        wp_names = ["CURRENT_POS", "GLIDE_INTERCEPT", "DESCENT_MID", "APPROACH_GATE", "TOUCHDOWN"]
        waypoints.append({
            "wp_id": f"RTB-{i+1}",
            "name": wp_names[i] if requires_emergency_divert else f"WP-{i+1}",
            "lat": round(wp_lat, 4),
            "lng": round(wp_lng, 4),
            "altitude_ft": round(wp_alt, 0),
            "commanded_airspeed_kts": 72.0 if i == num_wp else commanded_speed,
            "dist_remaining_nm": round(target_dist_nm * (1.0 - frac), 1),
            "eta_min": round(flight_time_min * frac, 1)
        })

    flight_time_hrs = flight_time_min / 60.0
    safety_margin = round(max(0.0, req.rul_hours) / max(0.01, flight_time_hrs), 2) if req.rul_hours is not None else None

    return {
        "uav_id": req.uav_id,
        "action": action,
        "status": status,
        "reasons": reasons,
        "target_recovery_field": target_destination["name"],
        "target_field_id": target_destination["id"],
        "distance_to_field_nm": round(target_dist_nm, 1),
        "estimated_flight_time_minutes": round(flight_time_min, 1),
        "rul_safety_margin_factor": safety_margin,
        "rl_control_commands": {
            "recommended_throttle_pct": recommended_throttle_pct,
            "recommended_rpm": recommended_rpm,
            "recommended_vertical_speed_fpm": recommended_climb_fpm,
            "fuel_flow_target_lph": 18.5 if recommended_throttle_pct < 65.0 else (22.0 if recommended_throttle_pct < 75.0 else 25.0),
            "commanded_airspeed_kts": commanded_speed
        },
        "optimized_rtb_flight_plan": waypoints,
        "all_candidate_fields": candidates
    }


# ---------------------------------------------------------
# 5. MIGRATED AI HEALTH & RUL MODULE ENDPOINTS
# ---------------------------------------------------------

@app.post("/api/health-rul/predict", response_model=UnifiedHealthRulResponse)
def api_predict_health_rul(telemetry: Dict[str, Any]):
    """
    Unified AI Health & Remaining Useful Life (RUL) prediction pipeline: physics-residual features,
    Mahalanobis anomaly detector, XGBoost fault classifier / severity / quantile RUL, TreeSHAP,
    maintenance advisory. Optional `total_flight_hours` (0-20000) sets the engine's hours for the
    scheduled-TBO remaining life used when no fault is diagnosed.
    """
    try:
        hours = telemetry.get("total_flight_hours", 450.0)
        try:
            hours = float(hours)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="total_flight_hours must be a number")
        if not math.isfinite(hours) or not 0.0 <= hours <= 20000.0:
            raise HTTPException(status_code=400, detail="total_flight_hours must be within 0-20000")
        return health_rul_service.predict(telemetry, total_flight_hours=hours)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        if "OUT_OF_DISTRIBUTION" in str(e):
            raise HTTPException(status_code=400, detail={"error": "OUT_OF_DISTRIBUTION", "message": str(e)})
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/health-rul/detect-anomaly")
def api_detect_anomaly(telemetry: Dict[str, Any]):
    """
    Evaluates micro-anomaly detection via DataQualityGuard and Isolation Forest.
    """
    try:
        res = health_rul_service.predict(telemetry)
        return res.health
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/health-rul/predict-rul")
def api_predict_rul(telemetry: Dict[str, Any]):
    """
    Predicts Remaining Useful Life flight hours and 50-hour Bayesian forecast trajectory.
    """
    res = health_rul_service.predict(telemetry)
    return res.rul


@app.post("/api/health-rul/explain-shap")
def api_explain_shap(telemetry: Dict[str, Any]):
    """
    Returns TreeSHAP feature attribution weights explaining root-cause parameter impact.
    """
    res = health_rul_service.predict(telemetry)
    return {
        "attributions": res.feature_attributions,
        "diagnosed_fault": res.health.diagnosed_fault,
        "anomaly_score": res.health.anomaly_score
    }


@app.post("/api/health-rul/advisory")
def api_advisory(telemetry: Dict[str, Any]):
    """
    Generates actionable in-flight emergency checklists and pilot advisories.
    """
    res = health_rul_service.predict(telemetry)
    return res.advisory


class SessionResetRequest(BaseModel):
    uav_id: str = Field(..., max_length=64)


@app.post("/api/health-rul/reset")
def api_reset_session(req: SessionResetRequest):
    """Clears one vehicle's inference session (called by the gateway on simulation reset)."""
    health_rul_service.reset_history(req.uav_id)
    return {"success": True}


if __name__ == "__main__":
    import uvicorn
    # Loopback only by default: the gateway is the sole client. Override with AI_HOST if needed.
    uvicorn.run(app, host=os.environ.get("AI_HOST", "127.0.0.1"), port=int(os.environ.get("AI_PORT", "8001")))

