"""Smoke test (stdlib only): one prediction straight from the AI service with the internal key."""
import json
import os
import urllib.request
from pathlib import Path

KEY = os.environ.get("GCS_INTERNAL_KEY") or json.loads((Path(__file__).parent / "data" / "service.json").read_text())["internalKey"]
data = json.dumps({
    "uav_id": "SMOKE-TEST",
    "rpm": 4800,
    "throttle": 78.5,
    "egt": [840, 840, 840, 840],
    "cht": [106, 106, 106, 106],
    "oil_pressure": 3.85,
    "oil_temp": 98,
    "vibration": 0.28,
}).encode("utf-8")

req = urllib.request.Request("http://127.0.0.1:8001/api/health-rul/predict", data=data,
                             headers={"Content-Type": "application/json", "X-Internal-Key": KEY})
resp = urllib.request.urlopen(req).read()
print(json.loads(resp)["health"])
