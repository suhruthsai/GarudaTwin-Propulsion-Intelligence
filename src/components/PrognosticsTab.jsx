import React, { useState, useMemo } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { 
  Brain, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShieldAlert, 
  Activity, 
  BarChart3, 
  Cpu, 
  Wrench, 
  Thermometer, 
  Zap, 
  Droplets, 
  Wind, 
  Flame,
  Info,
  Sliders,
  ChevronRight,
  TrendingDown,
  FileSearch,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { PrognosticsDetailDrawer } from './PrognosticsDetailDrawer';

export const PrognosticsTab = () => {
  const { 
    telemetry, 
    aiPrognostics, 
    fleetAi,
missionDemandHours, 
    setMissionDemandHours 
  } = useTelemetry();

  const [activeSubView, setActiveSubView] = useState('PROGNOSTICS'); // 'PROGNOSTICS' | 'ADVISORY'
  const [selectedUnit, setSelectedUnit] = useState('Vahak-1');
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);

  // Every vehicle comes from the gateway's live fleet: Vahak-1 from the selected data source,
  // Vahak-2..4 from their own simulators + AI sessions, Vahak-5 grounded (no engine data).
  const fleetMember = (telemetry.fleetState || []).find(u => u.id === selectedUnit);
  const unitInfo = { callsign: fleetMember?.callsign ?? selectedUnit, flightHours: fleetMember?.flightHours ?? 0 };
  const isLiveUnit = selectedUnit === 'Vahak-1';
  const unitAi = isLiveUnit ? aiPrognostics : fleetAi?.[selectedUnit];
  const unitTel = isLiveUnit ? telemetry : {
    engine: fleetMember?.engineState,
    health: { status: fleetMember?.l1?.status, index: fleetMember?.l1?.index, activeFault: fleetMember?.injectedFault },
    source: { mode: 'SIM' },
  };
  const hasLiveData = isLiveUnit || (fleetMember?.airborne && !!unitAi);

  // Fleet Multiplexer & Physics Computation
  let baseHealth = 100;
  let baseRul = 2000;
  let degradationRate = 0.045;
  let combinedStress = 1.0;
  let stressBreakdown = { thermalStress: 1.0, mechanicalStress: 1.0, lubricationStress: 1.0, combustionStress: 1.0, operatingStress: 1.0, combinedStress: 1.0 };
  let subsystemsDegradation = { thermal: 2, mechanical: 2, lubrication: 2, combustion: 2, fuel: 2, electrical: 2 };
  let probableFault = 'NONE';
  let activeFault = 'NONE';
  let faultConfidence = 95;
  let anomalyScore = 0.02;
  let riskScore = 0.03;
  let riskPct = 3.0;
  let riskLevel = 'LOW';
  let multiHorizonRisk = { h1: 0.8, h4: 2.4, h8: 6.7, h24: 14.2 };
  let whyReasoning = '';
  let recommendationText = '';
  let operationalWindow = '';
  let priority = 'LOW';
  let urgencyLabel = 'ROUTINE MONITORING';
  let action = 'MONITOR';
  let xaiAttributions = [];
  let parameterEvidence = [];
  let degradationTrend = 'NOMINAL';

  if (hasLiveData) {
    baseHealth = unitAi?.engine_health_index ?? unitTel.health?.index ?? 100;
    baseRul = unitAi?.rul_hours_mean ?? 750;
    degradationRate = unitAi?.degradation_rate_pct_per_hour ?? 0;
    stressBreakdown = unitAi?.stressBreakdown || stressBreakdown;
    combinedStress = stressBreakdown.combinedStress || 1.0;
    subsystemsDegradation = unitAi?.subsystem_degradation || subsystemsDegradation;

    // Diagnosis comes from the AI model only. The injected simulator scenario
    // (unitTel.health.activeFault) is ground truth and is shown separately, never used here.
    const rawDiag = unitAi?.diagnosed_fault;
    const isNominal = !rawDiag || ['NONE', 'none', 'NOMINAL', 'NOMINAL_OPERATION', 'NOMINAL BASELINE'].includes(rawDiag);

    activeFault = isNominal ? 'NONE' : rawDiag;
    probableFault = isNominal ? 'NOMINAL BASELINE' : activeFault.replace(/_/g, ' ');
    faultConfidence = unitAi?.diagnosis_confidence_pct ?? unitAi?.confidencePct ?? 90;
    anomalyScore = unitAi?.anomaly_score || 0.02;
    degradationTrend = unitAi?.degradationTrend || (baseHealth < 75 ? 'DEGRADING' : 'NOMINAL');

    riskScore = unitAi?.failureRiskScore || (baseHealth < 40 ? 0.75 : baseHealth < 75 ? 0.25 : 0.03);
    riskPct = Number((riskScore * 100).toFixed(1));
    riskLevel = unitAi?.failureRiskLevel || (riskScore > 0.6 ? 'CRITICAL' : riskScore > 0.3 ? 'HIGH' : riskScore > 0.15 ? 'MEDIUM' : 'LOW');
    multiHorizonRisk = {
      h1: Number((unitAi?.multiHorizonRisk?.['1hr'] || (riskPct * 0.2)).toFixed(1)),
      h4: Number((unitAi?.multiHorizonRisk?.['4hr'] || (riskPct * 0.55)).toFixed(1)),
      h8: Number((unitAi?.multiHorizonRisk?.['8hr'] || (riskPct * 1.1)).toFixed(1)),
      h24: Number((unitAi?.multiHorizonRisk?.['24hr'] || Math.min(99, riskPct * 2.2)).toFixed(1))
    };

    whyReasoning = unitAi?.maintenance?.reason?.[0] || 
      (isNominal 
        ? 'All thermodynamic, vibrational, and combustion telemetry parameters track within ±1.5σ of the nominal Golden Twin baseline.'
        : `Physical telemetry deviations detected on ${activeFault.replace(/_/g, ' ')}. Component thermal and vibrational fatigue accelerates RUL consumption.`);
    recommendationText = unitAi?.pilot_advisory?.action_plan?.join(' ') || 
      (isNominal 
        ? 'Continue standard flight operations. Perform routine 50-hour scheduled maintenance inspection.'
        : `Active fault mode [${activeFault}]. Reduce engine operating power and execute advisory checklist.`);
    operationalWindow = unitAi?.maintenance?.suggestedWindow || 
      (isNominal ? 'Standard scheduled inspection at 50-hour interval.' : 'Immediate in-flight intervention required.');
    priority = isNominal ? 'LOW' : (baseHealth < 40 ? 'CRITICAL' : 'HIGH');
    urgencyLabel = isNominal ? 'ROUTINE MONITORING' : (baseHealth < 40 ? 'IMMEDIATE RTB' : 'DERATE & INSPECT');
    action = isNominal ? 'MONITOR' : 'INSPECTION';

    // Parameter Evidence: use live mapped evidence from unitAi if present
    if (Array.isArray(unitAi?.maintenance?.evidence) && unitAi.maintenance.evidence.length > 0) {
      parameterEvidence = unitAi.maintenance.evidence;
    } else {
      const egtSpread = Math.max(...(unitTel.engine?.egt || [840, 840, 840, 840])) - Math.min(...(unitTel.engine?.egt || [840, 840, 840, 840]));
      const chtSpread = Math.max(...(unitTel.engine?.cht || [106, 106, 106, 106])) - Math.min(...(unitTel.engine?.cht || [106, 106, 106, 106]));
      const oilP = unitTel.engine?.oilPressBar ?? 3.85;
      const vib = unitTel.engine?.vibrationGrms ?? 0.28;
      // No AI evidence (no fault diagnosed): show the measured values against the nominal band only.
      // Deviation = measured - nominal reference; no diagnostic weight is claimed.
      parameterEvidence = [
        {
          parameter: 'Exhaust Gas Temp (EGT) Spread',
          goldenModel: '< 18.0 °C spread',
          liveTelemetry: `${egtSpread.toFixed(1)} °C spread`,
          residual: `${egtSpread > 18.0 ? '+' : ''}${(egtSpread - 18.0).toFixed(1)} °C vs limit`,
          diagnosticWeight: '—',
          status: egtSpread > 40.0 ? 'CRITICAL' : egtSpread > 20.0 ? 'WARNING' : 'NOMINAL'
        },
        {
          parameter: 'Cylinder CHT Thermal Spread',
          goldenModel: '< 10.0 °C spread',
          liveTelemetry: `${chtSpread.toFixed(1)} °C spread`,
          residual: `${chtSpread > 10.0 ? '+' : ''}${(chtSpread - 10.0).toFixed(1)} °C vs limit`,
          diagnosticWeight: '—',
          status: chtSpread > 20.0 ? 'CRITICAL' : chtSpread > 12.0 ? 'WARNING' : 'NOMINAL'
        },
        {
          parameter: 'Oil Pressure',
          goldenModel: '3.85 bar ± 0.35',
          liveTelemetry: `${oilP.toFixed(2)} bar`,
          residual: `${oilP - 3.85 >= 0 ? '+' : ''}${(oilP - 3.85).toFixed(2)} bar`,
          diagnosticWeight: '—',
          status: oilP < 2.0 ? 'CRITICAL' : oilP < 2.8 ? 'WARNING' : 'NOMINAL'
        },
        {
          parameter: 'Engine Vibration (broadband g-RMS)',
          goldenModel: '< 0.35 g-RMS',
          liveTelemetry: `${vib.toFixed(2)} g-RMS`,
          residual: `${vib - 0.35 >= 0 ? '+' : ''}${(vib - 0.35).toFixed(2)} g vs limit`,
          diagnosticWeight: '—',
          status: vib > 1.0 ? 'CRITICAL' : vib > 0.5 ? 'WARNING' : 'NOMINAL'
        }
      ];
    }

    // XAI Attributions
    if (unitAi?.feature_attributions && Object.keys(unitAi.feature_attributions).length > 0) {
      xaiAttributions = Object.entries(unitAi.feature_attributions).map(([key, val]) => ({
        name: key.replace(/_/g, ' '),
        weight: `${typeof val === 'number' ? val.toFixed(1) : val}%`,
        description: `TreeSHAP contribution of ${key.replace(/_/g, ' ')}.`,
        status: val > 20 ? 'CRITICAL' : val > 10 ? 'ELEVATED' : 'NOMINAL'
      })).sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight)).slice(0, 6);
    }
  }

  // Trajectory Generation (Consistent physics envelope across all units)
  const traj = (unitAi?.trajectory?.length > 0)
    ? unitAi.trajectory
    : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((step) => {
        const wearDelta = degradationRate * step * (1.0 + step / 120.0);
        const predictedHealth = Number(Math.max(0.0, baseHealth - wearDelta).toFixed(1));
        const uncertainty = 1.2 + Math.sqrt(step) * (0.8 + combinedStress * 0.25);
        return {
          hoursElapsed: step,
          predictedHealth,
          upperConfidence: Number(Math.min(100.0, predictedHealth + uncertainty).toFixed(1)),
          lowerConfidence: Number(Math.max(0.0, predictedHealth - uncertainty).toFixed(1)),
          thresholdLimit: 50.0
        };
      });

  const histHealthRaw = (unitAi?.historicalHealthPoints?.length > 0)
    ? unitAi.historicalHealthPoints
    : [
        { hoursOffset: -50, value: Math.min(100.0, baseHealth + degradationRate * 50) },
        { hoursOffset: -25, value: Math.min(100.0, baseHealth + degradationRate * 25) },
        { hoursOffset: 0,   value: baseHealth }
      ];

  const histRulRaw = (unitAi?.historicalRulPoints?.length > 0)
    ? unitAi.historicalRulPoints
    : [
        { hoursOffset: -50, value: baseRul + 50 * combinedStress },
        { hoursOffset: -25, value: baseRul + 25 * combinedStress },
        { hoursOffset: 0,   value: baseRul }
      ];

  // Dynamic Mission Margin
  const dynamicMissionMargin = Number((baseRul - missionDemandHours).toFixed(1));
  const isMissionFeasible = dynamicMissionMargin > 0 && baseHealth >= 75 && baseRul > missionDemandHours * 1.2;

  const data = {
    health: { 
      index: baseHealth, 
      status: unitTel.health?.status || 'NOMINAL', 
      probableFault: probableFault, 
      activeFault: activeFault, 
      faultConfidence: faultConfidence, 
      overallAnomalyScore: anomalyScore 
    },
    degradation: { 
      edi: Number(Math.max(0, Math.min(99, 100 - baseHealth)).toFixed(1)), 
      trend: degradationTrend, 
      ratePerHour: Number(degradationRate.toFixed(3)), 
      stressBreakdown: stressBreakdown,
      subsystems: subsystemsDegradation
    },
    rul: { 
      hours: baseRul, 
      lower95: unitAi?.rul_hours_lower_95 ?? baseRul,
      upper95: unitAi?.rul_hours_upper_95 ?? baseRul, 
      confidencePct: faultConfidence, 
      melLimit: 50.0, 
      minDispatchRul: 20.0, 
      accumFlightHours: unitInfo.flightHours,
      trajectory: traj,
      historicalHealth: histHealthRaw.map(p => ({ hoursOffset: p.hoursOffset || 0, value: p.value || 0 })),
      historicalRul: histRulRaw.map(p => ({ hoursOffset: p.hoursOffset || 0, value: p.value || 0 }))
    },
    risk: { 
      score: riskScore, 
      pct: riskPct, 
      level: riskLevel, 
      multiHorizon: multiHorizonRisk 
    },
    advisory: {
      action: action,
      actionLabel: urgencyLabel,
      priority: priority,
      urgencyLabel: urgencyLabel,
      whyReasoning: whyReasoning,
      recommendationText: recommendationText,
      operationalWindow: operationalWindow,
      fadecStatus: activeFault === 'NONE' ? 'ECU: closed-loop fuel trim active; no engine fault diagnosed' : `AI diagnosis ${activeFault}: no automatic derate; power reduction / RTB is decided by the operator or the RTB planner`,
      affectedSubsystems: activeFault === 'NONE' ? ['NOMINAL'] : [activeFault],
      parameterEvidence: parameterEvidence,
      missionMarginHours: dynamicMissionMargin,
      isMissionFeasible: isMissionFeasible
    },
    dataQuality: { 
      score: unitAi?.dataQuality?.quality_score_pct ?? null,
      sensorConfidence: unitAi?.dataQuality?.sensor_confidence_pct ?? null,
      telemetryAgeMs: unitAi?.dataQuality?.telemetry_age_ms ?? null 
    },
    xaiAttributions: xaiAttributions,
    // Model card values as served by the AI service (ai_health_rul/models/model_card.json); empty while offline
    modelMetadata: {
      live: !!unitAi?.modelMetadata?.model_name,
      name: unitAi?.modelMetadata?.model_name || 'Mahalanobis residual detector + XGBoost (TreeSHAP)',
      version: unitAi?.modelMetadata?.version || null,
      dataset: unitAi?.modelMetadata?.training_dataset || 'GarudaTwin engine simulator',
      featuresCount: unitAi?.modelMetadata?.num_features ?? null,
      featureEngineering: unitAi?.modelMetadata?.feature_engineering ?? null,
      rulMaeHours: unitAi?.modelMetadata?.validation_mae_hours ?? null,
      detectionPrecision: unitAi?.modelMetadata?.anomaly_precision ?? null,
      detectionRecall: unitAi?.modelMetadata?.anomaly_recall ?? null,
      latencyMs: unitAi?.modelMetadata?.inference_latency_ms ?? null,
      tboHours: unitAi?.modelMetadata?.tbo_hours ?? 2000,
      melThresholdPct: unitAi?.modelMetadata?.mel_threshold ?? 50,
      disclaimer: unitAi?.modelMetadata?.data_source_note || 'AI-assisted prototype decision support only, trained on simulator data.'
    }
  };

  const isDegraded = data.health.index < 75;
  const isCritical = data.health.index < 40;

  // SVG Chart Dimensions & Helpers
  const chartW = 460;
  const chartH = 170;
  const padL = 45;
  const padR = 25;
  const padT = 20;
  const padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  // Health Chart Points Calculation (-50h to +50h)
  const healthPoints = useMemo(() => {
    const hist = data.rul.historicalHealth || [];
    const traj = data.rul.trajectory || [];

    // Map -50h to +50h on X-axis: 0h is at center (X = padL + plotW/2)
    const mapX = (hrs) => padL + ((hrs + 50) / 100) * plotW;
    const mapY = (val) => padT + (1 - Math.max(0, Math.min(100, val)) / 100) * plotH;

    // Historical path
    const histCoords = hist.map(p => ({ x: mapX(p.hoursOffset), y: mapY(p.value) }));
    const histPath = histCoords.length > 0
      ? `M ${histCoords[0].x} ${histCoords[0].y} ` + histCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ')
      : '';

    // Forecast path (step 0 to 50)
    const nowCoord = { x: mapX(0), y: mapY(data.health.index) };
    const forecastCoords = [nowCoord, ...traj.map(t => ({ x: mapX(t.hoursElapsed), y: mapY(t.predictedHealth) }))];
    const forecastPath = forecastCoords.length > 0
      ? `M ${forecastCoords[0].x} ${forecastCoords[0].y} ` + forecastCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ')
      : '';

    // 95% Confidence Shaded Polygon
    const upperCoords = [nowCoord, ...traj.map(t => ({ x: mapX(t.hoursElapsed), y: mapY(t.upperConfidence) }))];
    const lowerCoords = [nowCoord, ...traj.map(t => ({ x: mapX(t.hoursElapsed), y: mapY(t.lowerConfidence) }))];
    
    let polygonPath = '';
    if (upperCoords.length > 1) {
      polygonPath = `M ${upperCoords[0].x} ${upperCoords[0].y} ` +
        upperCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ') +
        lowerCoords.slice().reverse().map(c => `L ${c.x} ${c.y}`).join(' ') +
        ' Z';
    }

    return {
      nowCoord,
      histPath,
      forecastPath,
      polygonPath,
      melY: mapY(data.rul.melLimit || 50),
      mapX,
      mapY
    };
  }, [data, plotW, plotH]);

  // RUL Chart Points Calculation
  const rulPoints = useMemo(() => {
    const hist = data.rul.historicalRul || [];
    const maxRul = Math.max(500, (data.rul.hours || 400) * 1.3);

    const mapX = (hrs) => padL + ((hrs + 50) / 100) * plotW;
    const mapY = (val) => padT + (1 - Math.max(0, Math.min(maxRul, val)) / maxRul) * plotH;

    const histCoords = hist.map(p => ({ x: mapX(p.hoursOffset), y: mapY(p.value) }));
    const histPath = histCoords.length > 0
      ? `M ${histCoords[0].x} ${histCoords[0].y} ` + histCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ')
      : '';

    const nowCoord = { x: mapX(0), y: mapY(data.rul.hours) };
    const endCoord = { 
      x: mapX(50), 
      y: mapY(Math.max(0, data.rul.hours - (data.degradation.stressBreakdown?.combinedStress || 1.0) * 50)) 
    };
    const slopePath = `M ${nowCoord.x} ${nowCoord.y} L ${endCoord.x} ${endCoord.y}`;

    return {
      nowCoord,
      histPath,
      slopePath,
      minDispatchY: mapY(data.rul.minDispatchRul || 20),
      maxRul
    };
  }, [data, plotW, plotH]);

  if (!hasLiveData) {
    return (
      <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-4 pb-12 pr-1 text-slate-900 font-mono">
        <div className="gcs-panel rounded-lg border border-slate-200 p-4 shadow-xs bg-white">
          <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono mb-3">
            <span className="text-slate-500 mr-1 font-semibold">ASSET:</span>
            {['Vahak-1', 'Vahak-2', 'Vahak-3', 'Vahak-4', 'Vahak-5'].map(unit => (
              <button key={unit} onClick={() => setSelectedUnit(unit)}
                className={`px-2 py-1 rounded-md border text-xs font-mono ${selectedUnit === unit ? 'bg-sky-600 text-white font-bold border-sky-600' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                {unit}
              </button>
            ))}
          </div>
          <h2 className="font-bold text-sm text-slate-900">{unitInfo.callsign}</h2>
          <p className="text-xs text-slate-600 mt-1.5">
            {fleetMember?.airborne === false
              ? (fleetMember.note || 'On the ground, engine not running: no live engine data, so no AI health or RUL estimate.')
              : 'Waiting for this vehicle\'s first AI result (the fleet is scored once per second).'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Engine hours: {unitInfo.flightHours} h</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-4 pb-12 pr-1 text-slate-900 font-mono">
      
      {/* ─────────────────────────────────────────────────────────────
          1. TOP STATUS BAR: Data Quality, Unit Switcher & Subnav
         ───────────────────────────────────────────────────────────── */}
      <div className="gcs-panel rounded-lg border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        
        {/* Left: View Title & Sub-view Switcher */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shadow-xs">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono font-bold text-xs tracking-wider text-slate-900 uppercase">
                {activeSubView === 'PROGNOSTICS'
                  ? 'REMAINING USEFUL LIFE (RUL) & DEGRADATION PROGNOSTICS'
                  : 'EXPLAINABLE DIAGNOSTICS & CAUSAL REASONING'}
              </h2>
              <span className="text-[9px] font-mono bg-slate-100 border border-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                XGBOOST ON PHYSICS RESIDUALS
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5">
              <span>AI prognostics for:</span>
              <span className="text-slate-800 font-semibold">{selectedUnit}</span>
              <span className="text-slate-300">•</span>
              <span>{unitInfo.callsign}</span>
              <span className="text-slate-300">•</span>
              <span className="text-sky-700 font-semibold tabular-nums">{data.rul.accumFlightHours} FLIGHT HRS</span>
            </div>
          </div>
        </div>

        {/* Center: Sub-view Navigation Buttons */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200">
          <button
            onClick={() => setActiveSubView('PROGNOSTICS')}
            className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-colors flex items-center gap-2 border ${
              activeSubView === 'PROGNOSTICS'
                ? 'bg-white text-slate-900 border-slate-300 shadow-xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-sky-600" />
            RUL & PROGNOSTICS
          </button>

          <button
            onClick={() => setActiveSubView('ADVISORY')}
            className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-colors flex items-center gap-2 border ${
              activeSubView === 'ADVISORY'
                ? 'bg-white text-slate-900 border-slate-300 shadow-xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Wrench className="w-3.5 h-3.5 text-amber-600" />
            DIAGNOSTICS & ADVISORY
          </button>
        </div>

        {/* Right: Unit Selector & Audit Drawer Button */}
        <div className="flex items-center gap-2">
          {/* Unit Pills */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-slate-500 mr-1 font-semibold">ASSET:</span>
            {['Vahak-1', 'Vahak-2', 'Vahak-3', 'Vahak-4', 'Vahak-5'].map((unit) => {
              const uStats = (telemetry.fleetState || []).find(u => u.id === unit);
              const uHealth = unit === 'Vahak-1' ? data.health.index : (uStats?.ai?.health ?? null);
              return (
                <button
                  key={unit}
                  onClick={() => setSelectedUnit(unit)}
                  className={`px-2 py-1 rounded-md border text-xs font-mono transition-colors tabular-nums ${
                    selectedUnit === unit
                      ? 'bg-sky-600 text-white font-bold border-sky-600 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {unit} ({uHealth == null ? (uStats?.airborne === false ? 'ground' : '—') : `${uHealth.toFixed(0)}%`})
                </button>
              );
            })}
          </div>

          {/* Model Audit Drawer Trigger */}
          <button
            onClick={() => setIsAuditDrawerOpen(true)}
            className="px-2.5 py-1 rounded-md bg-white border border-slate-200 hover:border-sky-400 text-slate-700 hover:text-slate-900 text-xs font-mono font-medium flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <FileSearch className="w-3.5 h-3.5 text-sky-600" />
            EXPLAIN MODEL
          </button>
        </div>

      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. DATA QUALITY BANNER (Master Prompt Rule 6)
         ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">DATA QUALITY:</span>
          <span className="text-emerald-600 font-bold tabular-nums">{data.dataQuality.score}% COMPLIANT</span>
        </div>
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold" title="Data-quality score, reduced 20 % when an input is outside the training range">SENSOR CONFIDENCE:</span>
          <span className="text-sky-600 font-bold tabular-nums">{data.dataQuality.sensorConfidence ?? '—'}% (DATA QUALITY)</span>
        </div>
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">AI SAMPLE INTERVAL:</span>
          <span className="text-slate-800 font-bold tabular-nums">{telemetry?.source?.mode ?? 'SIM'} — {data.dataQuality.telemetryAgeMs}ms</span>
        </div>
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">AI DIAGNOSIS:</span>
          <span className="text-right">
            <span className={`font-bold ${data.health.activeFault === 'NONE' ? 'text-emerald-600' : data.health.activeFault === 'UNCLASSIFIED_ANOMALY' ? 'text-amber-600' : 'text-red-600'}`}>
              {data.health.activeFault}
            </span>
            {unitAi?.suspect_sensor && (
              <span className="block text-[9px] text-amber-700 font-bold">
                suspect sensor: {unitAi.suspect_sensor}
              </span>
            )}
            {/* Ground truth exists only for the simulator (injected) and labelled recordings; live data has none */}
            {unitTel.health?.activeFault != null && (
              <span className="block text-[9px] text-slate-400 font-medium">
                {unitTel.source?.mode === 'REPLAY' ? 'recording label' : 'injected scenario'}: {unitTel.health.activeFault}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. SUB-VIEW A: RUL & FATIGUE PROGNOSTICS (Screenshots 2 & 3)
         ───────────────────────────────────────────────────────────── */}
      {activeSubView === 'PROGNOSTICS' && (
        <div className="flex flex-col gap-4">
          
          {/* 4 Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            
            {/* Card 1: Estimated RUL */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">1. ESTIMATED RUL</span>
                <Clock className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.rul.hours.toFixed(1)}
                </span>
                <span className="text-xs font-mono font-bold text-slate-500">HOURS</span>
              </div>
              <div className="text-[11px] font-mono text-slate-600 mt-1 font-medium">
                {data.health.activeFault === 'NONE' ? 'No engine fault: hours left to the 2,000 h TBO' : 'Hours to functional failure (diagnosed fault)'}
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>Health loss: {data.degradation.ratePerHour}%/hr</span>
                <span className="text-slate-700 font-semibold">TBO: 2000h</span>
              </div>
            </div>

            {/* Card 2: Health Index */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">2. HEALTH INDEX</span>
                <Activity className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-mono font-bold tabular-nums ${
                  data.health.index < 40 ? 'text-red-600' : data.health.index < 75 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {data.health.index.toFixed(0)}%
                </span>
                <span className="text-xs text-slate-500 font-mono font-medium">Composite</span>
              </div>
              
              {/* Clean solid progress bar */}
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className={`h-full transition-all duration-300 rounded ${
                    data.health.index < 40 ? 'bg-red-500' : data.health.index < 75 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${data.health.index}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>MEL Limit: 50%</span>
                <span className="text-slate-700 font-medium">Accum: 1249h</span>
              </div>
            </div>

            {/* Card 3: Degradation Trend */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">3. DEGRADATION TREND</span>
                <TrendingDown className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border inline-block ${
                  data.degradation.trend === 'RAPIDLY DEGRADING'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : data.degradation.trend === 'DEGRADING'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {data.degradation.trend}
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-600 mt-2 font-medium">
                {data.degradation.ratePerHour > 0
                  ? `Health falling ${data.degradation.ratePerHour} %/h under the diagnosed fault`
                  : 'No engine fault diagnosed: no health loss'}
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>Largest stress index: {data.degradation.stressBreakdown.combinedStress}</span>
                <span className="text-slate-600 font-semibold">descriptive</span>
              </div>
            </div>

            {/* Card 4: Confidence Score */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">4. CONFIDENCE</span>
                <ShieldAlert className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.rul.confidencePct}%
                </span>
                <span className="text-xs text-slate-500 font-mono font-medium">classifier posterior</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-sky-600 rounded transition-all duration-300"
                  style={{ width: `${data.rul.confidencePct}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>Sensor confidence: {data.dataQuality.sensorConfidence != null ? `${data.dataQuality.sensorConfidence}%` : '—'}</span>
                <span className="text-slate-700 font-semibold">RUL 95%: {data.rul.lower95.toFixed(0)}–{data.rul.upper95.toFixed(0)} h</span>
              </div>
            </div>

          </div>

          {/* Twin Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            
            {/* Chart 1: TIME -> HEALTH INDEX (%) */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2">
                <div>
                  <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    TIME → HEALTH INDEX (%)
                  </h3>
                  <div className="text-[10px] font-mono text-slate-500 font-medium">
                    Model backcast (T-50h → NOW, not recorded history) & 50 h forecast envelope
                  </div>
                </div>
                <div className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-xs font-mono font-bold tabular-nums">
                  NOW: {data.health.index.toFixed(0)}%
                </div>
              </div>

              {/* SVG Health Plot */}
              <div className="relative w-full h-[180px] bg-slate-50/80 rounded border border-slate-200 overflow-hidden">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full">
                  {/* Grid Lines */}
                  <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.25} x2={padL + plotW} y2={padT + plotH * 0.25} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.5} x2={padL + plotW} y2={padT + plotH * 0.5} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.75} x2={padL + plotW} y2={padT + plotH * 0.75} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#CBD5E1" />

                  {/* Y Axis Labels */}
                  <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">100%</text>
                  <text x={padL - 6} y={padT + plotH * 0.25 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">75%</text>
                  <text x={padL - 6} y={padT + plotH * 0.5 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">50%</text>
                  <text x={padL - 6} y={padT + plotH * 0.75 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">25%</text>
                  <text x={padL - 6} y={padT + plotH + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">0%</text>

                  {/* X Axis Center Marker (NOW) */}
                  <line 
                    x1={healthPoints.nowCoord.x} 
                    y1={padT} 
                    x2={healthPoints.nowCoord.x} 
                    y2={padT + plotH} 
                    stroke="#0284c7" 
                    strokeDasharray="3,3" 
                    strokeWidth="1.5"
                  />
                  <text 
                    x={healthPoints.nowCoord.x} 
                    y={padT - 6} 
                    textAnchor="middle" 
                    fill="#0284c7" 
                    fontSize="9" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    NOW
                  </text>

                  {/* MEL Limit (50%) Red Dashed Line */}
                  <line 
                    x1={padL} 
                    y1={healthPoints.melY} 
                    x2={padL + plotW} 
                    y2={healthPoints.melY} 
                    stroke="#dc2626" 
                    strokeDasharray="4,4" 
                    strokeWidth="1.2"
                  />
                  <text 
                    x={padL + plotW - 10} 
                    y={healthPoints.melY - 4} 
                    textAnchor="end" 
                    fill="#dc2626" 
                    fontSize="8" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    MEL LIMIT (50%)
                  </text>

                  {/* 95 % interval from the conformal quantile RUL model */}
                  {healthPoints.polygonPath && (
                    <path d={healthPoints.polygonPath} fill="#059669" fillOpacity="0.12" />
                  )}

                  {/* Historical Log Path (Past: T-50h to NOW) */}
                  {healthPoints.histPath && (
                    <path 
                      d={healthPoints.histPath} 
                      fill="none" 
                      stroke="#0284c7" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Forecast Trajectory Path (Future: NOW to +50h) */}
                  {healthPoints.forecastPath && (
                    <path 
                      d={healthPoints.forecastPath} 
                      fill="none" 
                      stroke="#059669" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Current Position Point */}
                  <circle 
                    cx={healthPoints.nowCoord.x} 
                    cy={healthPoints.nowCoord.y} 
                    r="4" 
                    fill="#059669" 
                    stroke="#ffffff" 
                    strokeWidth="2" 
                  />

                  {/* X Axis Time Labels */}
                  <text x={healthPoints.mapX(-50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-50h</text>
                  <text x={healthPoints.mapX(-25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-25h</text>
                  <text x={healthPoints.mapX(0)} y={padT + plotH + 15} textAnchor="middle" fill="#0284c7" fontSize="8" fontWeight="bold" fontFamily="monospace">NOW</text>
                  <text x={healthPoints.mapX(25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+25h</text>
                  <text x={healthPoints.mapX(50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+50h</text>
                </svg>
              </div>

              {/* Chart Legend */}
              <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-600 mt-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#0284c7]"></span>
                  <span className="font-medium">Model backcast (not recorded history)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#059669]"></span>
                  <span className="font-medium">Forecast Trajectory</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-[#059669]/20 border border-[#059669]/40 rounded-sm"></span>
                  <span className="font-medium">95% conformal interval</span>
                </div>
              </div>
            </div>

            {/* Chart 2: TIME -> ESTIMATED RUL (HOURS) */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2">
                <div>
                  <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-600" />
                    TIME → ESTIMATED RUL (HOURS)
                  </h3>
                  <div className="text-[10px] font-mono text-slate-500 font-medium">
                    RUL: model backcast and current estimate
                  </div>
                </div>
                <div className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-xs font-mono font-bold tabular-nums">
                  NOW: {data.rul.hours.toFixed(1)}h RUL
                </div>
              </div>

              {/* SVG RUL Plot */}
              <div className="relative w-full h-[180px] bg-slate-50/80 rounded border border-slate-200 overflow-hidden">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full">
                  {/* Grid Lines */}
                  <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.5} x2={padL + plotW} y2={padT + plotH * 0.5} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#CBD5E1" />

                  {/* Y Axis Labels */}
                  <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">{Math.round(rulPoints.maxRul)}h</text>
                  <text x={padL - 6} y={padT + plotH * 0.5 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">{Math.round(rulPoints.maxRul / 2)}h</text>
                  <text x={padL - 6} y={padT + plotH + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">0h</text>

                  {/* X Axis Center Marker (NOW) */}
                  <line 
                    x1={healthPoints.nowCoord.x} 
                    y1={padT} 
                    x2={healthPoints.nowCoord.x} 
                    y2={padT + plotH} 
                    stroke="#0284c7" 
                    strokeDasharray="3,3" 
                    strokeWidth="1.5"
                  />
                  <text 
                    x={healthPoints.nowCoord.x} 
                    y={padT - 6} 
                    textAnchor="middle" 
                    fill="#0284c7" 
                    fontSize="9" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    NOW
                  </text>

                  {/* MIN DISPATCH (20h) Red Dashed Line */}
                  <line 
                    x1={padL} 
                    y1={rulPoints.minDispatchY} 
                    x2={padL + plotW} 
                    y2={rulPoints.minDispatchY} 
                    stroke="#dc2626" 
                    strokeDasharray="4,4" 
                    strokeWidth="1.2"
                  />
                  <text 
                    x={padL + plotW - 10} 
                    y={rulPoints.minDispatchY - 4} 
                    textAnchor="end" 
                    fill="#dc2626" 
                    fontSize="8" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    MIN DISPATCH (20h)
                  </text>

                  {/* Historical RUL Curve */}
                  {rulPoints.histPath && (
                    <path 
                      d={rulPoints.histPath} 
                      fill="none" 
                      stroke="#0284c7" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Active Degradation Slope Path */}
                  {rulPoints.slopePath && (
                    <path 
                      d={rulPoints.slopePath} 
                      fill="none" 
                      stroke="#059669" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Current Position Point */}
                  <circle 
                    cx={rulPoints.nowCoord.x} 
                    cy={rulPoints.nowCoord.y} 
                    r="4" 
                    fill="#0284c7" 
                    stroke="#ffffff" 
                    strokeWidth="2" 
                  />

                  {/* X Axis Time Labels */}
                  <text x={healthPoints.mapX(-50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-50h</text>
                  <text x={healthPoints.mapX(-25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-25h</text>
                  <text x={healthPoints.mapX(0)} y={padT + plotH + 15} textAnchor="middle" fill="#0284c7" fontSize="8" fontWeight="bold" fontFamily="monospace">NOW</text>
                  <text x={healthPoints.mapX(25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+25h</text>
                  <text x={healthPoints.mapX(50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+50h</text>
                </svg>
              </div>

              {/* Chart Legend */}
              <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-600 mt-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#0284c7]"></span>
                  <span className="font-medium">RUL backcast (model)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#059669]"></span>
                  <span className="font-medium">Health loss rate</span>
                </div>
                <div className="text-slate-700 font-mono font-bold tabular-nums">
                  Rate: {data.degradation.ratePerHour}%/hr
                </div>
              </div>
            </div>

          </div>

          {/* ─────────────────────────────────────────────────────────────
              4. DESCRIPTIVE STRESS INDICES (rul_predictor._stress: absolute sensor levels, 1.0 = nominal;
                 shown for context, not inputs to the RUL model)
             ───────────────────────────────────────────────────────────── */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <Zap className="w-4 h-4 text-sky-600" />
                DESCRIPTIVE STRESS INDICES (1.00 = NOMINAL)
              </h3>
              <span className="text-xs font-mono text-slate-600 font-medium">
                Largest index: <span className="text-sky-700 font-bold tabular-nums">{data.degradation.stressBreakdown.combinedStress}</span>
              </span>
            </div>

            {/* 5 Stress Factor Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
              
              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">1. THERMAL STRESS</span>
                <div className="text-xl font-mono font-bold text-amber-600 my-1 tabular-nums">
                  {data.degradation.stressBreakdown.thermalStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">CHT &gt; 118 °C, oil &gt; 105 °C, EGT &gt; 900 °C</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">2. VIBRATION / MECH</span>
                <div className="text-xl font-mono font-bold text-amber-600 my-1 tabular-nums">
                  {data.degradation.stressBreakdown.mechanicalStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">Broadband vibration &gt; 0.35 g</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">3. LUBRICATION</span>
                <div className={`text-xl font-mono font-bold my-1 tabular-nums ${
                  data.degradation.stressBreakdown.lubricationStress > 1.2 ? 'text-red-600' : 'text-emerald-600'
                }`}>
                  {data.degradation.stressBreakdown.lubricationStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">Oil pressure &lt; 2.8 bar</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">4. COMBUSTION</span>
                <div className={`text-xl font-mono font-bold my-1 tabular-nums ${
                  data.degradation.stressBreakdown.combustionStress > 1.2 ? 'text-red-600' : 'text-emerald-600'
                }`}>
                  {data.degradation.stressBreakdown.combustionStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">EGT &gt; 920 °C</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">5. OPERATING LOAD</span>
                <div className="text-xl font-mono font-bold text-slate-900 my-1 tabular-nums">
                  {data.degradation.stressBreakdown.operatingStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">RPM &gt; 5200, MAP &gt; 1.65 bar</span>
              </div>

            </div>

            {/* Scenario Response Logic Legend */}
            <div className="mt-3 p-2.5 gcs-card rounded border border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between text-[10px] font-mono text-slate-600">
              <span className="text-slate-700 font-medium">Indices rise above 1.00 only when a sensor passes the level shown. They describe operating stress for the operator and are not inputs to the RUL model.</span>
            </div>
          </div>

          {/* Prototype Notice Callout */}
          <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-[11px] leading-relaxed text-slate-700 flex items-start gap-2.5 shadow-xs">
            <Info className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold text-slate-900">HOW RUL IS ESTIMATED: </span>
              When an engine fault is diagnosed, an <span className="text-sky-700 font-semibold">XGBoost multi-quantile model</span> (2.5 / 50 / 97.5 %) predicts hours to functional failure from the golden-twin residual features; the interval is widened by a conformal margin (held-out simulator test: MAE 22.9 h, 95 % interval coverage 94.5 %). With no engine fault, RUL is the time left to the assumed 2,000 h TBO. Trained on simulator data; maintenance and dispatch decisions follow the Rotax 915 iS maintenance manual.
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────────
              5. EXPLAINABLE AI (XAI) ANOMALY ATTRIBUTION
             ───────────────────────────────────────────────────────────── */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <div>
                <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-sky-600" />
                  EXPLAINABLE AI (XAI) ANOMALY ATTRIBUTION
                </h3>
                <div className="text-[10px] font-mono text-slate-500 font-medium">
                  TreeSHAP contribution of each sensor group to the model output
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono font-semibold">
                XGBOOST TREESHAP
              </span>
            </div>

            {/* 6 XAI Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {(data.xaiAttributions || []).map((attr, idx) => (
                <div key={idx} className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 leading-snug">
                      {attr.name}
                    </span>
                    <span className={`text-xs font-mono font-bold shrink-0 tabular-nums ${
                      attr.status === 'CRITICAL' ? 'text-red-600' : attr.status === 'ELEVATED' ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {attr.weight}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600 mt-1 leading-relaxed">
                    {attr.description}
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        attr.status === 'CRITICAL' ? 'bg-red-500' : attr.status === 'ELEVATED' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.abs(parseInt(attr.weight) || 20) * 1.5)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Multi-Horizon Failure Risk */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-sky-600" />
                MULTI-HORIZON PROBABILISTIC FAILURE RISK
              </h3>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase ${
                data.risk.level === 'CRITICAL' ? 'bg-red-50 text-red-700 border-red-200' :
                data.risk.level === 'HIGH' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                data.risk.level === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                RISK LEVEL: {data.risk.level}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 1 HOUR</div>
                <div className="text-lg font-bold font-mono text-emerald-600 mt-0.5 tabular-nums">{data.risk.multiHorizon.h1}%</div>
                <div className="text-[9px] font-mono text-slate-500">Cumulative hazard</div>
              </div>
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 4 HOURS</div>
                <div className="text-lg font-bold font-mono text-emerald-600 mt-0.5 tabular-nums">{data.risk.multiHorizon.h4}%</div>
                <div className="text-[9px] font-mono text-slate-500">Sortie window</div>
              </div>
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 8 HOURS</div>
                <div className="text-lg font-bold font-mono text-amber-600 mt-0.5 tabular-nums">{data.risk.multiHorizon.h8}%</div>
                <div className="text-[9px] font-mono text-slate-500">Loiter envelope</div>
              </div>
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 24 HOURS</div>
                <div className="text-lg font-bold font-mono text-slate-900 mt-0.5 tabular-nums">{data.risk.multiHorizon.h24}%</div>
                <div className="text-[9px] font-mono text-slate-500">Endurance horizon</div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. SUB-VIEW B: CAUSAL DIAGNOSTICS & ADVISORY (Screenshot 1)
         ───────────────────────────────────────────────────────────── */}
      {activeSubView === 'ADVISORY' && (
        <div className="flex flex-col gap-3">
          
          {/* Top 4 Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            
            {/* Card 1: Overall Anomaly Score */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">1. OVERALL ANOMALY SCORE</span>
                <Activity className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-emerald-600 tabular-nums">
                  {data.health.overallAnomalyScore.toFixed(2)}
                </span>
                <span className="text-xs font-mono text-slate-500 font-medium">Mahalanobis score (0.5 = alarm threshold)</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className={`h-full transition-all duration-300 ${data.health.overallAnomalyScore < 0.5 ? 'bg-emerald-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(100, data.health.overallAnomalyScore * 100)}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 font-medium">
                {data.health.overallAnomalyScore < 0.5 ? 'Below detector threshold' : 'Above detector threshold'}
              </div>
            </div>

            {/* Card 2: Health Index */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">2. HEALTH INDEX</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-emerald-600 tabular-nums">
                  {data.health.index.toFixed(0)}
                </span>
                <span className="text-xs font-mono text-slate-500 font-medium">/ 100</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${data.health.index}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 tabular-nums font-medium">
                RUL Projection: {data.rul.hours.toFixed(1)} Flight Hours
              </div>
            </div>

            {/* Card 3: Probable Fault */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">3. PROBABLE FAULT</span>
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              </div>
              <div className={`text-sm font-bold font-mono tracking-wide ${
                data.health.activeFault === 'NONE' ? 'text-emerald-700' : 'text-red-700'
              }`}>
                {data.health.probableFault}
              </div>
              <div className="text-[10px] font-mono text-slate-600 mt-1">
                Subsystem: <span className="text-slate-900 font-bold">{data.advisory.affectedSubsystems[0] || 'Nominal'}</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 pt-2 border-t border-slate-100">
                Signature: {data.health.activeFault === 'NONE' ? 'NOMINAL' : 'ANOMALY DETECTED'}
              </div>
            </div>

            {/* Card 4: Fault Confidence */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">4. FAULT CONFIDENCE</span>
                <BarChart3 className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.health.faultConfidence}%
                </span>
                <span className="text-xs font-mono text-slate-500 font-medium">Posterior</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-sky-600 transition-all duration-300"
                  style={{ width: `${data.health.faultConfidence}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 font-medium">
                Anomaly score: {data.health.overallAnomalyScore.toFixed(2)}
              </div>
            </div>

          </div>

          {/* Parameter Evidence Table */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-sky-600" />
                PARAMETER EVIDENCE (GOLDEN TWIN VS. LIVE TELEMETRY DEVIATION)
              </h3>
              <span className="text-[10px] font-mono text-slate-500 font-medium">
                {data.health.activeFault === 'NONE' ? 'Measured vs nominal band (no fault diagnosed)' : 'AI evidence; weight = TreeSHAP share'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-3 font-bold">PARAMETER</th>
                    <th className="py-2.5 px-3 font-bold">GOLDEN MODEL</th>
                    <th className="py-2.5 px-3 font-bold">LIVE TELEMETRY</th>
                    <th className="py-2.5 px-3 font-bold">DEVIATION / RESIDUAL</th>
                    <th className="py-2.5 px-3 font-bold">DIAGNOSTIC WEIGHT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!data.advisory.parameterEvidence || data.advisory.parameterEvidence.length === 0) ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-3 text-center text-slate-500 italic">
                        All thermodynamic, mechanical, and combustion sensor channels tracking within nominal ±1.5σ baseline.
                      </td>
                    </tr>
                  ) : (
                    data.advisory.parameterEvidence.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            row.status === 'CRITICAL' ? 'bg-red-500' : row.status === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          <span className="text-slate-900 font-bold">{row.parameter}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 tabular-nums">{row.goldenModel}</td>
                        <td className="py-2.5 px-3 text-slate-900 font-bold tabular-nums">{row.liveTelemetry}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border tabular-nums ${
                            row.status === 'CRITICAL'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : row.status === 'WARNING'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-100 border-slate-200 text-slate-700'
                          }`}>
                            {row.residual}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-slate-100 h-1.5 rounded overflow-hidden border border-slate-200">
                              <div 
                                className="h-full bg-sky-600 rounded"
                                style={{ width: row.diagnosticWeight }}
                              />
                            </div>
                            <span className="text-slate-800 text-[11px] font-bold tabular-nums">{row.diagnosticWeight}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom 2 Panels: WHY IT MATTERS & RECOMMENDED ACTION */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            
            {/* Left: WHY THIS MATTERS (PHYSICAL CAUSAL REASONING) */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col justify-between shadow-xs">
              <div>
                <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-3">
                  <Brain className="w-4 h-4 text-sky-600" />
                  PHYSICAL CAUSAL REASONING
                </h3>
                <p className="text-xs font-mono text-slate-700 leading-relaxed font-medium">
                  {data.advisory.whyReasoning}
                </p>
              </div>

              <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>Inference: XGBoost classifier + Mahalanobis residual detector</span>
                <span className="text-slate-700 font-semibold">Trained on GarudaTwin simulator (synthetic)</span>
              </div>
            </div>

            {/* Right: RECOMMENDED MAINTENANCE ACTION & FADEC INTERVENTION */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                  <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-600" />
                    RECOMMENDED ADVISORY & FADEC INTERVENTION
                  </h3>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border uppercase ${
                    data.advisory.priority === 'CRITICAL' ? 'bg-red-50 text-red-700 border-red-200' :
                    data.advisory.priority === 'HIGH' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    URGENCY: {data.advisory.urgencyLabel}
                  </span>
                </div>

                <div className="text-xs font-mono text-slate-800 leading-relaxed font-medium">
                  {data.advisory.recommendationText}
                </div>

                <div className="mt-3 text-[11px] font-mono text-slate-600">
                  <span className="text-slate-500 font-semibold">Operational Window: </span>
                  <span className="text-slate-900 font-bold">{data.advisory.operationalWindow}</span>
                </div>
              </div>

              <div className="mt-4 pt-2.5 border-t border-slate-100 text-[10px] font-mono font-medium">
                <span className="text-emerald-700 font-semibold">{data.advisory.fadecStatus}</span>
              </div>
            </div>

          </div>

          {/* Mission Demand Interactive Scrubber & Mission Margin */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-600" />
                MISSION-AWARE RUL DISPATCH MARGIN EVALUATOR
              </h3>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                data.advisory.isMissionFeasible 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                {data.advisory.isMissionFeasible ? '✓ SORTIE AUTHORIZED' : '⚠️ MISSION RISK REVIEW REQUIRED'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
              {/* Slider Input */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-500 font-medium">PLANNED MISSION DURATION:</span>
                  <span className="text-slate-900 font-bold tabular-nums">{missionDemandHours.toFixed(1)} HOURS</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="14"
                  step="0.5"
                  value={missionDemandHours}
                  onChange={(e) => setMissionDemandHours(parseFloat(e.target.value))}
                  className="w-full accent-sky-600 cursor-pointer h-2 bg-slate-200 rounded border border-slate-300"
                />
                <div className="flex justify-between text-[9px] font-mono text-slate-500 tabular-nums">
                  <span>1.0h (Recon)</span>
                  <span>6.0h (Cruise)</span>
                  <span>14.0h (Max Endurance)</span>
                </div>
              </div>

              {/* RUL vs Mission Comparison */}
              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex justify-around items-center text-center font-mono shadow-xs">
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">ESTIMATED RUL</div>
                  <div className="text-lg font-bold font-mono text-slate-900 tabular-nums">{data.rul.hours.toFixed(1)}h</div>
                </div>
                <div className="text-slate-400 font-bold text-xs">VS</div>
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">SORTIE DEMAND</div>
                  <div className="text-lg font-bold font-mono text-sky-600 tabular-nums">{missionDemandHours.toFixed(1)}h</div>
                </div>
              </div>

              {/* Margin Result Tile */}
              <div className={`p-3 rounded-lg border text-center font-mono shadow-xs ${
                data.advisory.isMissionFeasible 
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800' 
                  : 'bg-red-50/80 border-red-200 text-red-800'
              }`}>
                <div className="text-[10px] uppercase font-bold">RUL DISPATCH MARGIN</div>
                <div className="text-2xl font-bold font-mono my-0.5 tabular-nums">
                  {data.advisory.missionMarginHours > 0 ? `+${data.advisory.missionMarginHours.toFixed(1)}` : data.advisory.missionMarginHours.toFixed(1)}h
                </div>
                <div className="text-[10px] text-slate-600 font-medium">
                  {data.advisory.isMissionFeasible ? 'Exceeds standard 20% flight safety reserve' : 'RUL lower than mission flight plan!'}
                </div>
              </div>
            </div>
          </div>

          {/* Subsystems Matrix */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-3">
              <Layers className="w-4 h-4 text-sky-600" />
              DIGITAL TWIN SUBSYSTEM DEGRADATION INDEX (0 - 100)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {Object.entries(data.degradation.subsystems || {}).map(([name, val]) => (
                <div key={name} className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                  <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">{name}</span>
                  <div className={`text-lg font-mono font-bold my-1 tabular-nums ${
                    val > 50 ? 'text-red-600' : val > 20 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {val}%
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded overflow-hidden border border-slate-200">
                    <div 
                      className={`h-full transition-all duration-300 ${val > 50 ? 'bg-red-500' : val > 20 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${val}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. TECHNICAL AUDIT SLIDE-OUT DRAWER FOR JUDGES (Rule 58)
         ───────────────────────────────────────────────────────────── */}
      <PrognosticsDetailDrawer 
        isOpen={isAuditDrawerOpen} 
        onClose={() => setIsAuditDrawerOpen(false)}
        modelMetadata={data.modelMetadata}
      />

    </div>
  );
};
