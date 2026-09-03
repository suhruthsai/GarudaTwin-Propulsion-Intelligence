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
    ) -> MaintenanceAdvisory:
        """
        Main entry point: evaluates all evidence and produces advisory.
        """
        reasons: List[str] = []
        evidence: List[EvidenceItem] = []
        affected: List[str] = []

        # ------------------------------------------------------------------
        # 1. Collect Evidence from Physics Residuals & Telemetry
        # ------------------------------------------------------------------
        rpm = raw_telemetry.get("rpm", 4800.0)
        egt = raw_telemetry.get("egt", 840.0)
        cht = raw_telemetry.get("true_cht", raw_telemetry.get("sensor_cht", 106.0))
        oil_p = raw_telemetry.get("oil_pressure", 3.85)
        oil_t = raw_telemetry.get("oil_temp", 98.0)
        vib = raw_telemetry.get("vibration", 0.28)

        # EGT deviation
        egt_dev = egt - 840.0
        if abs(egt_dev) > 40:
            evidence.append(EvidenceItem(
                feature="Exhaust Gas Temperature (EGT)",
                contribution_pct=round(abs(egt_dev) / 8.0, 1),
                direction="increases_risk" if egt_dev > 0 else "normalizing",
                observed_value=round(egt, 1),
                nominal_value=840.0,
                residual=round(egt_dev, 1),
                unit="°C"
            ))
            affected.append("COMBUSTION")
            reasons.append(
                f"EGT deviation {'+' if egt_dev>0 else ''}{egt_dev:.1f}°C above thermodynamic baseline (nominal 840°C)"
            )

        # CHT deviation
        cht_dev = cht - 106.0
        if abs(cht_dev) > 12:
            evidence.append(EvidenceItem(
                feature="Cylinder Head Temperature (CHT)",
                contribution_pct=round(abs(cht_dev) / 3.5, 1),
                direction="increases_risk",
                observed_value=round(cht, 1),
                nominal_value=106.0,
                residual=round(cht_dev, 1),
                unit="°C"
            ))
            affected.append("THERMAL")
            reasons.append(
                f"CHT elevated {cht_dev:.1f}°C above nominal — thermal dissipation degraded"
            )

        # Oil pressure
        oil_dev = oil_p - 3.85
        if oil_dev < -0.5:
            evidence.append(EvidenceItem(
                feature="Oil Pressure",
                contribution_pct=round(abs(oil_dev) / 0.06, 1),
                direction="increases_risk",
                observed_value=round(oil_p, 2),
                nominal_value=3.85,
                residual=round(oil_dev, 2),
                unit="bar"
            ))
            affected.append("LUBRICATION")
            reasons.append(
                f"Oil pressure {oil_p:.2f} bar — {abs(oil_dev):.2f} bar below hydrodynamic minimum"
            )

        # Vibration
        vib_dev = vib - 0.28
        if vib_dev > 0.25:
            pct = round(min(60.0, vib_dev / 0.01), 1)
            evidence.append(EvidenceItem(
                feature="Engine Vibration (g-RMS)",
                contribution_pct=pct,
                direction="increases_risk",
                observed_value=round(vib, 3),
                nominal_value=0.28,
                residual=round(vib_dev, 3),
                unit="g-RMS"
            ))
            affected.append("MECHANICAL")
            pct_above = round((vib / 0.28 - 1) * 100)
            reasons.append(
                f"Vibration {vib:.3f} g-RMS — {pct_above}% above nominal structural baseline (0.28 g-RMS)"
            )

        # Degradation rate
        if degradation_rate > self.T.DEGRADATION_RATE_WARN:
            reasons.append(
                f"Degradation rate {degradation_rate:.3f}%/hr — trend: {degradation_trend}"
            )

        # Diagnosed fault
        if diagnosed_fault not in ["none", "NOMINAL", "NOMINAL_OPERATION", "healthy"]:
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

        # Add attributions from SHAP (top 4 after telemetry evidence)
        for attr in feature_attributions[:4]:
            feat = getattr(attr, "feature", str(attr.get("feature", ""))) if isinstance(attr, dict) else attr.feature
            imp = getattr(attr, "importance_pct", 0.0) if not isinstance(attr, dict) else attr.get("importance_pct", 0.0)
            dir_ = getattr(attr, "direction", "increases_risk") if not isinstance(attr, dict) else attr.get("direction", "increases_risk")
            if not any(e.feature == feat for e in evidence):
                evidence.append(EvidenceItem(
                    feature=feat,
                    contribution_pct=round(float(imp), 1),
                    direction=dir_,
                    unit=""
                ))

        # ------------------------------------------------------------------
        # 2. Determine Advisory Action via State Machine
        # ------------------------------------------------------------------
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
