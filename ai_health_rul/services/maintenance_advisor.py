"""
Maintenance Advisory Engine
Implements a rules-based advisory state machine that consumes prognostics outputs
(health, EDI, RUL, degradation trend, fault classification, mission demand) and
produces structured, evidence-based maintenance recommendations.

This is NOT a certified aircraft maintenance system. It is an AI-assisted prototype
advisory for research and decision support only.
"""

from typing import List, Dict, Any, Optional
import numpy as np

from ..schemas.health_rul_schema import (
    MaintenanceAdvisory,
    EvidenceItem,
    SubsystemDegradation,
    StressBreakdown,
)


# -----------------------------------------------------------------------
# Advisory Thresholds — Centralised, not scattered in UI components
# -----------------------------------------------------------------------
class AdvisoryThresholds:
    """Single source of truth for all advisory decision boundaries."""

    # EDI (Engine Degradation Index 0-100)
    EDI_MONITOR_MAX: float = 10.0        # Below this → MONITOR
    EDI_INSPECTION_MAX: float = 28.0     # Below this → INSPECTION
    EDI_MAINTENANCE_MAX: float = 48.0    # Below this → MAINTENANCE
    EDI_RESTRICTION_MAX: float = 68.0    # Below this → MISSION_RESTRICTION
    # Above EDI_RESTRICTION_MAX → ENGINEERING_REVIEW

    # RUL thresholds relative to mission demand
    RUL_MARGIN_INSPECTION_FACTOR: float = 4.0   # RUL < 4× mission → INSPECTION
    RUL_MARGIN_MAINTENANCE_FACTOR: float = 2.0  # RUL < 2× mission → MAINTENANCE
    RUL_MARGIN_RESTRICTION_FACTOR: float = 1.0  # RUL < 1× mission → RESTRICTION

    # Stress thresholds for evidence generation
    THERMAL_STRESS_WARN: float = 1.25
    MECHANICAL_STRESS_WARN: float = 1.20
    LUBRICATION_STRESS_CRITICAL: float = 1.80
    DEGRADATION_RATE_WARN: float = 0.10   # %/hr
    DEGRADATION_RATE_CRITICAL: float = 0.22


# -----------------------------------------------------------------------
# Urgency Labels (human-readable)
# -----------------------------------------------------------------------
URGENCY_LABELS = {
    "MONITOR": "CONTINUE MONITORING",
    "INSPECTION": "INSPECTION ADVISED",
    "MAINTENANCE": "MAINTENANCE REQUIRED",
    "MISSION_RESTRICTION": "MISSION RESTRICTION ADVISED",
    "ENGINEERING_REVIEW": "ENGINEERING REVIEW — REMOVE FROM SERVICE",
}

SUGGESTED_WINDOWS = {
    "MONITOR": "Standard TBO interval (next 50-hr scheduled check)",
    "INSPECTION": "Within 5–10 operating hours or before next extended mission",
    "MAINTENANCE": "Before next mission — schedule maintenance within 24 hours",
    "MISSION_RESTRICTION": "Immediate — before any further flight operations",
    "ENGINEERING_REVIEW": "Ground aircraft now — engineering review required",
}


class MaintenanceAdvisorEngine:
    """
    Stateless advisory state machine.
    Accepts prognostics outputs, returns structured MaintenanceAdvisory.
    All thresholds are centralised in AdvisoryThresholds.
    """

    T = AdvisoryThresholds()

    def generate(
        self,
        *,
        health_index: float,
        edi: float,
        rul_hours: float,
        degradation_trend: str,
        degradation_rate: float,
        diagnosed_fault: str,
        severity_level: str,
        stress: StressBreakdown,
        subsys: SubsystemDegradation,
        mission_demand_hours: float,
        feature_attributions: List[Any],
        raw_telemetry: Dict[str, float],
        nominal: Optional[Dict[str, float]] = None,
        suspect_sensor: Optional[str] = None,
    ) -> MaintenanceAdvisory:
        """
        Main entry point: evaluates all evidence and produces advisory.
        """
        reasons: List[str] = []
        evidence: List[EvidenceItem] = []
        affected: List[str] = []

        # ------------------------------------------------------------------
        # 1. Collect Evidence: live telemetry vs golden-twin nominal at this operating point
        # ------------------------------------------------------------------
        nom = nominal or {"egt": 840.0, "cht": 106.0, "oil_pressure": 3.85, "oil_temp": 98.0,
                          "vibration": 0.28, "map_bar": 1.42, "gen_voltage": 28.4, "coolant_temp": 88.5}
        # (feature, key, unit, caution residual, weight per unit, subsystem, signed direction)
        checks = [
            ("Exhaust Gas Temperature (EGT)", "egt", "°C", 40.0, 1 / 8.0, "COMBUSTION", +1),
            ("Cylinder Head Temperature (CHT)", "cht", "°C", 12.0, 1 / 3.5, "THERMAL", +1),
            ("Oil Pressure", "oil_pressure", "bar", 0.5, 1 / 0.06, "LUBRICATION", -1),
            ("Oil Temperature", "oil_temp", "°C", 10.0, 1 / 1.5, "LUBRICATION", +1),
            ("Engine Vibration (g-RMS)", "vibration", "g-RMS", 0.25, 1 / 0.01, "MECHANICAL", +1),
            ("Manifold Pressure (MAP)", "map_bar", "bar", 0.15, 1 / 0.01, "INDUCTION", +1),
            ("Generator Bus Voltage", "gen_voltage", "V", 1.2, 1 / 0.1, "ELECTRICAL", -1),
            ("Coolant Temperature", "coolant_temp", "°C", 10.0, 1 / 1.0, "THERMAL", +1),
        ]
        for feature, key, unit, caution, weight, subsystem, sign in checks:
            obs = raw_telemetry.get(key)
            if obs is None:
                continue
            dev = obs - nom[key]
            if sign * dev <= caution:
                continue
            evidence.append(EvidenceItem(
                feature=feature,
                contribution_pct=round(min(60.0, abs(dev) * weight), 1),
                direction="increases_risk",
                observed_value=round(obs, 3 if unit in ("bar", "g-RMS") else 1),
                nominal_value=round(nom[key], 3 if unit in ("bar", "g-RMS") else 1),
                residual=round(dev, 3 if unit in ("bar", "g-RMS") else 1),
                unit=unit,
            ))
            affected.append(subsystem)
            reasons.append(f"{feature} {obs:.2f} {unit} vs golden-twin nominal {nom[key]:.2f} {unit} (residual {dev:+.2f})")

        # Degradation rate
        if degradation_rate > self.T.DEGRADATION_RATE_WARN:
            reasons.append(
                f"Degradation rate {degradation_rate:.3f}%/hr — trend: {degradation_trend}"
            )

        # Diagnosed fault
        if diagnosed_fault not in ["none", "NONE", "NOMINAL", "NOMINAL_OPERATION", "healthy"]:
            readable = diagnosed_fault.replace("_", " ").title()
            reasons.append(f"Active fault classification: {readable}")

        # Mission margin
        mission_margin = rul_hours - mission_demand_hours
        if mission_margin < 0:
            reasons.append(
                f"Estimated RUL ({rul_hours:.1f} hr) is BELOW mission demand ({mission_demand_hours:.1f} hr) — "
                f"margin = {mission_margin:.1f} hr"
            )
        elif mission_margin < mission_demand_hours:
            reasons.append(
                f"RUL margin ({mission_margin:.1f} hr) is less than one additional mission duration"
            )

        # Sort evidence by contribution
        evidence.sort(key=lambda x: x.contribution_pct, reverse=True)

        # TreeSHAP attributions are returned separately (feature_attributions); the evidence
        # table only lists measured residuals so every row has observed and nominal values.

        # ------------------------------------------------------------------
        # 2. Determine Advisory Action via State Machine
        # ------------------------------------------------------------------
        if diagnosed_fault in ("SENSOR_DRIFT", "SENSOR_FAILURE"):
            # Instrumentation fault: the engine is not degraded — inspect/recalibrate the sensor
            action, priority = "INSPECTION", "MEDIUM"
            affected = ["SENSORS"]
            reasons.insert(0, f"{diagnosed_fault.replace('_', ' ').title()}: {suspect_sensor or 'sensor'} — reading inconsistent "
                              f"with physically coupled channels; engine parameters otherwise consistent with the golden twin")
        else:
            action, priority = self._determine_action(
                edi=edi,
                rul_hours=rul_hours,
                mission_demand_hours=mission_demand_hours,
                degradation_trend=degradation_trend,
                severity_level=severity_level,
            )

        # ------------------------------------------------------------------
        # 3. Mission Impact String
        # ------------------------------------------------------------------
        if mission_margin >= 0:
            mission_impact = (
                f"MISSION FEASIBLE — RUL margin +{mission_margin:.1f} hr "
                f"({rul_hours:.1f} hr RUL vs {mission_demand_hours:.1f} hr demand)"
            )
        else:
            mission_impact = (
                f"MISSION RISK REVIEW REQUIRED — RUL margin {mission_margin:.1f} hr "
                f"({rul_hours:.1f} hr RUL vs {mission_demand_hours:.1f} hr demand)"
            )

        # Deduplicate affected subsystems
        affected = list(dict.fromkeys(affected))

        # If no specific subsystem identified, use stress breakdown
        if not affected:
            stresses = {
                "THERMAL": stress.thermalStress,
                "MECHANICAL": stress.mechanicalStress,
                "LUBRICATION": stress.lubricationStress,
                "COMBUSTION": stress.combustionStress,
            }
            max_sub = max(stresses, key=stresses.get)
            if stresses[max_sub] > 1.1:
                affected = [max_sub]

        if not reasons:
            reasons = ["All engine parameters within nominal operating limits — routine monitoring active"]

        return MaintenanceAdvisory(
            action=action,
            priority=priority,
            affectedSubsystems=affected,
            reason=reasons,
            evidence=evidence,
            suggestedWindow=SUGGESTED_WINDOWS[action],
            missionImpact=mission_impact,
            missionMarginHours=round(mission_margin, 2),
            urgencyLabel=URGENCY_LABELS[action],
        )

    def _determine_action(
        self,
        *,
        edi: float,
        rul_hours: float,
        mission_demand_hours: float,
        degradation_trend: str,
        severity_level: str,
    ):
        """
        Advisory State Machine — maps prognostic state to action + priority.
        Centralised thresholds only, no magic numbers in calling code.
        """
        T = self.T
        is_critical_fault = severity_level == "CRITICAL"
        is_rapidly_degrading = degradation_trend in ("Rapidly Degrading",)

        # ENGINEERING_REVIEW
        if is_critical_fault or edi >= T.EDI_RESTRICTION_MAX or rul_hours < 2.0:
            return "ENGINEERING_REVIEW", "CRITICAL"

        # MISSION_RESTRICTION
        if (
            edi >= T.EDI_MAINTENANCE_MAX
            or rul_hours < mission_demand_hours * T.RUL_MARGIN_RESTRICTION_FACTOR
            or (is_rapidly_degrading and edi > 35)
        ):
            return "MISSION_RESTRICTION", "HIGH"

        # MAINTENANCE
        if (
            edi >= T.EDI_INSPECTION_MAX
            or rul_hours < mission_demand_hours * T.RUL_MARGIN_MAINTENANCE_FACTOR
        ):
            return "MAINTENANCE", "HIGH"

        # INSPECTION
        if (
            edi >= T.EDI_MONITOR_MAX
            or rul_hours < mission_demand_hours * T.RUL_MARGIN_INSPECTION_FACTOR
            or degradation_trend == "Degrading"
            or severity_level == "ELEVATED"
        ):
            return "INSPECTION", "MEDIUM"

        # MONITOR
        return "MONITOR", "LOW"
