"""
Pydantic Data Schemas for AI Health & RUL System
Defines strongly-typed inputs, outputs, anomalies, prognostic predictions, pilot advisories,
subsystem degradation, and full maintenance advisory for the MALE UAV Digital Twin.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class TelemetryInputFrame(BaseModel):
    """Raw telemetry frame received from CAN bus or digital twin stream."""
    timestamp_s: float = Field(0.0, description="Timestamp in seconds")
    rpm: float = Field(4800.0, ge=0.0, le=7000.0, description="Engine crankshaft RPM")
    true_cht: float = Field(106.0, description="Actual cylinder head temperature (°C)")
    sensor_cht: float = Field(106.0, description="Measured sensor CHT (°C)")
    egt: float = Field(840.0, description="Exhaust gas temperature (°C)")
    oil_pressure: float = Field(3.85, description="Oil pressure (bar / PSI)")
    oil_temp: float = Field(98.0, description="Oil temperature (°C)")
    fuel_flow: float = Field(26.0, description="Fuel flow rate (L/h or GPH)")
    vibration: float = Field(0.28, description="Engine block vibration (g-RMS / IPS)")
    battery_voltage: float = Field(28.4, description="FADEC bus voltage (V)")
    injection_timing: float = Field(18.5, description="Injection timing BTDC (°)")
    health_index: float = Field(0.98, ge=0.0, le=1.0, description="Instantaneous health index (0-1)")
    altitude: float = Field(14500.0, description="Flight altitude (ft or m)")
    ambient_temp: float = Field(-12.5, description="Ambient air temperature (°C)")
    throttle: float = Field(78.5, ge=0.0, le=100.0, description="Commanded throttle position (%)")


class DataQualitySummary(BaseModel):
    """Summary metrics from Data Quality Guard preprocessing."""
    valid: bool = True
    missing_count: int = 0
    imputed_fields: List[str] = Field(default_factory=list)
    outliers_detected: List[str] = Field(default_factory=list)
    packet_loss_simulated: bool = False
    quality_score_pct: float = Field(default=96.0, description="Composite data quality score 0-100")
    sensor_confidence_pct: float = Field(default=93.0, description="Weighted sensor confidence 0-100")
    telemetry_age_ms: float = Field(default=100.0, description="Age of last telemetry frame in ms")


class HealthPredictionResult(BaseModel):
    """Machine learning health classification & anomaly detection outputs."""
    is_anomaly: bool
    anomaly_score: float
    reconstruction_mse: float = 0.0
    threshold: float
    confidence_pct: float
    diagnosed_fault: str
    severity_level: str  # 'NOMINAL' | 'ELEVATED' | 'CRITICAL'
    class_probabilities: Dict[str, float] = Field(default_factory=dict)


class RulTrajectoryPoint(BaseModel):
    """Forecast trajectory point with Bayesian confidence bounds."""
    hoursElapsed: float
    predictedHealth: float
    upperConfidence: float
    lowerConfidence: float
    thresholdLimit: float = 50.0


class HistoricalTrendPoint(BaseModel):
    """Historical trend point for health index and estimated RUL."""
    hoursOffset: float
    label: str
    value: float


class StressBreakdown(BaseModel):
    """Multi-physics stress factors accelerating fatigue."""
    thermalStress: float
    mechanicalStress: float
    lubricationStress: float
    combustionStress: float
    operatingStress: float
    combinedStress: float


class SubsystemDegradation(BaseModel):
    """Per-subsystem degradation score 0-100 derived from stress decomposition."""
    thermal: float = Field(default=0.0, description="Thermal subsystem degradation %")
    mechanical: float = Field(default=0.0, description="Mechanical/vibration subsystem degradation %")
    lubrication: float = Field(default=0.0, description="Lubrication system degradation %")
    combustion: float = Field(default=0.0, description="Combustion system degradation %")
    fuel: float = Field(default=0.0, description="Fuel system degradation %")
    electrical: float = Field(default=0.0, description="Electrical system degradation %")


class EvidenceItem(BaseModel):
    """Single evidence item for maintenance advisory explanation."""
    feature: str
    contribution_pct: float
    direction: str  # 'increases_risk' | 'normalizing'
    observed_value: Optional[float] = None
    nominal_value: Optional[float] = None
    residual: Optional[float] = None
    unit: str = ""


class MaintenanceAdvisory(BaseModel):
    """Full maintenance advisory output from the advisory state machine."""
    action: str  # 'MONITOR' | 'INSPECTION' | 'MAINTENANCE' | 'MISSION_RESTRICTION' | 'ENGINEERING_REVIEW'
    priority: str  # 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
    affectedSubsystems: List[str] = Field(default_factory=list)
    reason: List[str] = Field(default_factory=list, description="Evidence-based human-readable reasons")
    evidence: List[EvidenceItem] = Field(default_factory=list)
    suggestedWindow: str = ""
    missionImpact: str = ""
    missionMarginHours: float = 0.0
    urgencyLabel: str = ""  # e.g. "INSPECTION ADVISED", "REMOVE FROM SERVICE"


class PrognosticsResult(BaseModel):
    """Remaining Useful Life (RUL) prediction output — extended with EDI and subsystem data."""
    rulHours: float
    rulHoursLower95: float = 0.0
    rulHoursUpper95: float = 0.0
    degradationRatePercentPerHour: float
    healthIndexScore: float
    engineDegradationIndex: float = Field(default=0.0, description="EDI 0-100, inverse of health")
    degradationTrend: str  # 'Stable' | 'Degrading' | 'Rapidly Degrading'
    confidencePct: float
    trajectory: List[RulTrajectoryPoint] = Field(default_factory=list)
    historicalHealthPoints: List[HistoricalTrendPoint] = Field(default_factory=list)
    historicalRulPoints: List[HistoricalTrendPoint] = Field(default_factory=list)
    stressBreakdown: StressBreakdown
    subsystemDegradation: SubsystemDegradation = Field(default_factory=SubsystemDegradation)
    overhaulThresholdHours: float = 2000.0
    missionMarginHours: float = 0.0
    changePointHoursAgo: Optional[float] = None
    failureRiskScore: float = Field(default=0.0, description="Failure probability 0-1")
    failureRiskLevel: str = Field(default="LOW", description="LOW | MEDIUM | HIGH | CRITICAL")
    multiHorizonRisk: Dict[str, float] = Field(
        default_factory=lambda: {"1hr": 0.0, "4hr": 0.0, "8hr": 0.0, "24hr": 0.0}
    )
    outOfDistribution: bool = Field(default=False, description="True if telemetry outside training distribution")


class XaiFeatureAttribution(BaseModel):
    """Feature attribution weight for TreeSHAP explainability."""
    feature: str
    importance_pct: float
    direction: str  # 'increases_risk' | 'normalizing'
    description: str


class PilotAdvisoryOutput(BaseModel):
    """Actionable pilot emergency checklist & adaptive mission replan."""
    level: str  # 'NOMINAL' | 'WARNING' | 'CRITICAL'
    action_plan: List[str] = Field(default_factory=list)
    derate_throttle_pct: Optional[float] = None
    recommended_rpm: Optional[float] = None
    target_recovery_field: Optional[str] = None


class ModelMetadata(BaseModel):
    """Model versioning and validation metrics for judge-facing transparency."""
    model_name: str = "RUL-XGBoost + IsolationForest"
    version: str = "1.2.0"
    training_dataset: str = "Rotax 915iS Physics-Informed Synthetic (C-MAPSS derived)"
    num_features: int = 71
    feature_engineering: str = "Rolling mean/std 30s & 60s windows + physics residuals"
    validation_mae_hours: float = 0.0
    validation_rmse_hours: float = 0.0
    anomaly_precision: float = 0.0
    anomaly_recall: float = 0.0
    inference_latency_ms: float = 0.0
    tbo_hours: float = 2000.0
    mel_threshold: float = 50.0
    data_source_note: str = (
        "AI-assisted prototype advisory. Physics-informed simulation data. "
        "NOT certified aircraft maintenance. Follows Rotax 915iS AMM reference only."
    )


class UnifiedHealthRulResponse(BaseModel):
    """Complete unified API response combining all sub-systems."""
    timestamp_s: float
    health: HealthPredictionResult
    rul: PrognosticsResult
    data_quality: DataQualitySummary
    feature_attributions: List[XaiFeatureAttribution] = Field(default_factory=list)
    advisory: PilotAdvisoryOutput
    maintenance: MaintenanceAdvisory = Field(default_factory=MaintenanceAdvisory)
    model_metadata: ModelMetadata = Field(default_factory=ModelMetadata)
    pipeline_latency_ms: float
