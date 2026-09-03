import unittest
import pandas as pd

from ai_health_rul.inference.rul_predictor import RulPredictor
from ai_health_rul.services.health_rul_service import HealthRulService

class TestAiHealthRulModule(unittest.TestCase):
    def setUp(self):
        self.nominal_telemetry = {
            "timestamp_s": 10.0,
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

        self.fault_telemetry = {
            "timestamp_s": 15.0,
            "rpm": 4850.0,
            "true_cht": 138.0,
            "sensor_cht": 138.0,
            "egt": 945.0,
            "oil_pressure": 2.1,   
            "oil_temp": 125.0,
            "fuel_flow": 28.0,
            "vibration": 1.45,   
            "battery_voltage": 28.0,
            "injection_timing": 18.5,
            "health_index": 0.45,
            "altitude": 14500.0,
            "ambient_temp": -12.5,
            "throttle": 78.5,
        }
        
        self.ood_telemetry = self.nominal_telemetry.copy()
        self.ood_telemetry["rpm"] = 7000.0

    def test_ood_rejection(self):
        predictor = RulPredictor()
        df = pd.DataFrame([self.ood_telemetry] * 35)
        with self.assertRaisesRegex(ValueError, "OUT_OF_DISTRIBUTION"):
            predictor.predict(
                feature_df=df,
                raw_telemetry=self.ood_telemetry,
                anomaly_score=0.1
            )

    def test_health_monotonically_decreases(self):
        service = HealthRulService()
        for _ in range(20):
            service.predict(self.nominal_telemetry)
        res1 = service.predict(self.nominal_telemetry)
        
        for _ in range(5):
            service.predict(self.fault_telemetry)
        res2 = service.predict(self.fault_telemetry)
        
        self.assertLessEqual(res2.rul.healthIndexScore, res1.rul.healthIndexScore)
        self.assertLess(res2.rul.rulHours, res1.rul.rulHours)
        
    def test_advisory_priority(self):
        service = HealthRulService()
        for _ in range(35):
            service.predict(self.nominal_telemetry)
        
        res_nom = service.predict(self.nominal_telemetry)
        self.assertEqual(res_nom.maintenance.priority, "LOW")
        self.assertEqual(res_nom.maintenance.action, "MONITOR")
        
        res_fault = service.predict(self.fault_telemetry)
        self.assertEqual(res_fault.maintenance.priority, "CRITICAL")
        self.assertIn(res_fault.maintenance.action, ["ENGINEERING_REVIEW", "MISSION_RESTRICTION", "MAINTENANCE"])

if __name__ == "__main__":
    unittest.main()
