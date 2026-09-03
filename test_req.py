import urllib.request, json

data = json.dumps({
  "timestamp_s": 0.0,
  "rpm": 4800,
  "true_cht": 106,
  "sensor_cht": 106,
  "egt": 840,
  "oil_pressure": 3.85,
  "oil_temp": 98,
  "fuel_flow": 26,
  "vibration": 0.28,
  "battery_voltage": 28.4,
  "injection_timing": 18.5,
  "health_index": 0.98,
  "altitude": 14500,
  "ambient_temp": -12.5,
  "throttle": 78.5
}).encode("utf-8")

req = urllib.request.Request("http://127.0.0.1:8001/api/health-rul/predict", data=data, headers={"Content-Type": "application/json"})
resp = urllib.request.urlopen(req).read()
print(json.loads(resp))
