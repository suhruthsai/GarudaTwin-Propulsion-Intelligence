"""
Performance Monitor Utility
Tracks microsecond latencies across all AI pipeline processing stages.
"""

import time
from typing import Dict, Any


class PerformanceMonitor:
    """
    Performance monitoring utility measuring latency per stage.
    """

    def __init__(self):
        self.reset()

    def reset(self):
        self.stage_times: Dict[str, float] = {}

    def record_stage(self, stage_name: str, duration_ms: float):
        """Records latency for a named pipeline stage in milliseconds."""
        self.stage_times[stage_name] = round(duration_ms, 2)

    def get_summary(self) -> Dict[str, float]:
        """Returns total pipeline latency and per-stage breakdown."""
        total_ms = round(sum(self.stage_times.values()), 2)
        summary = self.stage_times.copy()
        summary["total_pipeline_ms"] = total_ms
        return summary
