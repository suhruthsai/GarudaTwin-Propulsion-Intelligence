"""
AI service access control: only the gateway (holding the internal key) may call it,
and browsers get no CORS grant.
"""

import unittest
from unittest import mock

from fastapi.testclient import TestClient

import ai_service

KEY = "k" * 64
FRAME = {"uav_id": "SEC-TEST", "rpm": 4800, "throttle": 78.5, "egt": [840] * 4, "cht": [106] * 4}


class TestAiServiceSecurity(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(ai_service.app)

    def post(self, headers=None):
        return self.client.post("/api/health-rul/predict", json=FRAME, headers=headers or {})

    def test_health_endpoint_is_public(self):
        with mock.patch.dict("os.environ", {"GCS_INTERNAL_KEY": KEY}):
            self.assertEqual(self.client.get("/health").status_code, 200)

    def test_missing_or_wrong_key_rejected(self):
        with mock.patch.dict("os.environ", {"GCS_INTERNAL_KEY": KEY}):
            self.assertEqual(self.post().status_code, 401)
            self.assertEqual(self.post({"X-Internal-Key": "wrong"}).status_code, 401)
            self.assertEqual(self.client.post("/rl-replan", json={}).status_code, 401)
            self.assertEqual(self.client.post("/detect-anomaly", json={}).status_code, 401)

    def test_correct_key_accepted(self):
        with mock.patch.dict("os.environ", {"GCS_INTERNAL_KEY": KEY}):
            r = self.post({"X-Internal-Key": KEY})
            self.assertEqual(r.status_code, 200)
            self.assertIn("health", r.json())

    def test_fails_closed_when_no_key_configured(self):
        import os
        import tempfile
        from pathlib import Path
        env = {k: v for k, v in os.environ.items() if k != "GCS_INTERNAL_KEY"}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict("os.environ", env, clear=True), \
                mock.patch.object(ai_service, "DATA_DIR", Path(tmp)):
            ai_service._key_cache.update(mtime=None, key=None)
            self.assertEqual(self.post({"X-Internal-Key": "anything"}).status_code, 503)

    def test_no_cors_grant_for_browsers(self):
        with mock.patch.dict("os.environ", {"GCS_INTERNAL_KEY": KEY}):
            r = self.client.options("/api/health-rul/predict", headers={
                "Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
            self.assertNotIn("access-control-allow-origin", {k.lower() for k in r.headers})
            r = self.post({"X-Internal-Key": KEY, "Origin": "http://evil.example"})
            self.assertNotIn("access-control-allow-origin", {k.lower() for k in r.headers})


if __name__ == "__main__":
    unittest.main()
