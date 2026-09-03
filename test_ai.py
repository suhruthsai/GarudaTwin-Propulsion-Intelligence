import ai_service
from ai_service import TelemetryInput

telemetry = TelemetryInput(
    rpm=4850.0,
    throttle_pct=78.5,
    altitude_ft=14500.0,
    egt=[845.0, 842.0, 968.0, 840.0],
    cht=[107.0, 106.5, 134.0, 108.0],
    map_bar=1.45,
    oil_press_bar=3.75,
    oil_temp_c=99.0,
    vibration_grms=1.15
)

try:
    print("Testing detect_anomaly...")
    anomaly = ai_service.detect_anomaly(telemetry)
    print("detect_anomaly successful.")
except Exception as e:
    print(f"Error in detect_anomaly: {e}")

try:
    print("Testing predict_rul...")
    rul = ai_service.predict_rul(telemetry)
    print("predict_rul successful.")
except Exception as e:
    print(f"Error in predict_rul: {e}")

try:
    print("Testing explain_shap...")
    shap = ai_service.explain_shap(telemetry)
    print("explain_shap successful.")
except Exception as e:
    print(f"Error in explain_shap: {e}")

try:
    print("Testing rl_mission_replan...")
    from ai_service import RlReplanRequest
    req = RlReplanRequest()
    replan = ai_service.rl_mission_replan(req)
    print("rl_mission_replan successful.")
except Exception as e:
    print(f"Error in rl_mission_replan: {e}")

