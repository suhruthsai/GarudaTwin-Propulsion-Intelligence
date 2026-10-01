"""Smoke test: one prediction straight from the AI service (needs the gateway's internal key)."""
import json
import os
from pathlib import Path

import requests

KEY = os.environ.get("GCS_INTERNAL_KEY") or json.loads((Path(__file__).parent / "data" / "service.json").read_text())["internalKey"]
url = "http://127.0.0.1:8001/api/health-rul/predict"
data = {
    "uav_id": "SMOKE-TEST",
    "rpm": 4800,
    "throttle": 78.5,
    "egt": [840, 840, 840, 840],
    "cht": [106, 106, 106, 106],
    "map_bar": 1.42,
    "oil_pressure": 3.85,
    "oil_temp": 98,
    "vibration": 0.28,
    "fuel_flow": 26,
    "gen_voltage": 28.4,
}

try:
    r = requests.post(url, json=data, headers={"X-Internal-Key": KEY})
    if r.status_code == 200:
        print("Success")
        print("Diagnosis:", r.json()["health"]["diagnosed_fault"], "| RUL:", r.json()["rul"]["rulHours"])
    else:
        print("Error:", r.status_code, r.text)
except Exception as e:
    print("Request failed", e)
