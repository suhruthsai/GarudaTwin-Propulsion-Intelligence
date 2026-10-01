"""
Pydantic Data Schemas for AI Health & RUL System
Defines strongly-typed inputs, outputs, anomalies, prognostic predictions, pilot advisories,
subsystem degradation, and full maintenance advisory for the MALE UAV Digital Twin.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class TelemetryInputFrame(BaseModel):
    """
    Documented telemetry frame for POST /api/health-rul/predict (all channels optional;
    missing channels are imputed as nominal). There is intentionally no health_index input:
    health is a model output, and any health_index sent by a client is ignored.
    """
    uav_id: str = Field("default", description="Vehicle id; inference state is kept per vehicle")
    sim_time_s: Optional[float] = Field(None, description="Simulator/mission time (s), preferred time base")
    timestamp_s: Optional[float] = Field(None, description="Wall-clock timestamp (s), fallback time base")
    rpm: float = Field(4800.0, description="Engine crankshaft RPM")
    throttle: float = Field(78.5, description="Throttle position (%)")
    egt: List[float] = Field(default_factory=lambda: [840.0] * 4, description="EGT per cylinder (°C)")
    cht: List[float] = Field(default_factory=lambda: [106.0] * 4, description="CHT per cylinder (°C)")
    map_bar: Optional[float] = Field(None, description="Manifold absolute pressure (bar)")
    oil_pressure: Optional[float] = Field(None, description="Oil pressure (bar)")
    oil_temp: Optional[float] = Field(None, description="Oil temperature (°C)")
    vibration: Optional[float] = Field(None, description="Engine vibration (g-RMS)")
    fuel_flow: Optional[float] = Field(None, description="Fuel flow (L/h)")
    lambda_: Optional[float] = Field(None, alias="lambda", description="Air-fuel equivalence ratio")
    gen_voltage: Optional[float] = Field(None, description="Generator bus voltage (V)")
    gen_current: Optional[float] = Field(None, description="Generator current (A)")
    coolant_temp: Optional[float] = Field(None, description="Coolant temperature (°C)")


class DataQualitySummary(BaseModel):
    """Summary metrics from Data Quality Guard preprocessing."""
    valid: bool = True
    missing_count: int = 0
    imputed_fields: List[str] = Field(default_factory=list)
    outliers_detected: List[str] = Field(default_factory=list)
    failed_sensors: List[str] = Field(default_factory=list, description="Sensors detected as stuck/failed and excluded")
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
    suspect_sensor: Optional[str] = Field(None, description="Sensor channel implicated by a SENSOR_DRIFT / SENSOR_FAILURE diagnosis")


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
    model_name: str = "Mahalanobis residual detector + XGBoost"
    version: str = "2.0.0"
    training_dataset: str = "GarudaTwin engine simulator"
    num_features: int = 45
    feature_engineering: str = "Golden-twin physics residuals + rolling mean/std"
    validation_mae_hours: float = 0.0
    validation_rmse_hours: Optional[float] = None
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
    model_features: Dict[str, float] = Field(default_factory=dict, description="Engineered feature vector scored by the models")
    pipeline_latency_ms: float
