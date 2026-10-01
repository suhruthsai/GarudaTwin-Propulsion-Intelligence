/**
 * Unified Prognostics & Maintenance Pipeline Orchestrator
 * Connects:
 * Raw Telemetry -> Data Quality -> Feature Engineering -> Degradation -> RUL -> Failure Risk -> Maintenance Advisory
 */

import { DataQualityGuard } from './data_quality.js';
import { FeatureEngineer } from './feature_engineering.js';
import { DegradationEstimator } from './degradation_model.js';
import { RulPredictor } from './rul_model.js';
import { FailureRiskModel } from './failure_risk.js';
import { MaintenanceAdvisor } from './maintenance_advisor.js';

const dataGuard = new DataQualityGuard();

export class PrognosticsPipeline {
  static evaluate({
    telemetry,
    missionDemandHours = 6.0,
    unitId = 'Vahak-1'
  }) {
    if (!telemetry || !telemetry.engine) {
      return null;
    }

    const activeFault = telemetry.health?.activeFault || 'NONE';

    // 1. Data Quality Layer
    const dqResult = dataGuard.validate(telemetry);
    const cleanEngine = dqResult.cleanEngine;

    // 2. Feature Engineering & Residuals
    const features = FeatureEngineer.extractFeatures(cleanEngine, {
      altitudeFt: telemetry.mission?.altitudeFt || 14500,
      throttlePct: telemetry.mission?.throttlePct || 78.5
    });

    // 3. Multi-Stress Degradation Estimation
    const degResult = DegradationEstimator.evaluate(cleanEngine, features, activeFault);

    // 4. RUL Prediction & Bayesian Forecast Trajectory
    const rulResult = RulPredictor.predict(
      degResult.healthIndex,
      degResult.activeRatePerHour,
      degResult.stressBreakdown.combinedStress,
      1248.6 // accumulated flight hours
    );

    // Adjust RUL for severe faults
    if (activeFault === 'CYL3_INJECTOR') {
      rulResult.rulHours = Number(Math.max(1.8, rulResult.rulHours * 0.08).toFixed(1));
    } else if (activeFault === 'OIL_PUMP_CAVITATION') {
      rulResult.rulHours = Number(Math.max(0.6, rulResult.rulHours * 0.03).toFixed(1));
    } else if (activeFault === 'PRGB_DEGRADATION') {
      rulResult.rulHours = Number(Math.max(4.5, rulResult.rulHours * 0.15).toFixed(1));
    } else if (activeFault === 'BLOW_BY') {
      rulResult.rulHours = Number(Math.max(14.0, rulResult.rulHours * 0.28).toFixed(1));
    } else if (activeFault === 'TURBO_WASTEGATE_STUCK') {
      rulResult.rulHours = Number(Math.max(8.5, rulResult.rulHours * 0.20).toFixed(1));
    }

    // 5. Failure Risk & Multi-Horizon Evaluation
    const riskResult = FailureRiskModel.evaluate(
      degResult.edi,
      rulResult.rulHours,
      degResult.trend,
      degResult.activeRatePerHour
    );

    // 6. Maintenance Advisory State Machine
    const advisoryResult = MaintenanceAdvisor.evaluate({
      healthIndex: degResult.healthIndex,
      edi: degResult.edi,
      rulHours: rulResult.rulHours,
      riskLevel: riskResult.riskLevel,
      trend: degResult.trend,
      engine: cleanEngine,
      features,
      activeFault,
      missionDemandHours
    });

    // 7. XAI Anomaly Attributions (matching PINN Autoencoder & SHAP weights)
    const xaiAttributions = this.computeXaiAttributions(cleanEngine, features, activeFault);

    // 8. Composite Response Schema
    return {
      unitId,
      timestamp: Date.now(),
      dataQuality: {
        score: dqResult.qualityScore,
        sensorConfidence: dqResult.sensorConfidence,
        telemetryAgeMs: dqResult.telemetryAgeMs,
        valid: dqResult.valid,
        outliers: dqResult.outliers
      },
      health: {
        index: degResult.healthIndex,
        status: degResult.healthIndex < 40 ? 'CRITICAL' : degResult.healthIndex < 75 ? 'DEGRADED' : 'NOMINAL',
        activeFault,
        probableFault: activeFault === 'NONE' ? 'NOMINAL BASELINE' : activeFault.replace(/_/g, ' '),
        faultConfidence: activeFault === 'NONE' ? 70 : 96,
        overallAnomalyScore: Number((degResult.edi / 100 * 0.95 + 0.15).toFixed(2))
      },
      degradation: {
        edi: degResult.edi,
        trend: degResult.trend,
        ratePerHour: degResult.activeRatePerHour,
        stressBreakdown: degResult.stressBreakdown,
        subsystems: degResult.subsystemDegradation,
        changePointHoursAgo: degResult.changePointHoursAgo
      },
      rul: {
        hours: rulResult.rulHours,
        lower95: rulResult.rulLower95,
        upper95: rulResult.rulUpper95,
        confidencePct: rulResult.confidencePct,
        melLimit: rulResult.melLimit,
        minDispatchRul: rulResult.minDispatchRul,
        accumFlightHours: rulResult.accumFlightHours,
        baseTboHours: rulResult.baseTboHours,
        trajectory: rulResult.trajectory,
        historicalHealth: rulResult.historicalHealthPoints,
        historicalRul: rulResult.historicalRulPoints
      },
      risk: {
        score: riskResult.riskScore,
        pct: riskResult.riskPct,
        level: riskResult.riskLevel,
        multiHorizon: riskResult.multiHorizon
      },
      advisory: advisoryResult,
      features,
      xaiAttributions,
      modelMetadata: {
        name: 'Browser physics fallback (AI service offline; not the trained models)',
        version: '1.2.0',
        dataset: 'None (rule/physics heuristics in the browser)',
        featuresCount: null,
        tboHours: 2000,
        melThresholdPct: 50,
        disclaimer: 'AI-assisted prototype decision support only. Follow Rotax 915-iS AMM statutory procedures.'
      }
    };
  }

  static computeXaiAttributions(engine, features, activeFault) {
    const isFault = activeFault !== 'NONE';

    let knockWeight = -35;
    let crankWeight = -33;
    let egtWeight = -20;
    let chtWeight = -18;
    let oilWeight = -12;
    let coolWeight = -8;

    if (activeFault === 'CYL3_INJECTOR') {
      egtWeight = -58;
      chtWeight = -42;
      knockWeight = -28;
    } else if (activeFault === 'OIL_PUMP_CAVITATION') {
      oilWeight = -64;
      crankWeight = -38;
      knockWeight = -22;
    } else if (activeFault === 'PRGB_DEGRADATION') {
      crankWeight = -68;
      knockWeight = -44;
    } else if (activeFault === 'BLOW_BY') {
      oilWeight = -52;
      chtWeight = -35;
      crankWeight = -26;
    } else if (activeFault === 'TURBO_WASTEGATE_STUCK') {
      egtWeight = -48;
      knockWeight = -45;
      chtWeight = -30;
    }

    return [
      {
        name: 'Piezoelectric Knock RMS Voltage',
        weight: `${knockWeight}%`,
        description: 'High-frequency block acoustic emission from end-gas auto-ignition.',
        status: Math.abs(knockWeight) > 40 ? 'CRITICAL' : Math.abs(knockWeight) > 25 ? 'ELEVATED' : 'NOMINAL'
      },
      {
        name: 'Crankshaft 2X Torsional Harmonic',
        weight: `${crankWeight}%`,
        description: 'Tri-axial accelerometer FFT spectral energy at 2nd order crankshaft harmonic.',
        status: Math.abs(crankWeight) > 40 ? 'CRITICAL' : Math.abs(crankWeight) > 25 ? 'ELEVATED' : 'NOMINAL'
      },
      {
        name: 'Exhaust Gas Temperature Disparity',
        weight: `${egtWeight}%`,
        description: 'Turbine inlet runner thermocouple temperature gradient.',
        status: Math.abs(egtWeight) > 40 ? 'CRITICAL' : Math.abs(egtWeight) > 25 ? 'ELEVATED' : 'NOMINAL'
      },
      {
        name: 'Cylinder CHT Thermal Spread',
        weight: `${chtWeight}%`,
        description: 'Thermocouple dispersion across 4 boxer cylinder heads.',
        status: Math.abs(chtWeight) > 40 ? 'CRITICAL' : Math.abs(chtWeight) > 25 ? 'ELEVATED' : 'NOMINAL'
      },
      {
        name: 'Oil Line Pressure Residual (ΔP)',
        weight: `${oilWeight}%`,
        description: 'Dynamic pressure drop across full-flow oil filter and hydrodynamic journal bearings.',
        status: Math.abs(oilWeight) > 40 ? 'CRITICAL' : Math.abs(oilWeight) > 25 ? 'ELEVATED' : 'NOMINAL'
      },
      {
        name: 'Coolant Radiator Return Delta T',
        weight: `${coolWeight}%`,
        description: 'Heat exchanger thermal rejection rate based on dual radiator core thermistors.',
        status: Math.abs(coolWeight) > 40 ? 'CRITICAL' : Math.abs(coolWeight) > 25 ? 'ELEVATED' : 'NOMINAL'
      }
    ];
  }
}
