"""
test_complete_ai_physics.py
===========================
Automated Full-Project Validation Suite for:
1. Rotax 915 iS Thermodynamics & Analytical Physics Baseline
2. Trained PyTorch Deep Autoencoder (single-frame anomaly detector)
3. Trained XGBoost RUL quantile model (legacy single-frame endpoint)
4. Feature Attribution & Root Cause Diagnosis
5. Rule-based Return-to-Base Divert Replanner
6. Unified AI Health & RUL Service (Mahalanobis detector + XGBoost, no label inputs)
"""

import math
import numpy as np
import torch
import sys

from ai_service import (
    PhysicsBaselineEngine,
    TelemetryInput,
    detect_anomaly,
    predict_rul,
    explain_shap,
    rl_mission_replan,
    RlReplanRequest,
    autoencoder,
)
from ai_health_rul.services.health_rul_service import HealthRulService

print("=" * 70)
print("🧪 GARUDATWIN FULL AI/ML & PHYSICS VERIFICATION SUITE")
print("=" * 70)

passed = 0
total = 6

# -------------------------------------------------------------
# 1. Physics First-Principles Baseline Thermodynamics
# -------------------------------------------------------------
print("\n[SECTION 1/6] Validating Rotax 915 iS Thermodynamics & Physics Core...")
try:
    # Test at standard cruise: 14,500 ft, 78.5% throttle, 4850 RPM
    states = PhysicsBaselineEngine.compute_nominal_states(4850.0, 78.5, 14500.0)
    
    # Expected: p_ambient at 14,500 ft (~4420 m) ≈ 0.584 bar
    assert 0.55 <= states["p_ambient_bar"] <= 0.62, f"p_ambient out of range: {states['p_ambient_bar']}"
    # Expected: t_ambient at 14,500 ft ≈ -13.7 °C
    assert -18.0 <= states["t_ambient_c"] <= -10.0, f"t_ambient out of range: {states['t_ambient_c']}"
    # Expected: nominal MAP around 1.10 - 1.45 bar (turbocharged boost at 14,500 ft)
    assert 1.05 <= states["nominal_map_bar"] <= 1.45, f"nominal_map out of range: {states['nominal_map_bar']}"
    # Expected: nominal EGT around 840 - 880 °C
    assert 840.0 <= states["nominal_egt_c"] <= 890.0, f"nominal_egt out of range: {states['nominal_egt_c']}"
    # Expected: nominal CHT around 104 - 116 °C
    assert 104.0 <= states["nominal_cht_c"] <= 118.0, f"nominal_cht out of range: {states['nominal_cht_c']}"
    # Expected: oil pressure around 3.5 - 4.2 bar
    assert 3.5 <= states["nominal_oil_press_bar"] <= 4.2, f"nominal_oil_press out of range: {states['nominal_oil_press_bar']}"

    print(f"  ✓ Barometric pressure at 14,500 ft: {states['p_ambient_bar']} bar")
    print(f"  ✓ Ambient lapse temperature: {states['t_ambient_c']} °C")
    print(f"  ✓ Turbocharger compressor boost MAP: {states['nominal_map_bar']} bar")
    print(f"  ✓ Thermal balance: EGT = {states['nominal_egt_c']} °C, CHT = {states['nominal_cht_c']} °C")
    print(f"  ✓ Lubrication hydrodynamic pressure: {states['nominal_oil_press_bar']} bar")
    print("  ✓ Analytical physics formulas verified against Rotax 915 iS engine specs.")
    passed += 1
except Exception as e:
    print(f"  ✗ Physics baseline test failed: {e}")

# Test Telemetry Fixtures
# Nominal = what the golden twin expects at 4850 rpm / 78.5 % (EGT 841.5 °C, CHT 106 °C).
# (A uniform +12 °C EGT rise is a lean / injector-coking signature, not nominal.)
nom_telemetry = TelemetryInput(
    rpm=4850.0, throttle_pct=78.5, altitude_ft=14500.0,
    egt=[842.0, 840.5, 842.5, 841.0],
    cht=[106.2, 105.8, 106.4, 106.0],
    map_bar=1.45, oil_press_bar=3.85, oil_temp_c=98.0,
    vibration_grms=0.28
)
fault_telemetry = TelemetryInput(
    rpm=4850.0, throttle_pct=78.5, altitude_ft=14500.0,
    egt=[855.0, 852.0, 975.0, 850.0],
    cht=[108.0, 107.5, 136.0, 108.0],
    map_bar=1.45, oil_press_bar=3.85, oil_temp_c=98.0,
    vibration_grms=1.25
)

# -------------------------------------------------------------
# 2. PyTorch Deep Autoencoder Micro-Residual Anomaly Detection
# -------------------------------------------------------------
print("\n[SECTION 2/6] Validating PyTorch Deep Autoencoder Micro-Anomaly Detection...")
try:
    res_nom = detect_anomaly(nom_telemetry)
    print(f"  ✓ Nominal Reconstruction MSE: {res_nom.reconstruction_mse} (Threshold: {res_nom.threshold})")
    assert not res_nom.is_anomaly, "Nominal telemetry falsely flagged as anomaly"
    assert res_nom.diagnosed_fault == "NOMINAL_OPERATION"

    res_fault = detect_anomaly(fault_telemetry)
    print(f"  ✓ Fault Reconstruction MSE: {res_fault.reconstruction_mse} > Threshold")
    print(f"  ✓ Diagnosed Fault: {res_fault.diagnosed_fault} (Severity: {res_fault.severity_level})")
    assert res_fault.is_anomaly, "Fault condition not detected"
    assert "CYLINDER_3_INJECTOR" in res_fault.diagnosed_fault
    print("  ✓ PyTorch Autoencoder micro-residual anomaly classification verified.")
    passed += 1
except Exception as e:
    print(f"  ✗ Autoencoder test failed: {e}")

# -------------------------------------------------------------
# 3. PyTorch Bi-LSTM Remaining Useful Life (RUL) Network
# -------------------------------------------------------------
print("\n[SECTION 3/6] Validating trained RUL quantile model & 95% intervals...")
try:
    rul_nom = predict_rul(nom_telemetry)
    print(f"  ✓ Nominal Engine Health Index: {rul_nom.engine_health_index}%")
    print(f"  ✓ Predicted Mean RUL: {rul_nom.rul_hours_mean} hrs (95% CI: [{rul_nom.rul_hours_lower_95}, {rul_nom.rul_hours_upper_95}] hrs)")
    assert rul_nom.rul_hours_lower_95 <= rul_nom.rul_hours_mean <= rul_nom.rul_hours_upper_95
    assert rul_nom.engine_health_index > 80.0

    rul_fault = predict_rul(fault_telemetry)
    print(f"  ✓ Degraded Health Index: {rul_fault.engine_health_index}%")
    print(f"  ✓ Degraded Mean RUL: {rul_fault.rul_hours_mean} hrs (Degradation Rate: {rul_fault.degradation_rate_pct_per_hour}%/hr)")
    assert rul_fault.rul_hours_mean < rul_nom.rul_hours_mean, "Fault did not decrease RUL"
    assert rul_fault.engine_health_index < rul_nom.engine_health_index, "Fault did not reduce health index"
    print("  ✓ Trained RUL estimation and conformal 95% interval verified.")
    passed += 1
except Exception as e:
    print(f"  ✗ RUL test failed: {e}")

# -------------------------------------------------------------
# 4. SHAP Feature Attribution & Root Cause Analysis
# -------------------------------------------------------------
print("\n[SECTION 4/6] Validating SHAP Explainable AI Feature Attributions...")
try:
    shap_res = explain_shap(fault_telemetry)
    print(f"  ✓ Dominant Root-Cause Feature: {shap_res.dominant_root_cause_feature}")
    print(f"  ✓ Top Attribution Features: {[(a['feature'], str(a['importance_pct']) + '%') for a in shap_res.attributions[:3]]}")
    print(f"  ✓ Physics-Grounded Explanation:\n    \"{shap_res.physics_explanation[:100]}...\"")
    assert len(shap_res.attributions) > 0
    assert shap_res.dominant_root_cause_feature in ["EGT_Cyl3", "Vibration_gRMS"]
    print("  ✓ SHAP explainability engine verified.")
    passed += 1
except Exception as e:
    print(f"  ✗ SHAP test failed: {e}")

# -------------------------------------------------------------
# 5. Reinforcement Learning (RL) Autonomous Divert Replanner
# -------------------------------------------------------------
print("\n[SECTION 5/6] Validating rule-based Return-to-Base Replanner...")
try:
    req_healthy = RlReplanRequest(
        current_lat=26.45, current_lng=70.52, altitude_ft=14500.0,
        fuel_remaining_liters=80.0, engine_health_index=95.0, rul_hours=820.0
    )
    plan_healthy = rl_mission_replan(req_healthy)
    print(f"  ✓ Healthy Scenario Decision: {plan_healthy['action']}")
    print(f"  ✓ Target Recovery Field: {plan_healthy['target_recovery_field']} ({plan_healthy['distance_to_field_nm']} NM)")
    # Healthy engine: no derate, keep flying (shared rules: src/planner/rtbRules.js)
    assert plan_healthy["action"] == "CONTINUE_MISSION" and plan_healthy["status"] == "NOMINAL"

    req_crit = RlReplanRequest(
        current_lat=26.45, current_lng=70.52, altitude_ft=14500.0,
        fuel_remaining_liters=25.0, engine_health_index=28.0, rul_hours=0.8
    )
    plan_crit = rl_mission_replan(req_crit)
    print(f"  ✓ Critical Scenario Decision: {plan_crit['action']}")
    print(f"  ✓ Emergency Recovery Field: {plan_crit['target_recovery_field']} ({plan_crit['distance_to_field_nm']} NM)")
    print(f"  ✓ Recommended Power Derate: Throttle {plan_crit['rl_control_commands']['recommended_throttle_pct']}%, RPM {plan_crit['rl_control_commands']['recommended_rpm']}")
    print(f"  ✓ Recalculated Descent Waypoints: {len(plan_crit['optimized_rtb_flight_plan'])} waypoints")
    assert plan_crit["action"] == "EMERGENCY_DIVERT_RTB"
    assert "Jaisalmer" in plan_crit["target_recovery_field"]
    assert plan_crit["rl_control_commands"]["recommended_throttle_pct"] <= 60.0

    # Fuel Bingo (<= 22 L reserve) must trigger emergency divert even with healthy engine
    req_bingo = RlReplanRequest(
        uav_id="Vahak-2",
        current_lat=26.45, current_lng=70.52, altitude_ft=14500.0,
        fuel_remaining_liters=18.0, engine_health_index=98.0, rul_hours=700.0
    )
    plan_bingo = rl_mission_replan(req_bingo)
    print(f"  ✓ Fuel Bingo Scenario Decision: {plan_bingo['action']} (UAV: {plan_bingo['uav_id']})")
    assert plan_bingo["action"] == "EMERGENCY_DIVERT_RTB"
    assert plan_bingo["uav_id"] == "Vahak-2"
    assert "Jaisalmer" in plan_bingo["target_recovery_field"]

    print("  ✓ Rule-based RTB decisions (healthy, critical, fuel bingo) verified.")
    passed += 1
except Exception as e:
    print(f"  ✗ RTB planner test failed: {e}")

# -------------------------------------------------------------
# 6. Unified AI Health & RUL Service (no health/label inputs)
# -------------------------------------------------------------
print("\n[SECTION 6/6] Validating Unified AI Health & RUL Service...")
try:
    svc = HealthRulService()
    base = {"uav_id": "TEST", "rpm": 4800.0, "throttle": 78.5, "egt": [840.0] * 4, "cht": [106.0] * 4,
            "map_bar": 1.42, "oil_pressure": 3.85, "oil_temp": 98.0, "vibration": 0.28, "fuel_flow": 26.0,
            "lambda": 0.94, "gen_voltage": 28.4, "gen_current": 45.2, "coolant_temp": 88.5}
    rng = np.random.default_rng(0)
    noisy = lambda b: {**b, "egt": list(840 + rng.normal(0, 1.2, 4)), "cht": list(106 + rng.normal(0, 0.3, 4)),
                       "rpm": 4800 + rng.normal(0, 4), "map_bar": 1.42 + rng.normal(0, 0.005),
                       "oil_pressure": 3.85 + rng.normal(0, 0.02), "oil_temp": 98 + rng.normal(0, 0.1),
                       "vibration": 0.28 + rng.normal(0, 0.008), "lambda": 0.94 + rng.normal(0, 0.003),
                       "gen_current": 45.2 + rng.normal(0, 0.5), "coolant_temp": 88.5 + rng.normal(0, 0.2)}
    # Real sensors are never perfectly constant (identical readings would be flagged as stuck sensors)
    for i in range(10):
        res = svc.predict({**noisy(base), "sim_time_s": float(i)})
    print(f"  ✓ Nominal: diagnosis={res.health.diagnosed_fault}, health={res.rul.healthIndexScore}, RUL={res.rul.rulHours} h")
    assert res.health.diagnosed_fault == "NONE"
    assert res.maintenance.priority == "LOW"

    # Leakage guard: a health_index / fault label in the payload must not change the output
    leak = svc.predict({**noisy(base), "sim_time_s": 10.0, "health_index": 0.05, "activeFault": "BLOW_BY"})
    assert leak.health.diagnosed_fault == "NONE" and abs(leak.rul.healthIndexScore - res.rul.healthIndexScore) < 1.0
    print("  ✓ health_index / fault-label inputs ignored (no label leakage)")

    # Oil-pump cavitation signature on a separate vehicle
    for i in range(6):
        cav = svc.predict({**noisy(base), "uav_id": "TEST-2", "sim_time_s": float(i), "oil_pressure": 1.9 + 0.4 * (-1) ** i,
                           "oil_temp": 119.0, "vibration": 1.45})
    print(f"  ✓ Cavitation: diagnosis={cav.health.diagnosed_fault}, health={cav.rul.healthIndexScore}, RUL={cav.rul.rulHours} h")
    assert cav.health.diagnosed_fault == "OIL_PUMP_CAVITATION"

    # DataQualityGuard physical-bound outlier
    res_ood = svc.predict({**base, "uav_id": "TEST-3", "rpm": 8500.0})
    assert "rpm" in res_ood.data_quality.outliers_detected
    print(f"  ✓ DataQualityGuard flagged: {res_ood.data_quality.outliers_detected}")
    passed += 1
except Exception as e:
    print(f"  ✗ Unified service test failed: {e}")

print("\n" + "=" * 70)
perc = int((passed / total) * 100)
print(f"AI/ML & PHYSICS VERIFICATION: {passed}/{total} SECTIONS PASSED ({perc}%)")
print("=" * 70)

sys.exit(0 if passed == total else 1)
