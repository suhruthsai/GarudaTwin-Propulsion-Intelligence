import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { PrognosticsPipeline } from '../prognostics/prognostics_pipeline';
import { globalReplayEngine } from '../replay/ReplayEngine';
import { flightRecorder } from '../replay/FlightDataRecorder';
import { GATEWAY_URL, gatewayFetch } from '../api/gateway';

/**
 * Box-Muller transform for explicit Gaussian measurement noise (Physics-Grounded)
 */
function generateGaussianNoise(mean = 0, stdDev = 1) {
  let u1 = 1 - Math.random();
  let u2 = 1 - Math.random();
  let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

const TelemetryContext = createContext(null);


/** Map one AI-service result into the UI's prognostics shape (used for Vahak-1 and every fleet vehicle). */
export function mapAiResult(mlData, prev = {}) {
  // Map Python evidence items to UI format
  let mappedEvidence = [];
  if (Array.isArray(mlData.maintenance?.evidence)) {
    mappedEvidence = mlData.maintenance.evidence.map(ev => ({
      parameter: ev.feature || ev.parameter || 'Sensor Channel',
      goldenModel: ev.nominal_value != null ? `${ev.nominal_value} ${ev.unit || ''}` : 'Nominal',
      liveTelemetry: ev.observed_value != null ? `${ev.observed_value} ${ev.unit || ''}` : 'In Spec',
      residual: ev.residual != null ? `${ev.residual > 0 ? '+' : ''}${ev.residual} ${ev.unit || ''}` : '0.0',
      diagnosticWeight: ev.contribution_pct != null ? `${ev.contribution_pct}%` : '—',
      status: ev.contribution_pct > 35 ? 'CRITICAL' : ev.contribution_pct > 15 ? 'WARNING' : 'NOMINAL'
    }));
  }

  const rawFault = mlData.health?.diagnosed_fault;
  const normFault = (!rawFault || ['none', 'NONE', 'NOMINAL', 'NOMINAL_OPERATION', 'NOMINAL BASELINE'].includes(rawFault))
    ? 'NONE'
    : rawFault;

  return {
    ...prev,
    aiOnline: true,
    rul_hours_mean: mlData.rul.rulHours,
    rul_hours_lower_95: mlData.rul.rulHoursLower95,
    rul_hours_upper_95: mlData.rul.rulHoursUpper95,
    engine_health_index: mlData.rul.healthIndexScore,
    degradation_rate_pct_per_hour: mlData.rul.degradationRatePercentPerHour,
    subsystem_degradation: mlData.rul.subsystemDegradation || prev.subsystem_degradation,
    anomaly_score: mlData.health.anomaly_score,
    is_anomaly: mlData.health.is_anomaly,
    diagnosed_fault: normFault,
    severity_level: mlData.health.severity_level,
    diagnosis_confidence_pct: mlData.health.confidence_pct,
    suspect_sensor: mlData.health.suspect_sensor || null,
    failed_sensors: mlData.data_quality?.failed_sensors || [],
    class_probabilities: mlData.health.class_probabilities,
    dominant_root_cause_feature: mlData.feature_attributions?.[0]?.feature || 'None',
    modelMetadata: mlData.model_metadata || prev.modelMetadata,
    model_features: mlData.model_features || prev.model_features,
    trajectory: (mlData.rul.trajectory && mlData.rul.trajectory.length > 0) ? mlData.rul.trajectory : prev.trajectory,
    historicalHealthPoints: (mlData.rul.historicalHealthPoints && mlData.rul.historicalHealthPoints.length > 0) ? mlData.rul.historicalHealthPoints : prev.historicalHealthPoints,
    historicalRulPoints: (mlData.rul.historicalRulPoints && mlData.rul.historicalRulPoints.length > 0) ? mlData.rul.historicalRulPoints : prev.historicalRulPoints,
    stressBreakdown: mlData.rul.stressBreakdown || prev.stressBreakdown,
    dataQuality: mlData.data_quality || prev.dataQuality,
    degradationTrend: mlData.rul.degradationTrend || prev.degradationTrend,
    confidencePct: mlData.rul.confidencePct || prev.confidencePct,
    failureRiskScore: mlData.rul.failureRiskScore,
    failureRiskLevel: mlData.rul.failureRiskLevel,
    multiHorizonRisk: mlData.rul.multiHorizonRisk,
    pilot_advisory: mlData.advisory,
    maintenance: {
      ...(mlData.maintenance || {}),
      evidence: mappedEvidence
    },
    feature_attributions: Array.isArray(mlData.feature_attributions) ? mlData.feature_attributions.reduce((acc, curr) => {
      acc[curr.feature] = curr.importance_pct;
      return acc;
    }, {}) : prev.feature_attributions
  };
}

export const TelemetryProvider = ({ children }) => {
  const [commandError, setCommandError] = useState(null);
  const clearCommandError = useCallback(() => setCommandError(null), []);
  const [isConnected, setIsConnected] = useState(false);
  const [socketError, setSocketError] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [missionDemandHours, setMissionDemandHours] = useState(6.0);
  const missionDemandHoursRef = useRef(6.0);
  useEffect(() => { missionDemandHoursRef.current = missionDemandHours; }, [missionDemandHours]);

  // Mission Replay & Black-Box State
  const [isReplayMode, setIsReplayMode] = useState(false);
  // Full AI results of the escort fleet (Vahak-2..4), mapped like Vahak-1's
  const [fleetAi, setFleetAi] = useState({});
  const [replaySortie, setReplaySortie] = useState(null);
  const [replayPlaybackState, setReplayPlaybackState] = useState({
    isPlaying: false,
    rate: 1.0,
    currentTimeMs: 0,
    progressRatio: 0,
    currentIndex: 0,
    totalFrames: 0
  });
  const isReplayModeRef = useRef(false);
  useEffect(() => {
    isReplayModeRef.current = isReplayMode;
  }, [isReplayMode]);

  // Subscribe to ReplayEngine for Virtual Telemetry Stream
  useEffect(() => {
    const unsub = globalReplayEngine.subscribe((event) => {
      if (event.type === 'FRAME_UPDATE') {
        if (isReplayModeRef.current && event.frame) {
          setTelemetry(event.frame);
          if (event.frame.ai) {
            setAiPrognostics(prev => ({
              ...prev,
              rul_hours_mean: event.frame.ai.rul ?? prev.rul_hours_mean,
              reconstruction_mse: event.frame.ai.mse ?? prev.reconstruction_mse,
              anomaly_score: event.frame.ai.anomalyScore ?? prev.anomaly_score,
              engine_health_index: event.frame.health?.index ?? prev.engine_health_index,
              // The recorded injected label is ground truth, never shown as the AI diagnosis
              severity_level: event.frame.health?.status ?? prev.severity_level
            }));
          }
        }
        setReplayPlaybackState(prev => ({
          ...prev,
          currentTimeMs: event.currentTimeMs,
          progressRatio: event.progressRatio,
          currentIndex: event.currentIndex,
          totalFrames: event.totalFrames
        }));
      } else if (event.type === 'PLAY_STATE_CHANGED') {
        setReplayPlaybackState(prev => ({ ...prev, isPlaying: event.isPlaying }));
      } else if (event.type === 'RATE_CHANGED') {
        setReplayPlaybackState(prev => ({ ...prev, rate: event.rate }));
      } else if (event.type === 'SORTIE_LOADED') {
        setReplaySortie(event.sortie);
        if (event.sortie?.frames?.length > 0) {
          setReplayPlaybackState(prev => ({
            ...prev,
            totalFrames: event.sortie.frames.length,
            currentTimeMs: event.sortie.frames[0].timestamp,
            progressRatio: 0,
            isPlaying: false
          }));
        }
      }
    });
    return () => unsub();
  }, []);

  // Global Engine Telemetry State
  const [telemetry, setTelemetry] = useState({
    timestamp: Date.now(),
    mission: {
      missionTime: 3640,
      altitudeFt: 14500,
      airspeedKts: 110,
      ambientTempC: -12.5,
      baroPressureBar: 0.58,
      uavId: 'Vahak-1',
      missionPhase: 'LOITER'
    },
    engine: {
      rpm: 4800,
      throttlePct: 78.5,
      egt: [842.0, 839.5, 844.0, 841.2],
      cht: [106.2, 107.5, 105.8, 108.1],
      mapBar: 1.42,
      oilPressBar: 3.85,
      oilTempC: 98.4,
      vibrationGrms: 0.28,
      fuelFlowLph: 26.4,
      fuelPressureBar: 3.12,
      lambda: 0.94,
      wastegateDutyPct: 62.0,
      genVoltageV: 28.4,
      genCurrentA: 45.2,
      coolantTempC: 88.5
    },
    fleetState: [],   // filled by the gateway: every vehicle's live engine, twin and AI summary
    residuals: {
      egtResiduals: [2.0, -0.5, 4.0, 1.2],
      chtResiduals: [0.2, 1.5, -0.2, 2.1],
      mapResidual: 0.0,
      oilPressResidual: -0.05,
      oilTempResidual: 0.4,
      vibrationResidual: 0.0,
      genVoltageResidual: 0.0,
      coolantTempResidual: 0.0,
      maxResidualAbs: 4.0
    },
    health: {
      index: 98.5,
      status: 'NOMINAL',
      alertMessage: 'All Rotax 915 iS engine subsystems operating within flight envelope.',
      activeFault: 'NONE',
      severity: 0.0
    },
    canBusFrames: [
      { canId: '0x100', dlc: 8, rawHex: '12C01EA80A5003AC', timestamp: Date.now() },
      { canId: '0x200', dlc: 8, rawHex: '20E420CB20F820DC', timestamp: Date.now() },
      { canId: '0x210', dlc: 8, rawHex: '0426043304220439', timestamp: Date.now() },
      { canId: '0x300', dlc: 8, rawHex: '058C0F0A3A000118', timestamp: Date.now() }
    ]
  });

  // ── FCS / Flight Controller State (updated at 20 Hz from server) ──
  const [fcsState, setFcsState] = useState({
    // Attitude
    roll_deg:    0,
    pitch_deg:   2.87,
    heading_deg: 0,
    // Kinematics
    ias_kts:     110,
    tas_kts:     110,
    alt_ft:      14500,
    vsi_fpm:     0,
    mach:        0.167,
    alpha_deg:   2.87,
    beta_deg:    0,
    Nz:          1.0,
    north_m:     0,
    east_m:      0,
    // Body rates
    p_dps: 0, q_dps: 0, r_dps: 0,
    // Aerodynamic
    CL: 0.28, CD: 0.02, LD: 14.0,
    // Control surfaces
    elevator_deg: -2.58,
    aileron_deg:  0,
    rudder_deg:   0,
    flap_deg:     0,
    throttle_pct: 38,
    speed_brake:  false,
    thrust_N:     684,
    // Autopilot
    ap_mode:  'ALT_HOLD',
    ap_armed: true,
    // FADEC interlock
    engine_derate:  'NOMINAL',
    stall_warn:     false,
    overspeed_warn: false,
    engine_out:     false,
    g_limit_active: false,
    fuel_bingo:     false,
    // Glide
    glide_range_m: 0,
    fcs_time_s: 0,
  });

  // Initial Local Physics-Grounded Prognostics Baseline
  const initialPrognostics = useMemo(() => {
    try {
      const initResult = PrognosticsPipeline.evaluate({
        telemetry: {
          engine: {
            rpm: 4800,
            throttlePct: 78.5,
            egt: [842.0, 839.5, 844.0, 841.2],
            cht: [106.2, 107.5, 105.8, 108.1],
            mapBar: 1.42,
            oilPressBar: 3.85,
            oilTempC: 98.4,
            vibrationGrms: 0.28,
            fuelFlowLph: 26.4,
            fuelPressureBar: 3.12,
            lambda: 0.94,
            wastegateDutyPct: 62.0,
            genVoltageV: 28.4,
            genCurrentA: 45.2,
            coolantTempC: 88.5
          },
          mission: { altitudeFt: 14500, throttlePct: 78.5 },
          health: { activeFault: 'NONE', status: 'NOMINAL', index: 98.5 }
        },
        missionDemandHours: 6.0,
        unitId: 'Vahak-1'
      });
      if (initResult) {
        return {
          rul_hours_mean: initResult.rul.hours,
          rul_hours_lower_95: initResult.rul.lower95,
          rul_hours_upper_95: initResult.rul.upper95,
          engine_health_index: initResult.health.index,
          degradation_rate_pct_per_hour: initResult.degradation.ratePerHour,
          remaining_mission_reachability_pct: 100.0,
          estimated_time_to_critical_minutes: 20208.0,
          reconstruction_mse: 0.0012,
          anomaly_score: initResult.health.overallAnomalyScore,
          is_anomaly: false,
          diagnosed_fault: 'NONE',
          severity_level: 'NOMINAL',
          dominant_root_cause_feature: 'None',
          feature_attributions: {
            EGT_Cyl1: 8.2,
            EGT_Cyl2: 7.9,
            EGT_Cyl3: 9.1,
            EGT_Cyl4: 8.5,
            CHT_Cyl1: 6.4,
            CHT_Cyl2: 6.8,
            CHT_Cyl3: 6.1,
            CHT_Cyl4: 6.9,
            MAP: 12.4,
            Oil_Pressure: 14.2,
            RPM: 11.5,
            Vibration_gRMS: 12.0
          },
          subsystem_degradation: initResult.degradation.subsystems,
          trajectory: initResult.rul.trajectory,
          historicalHealthPoints: initResult.rul.historicalHealth,
          historicalRulPoints: initResult.rul.historicalRul,
          stressBreakdown: initResult.degradation.stressBreakdown,
          dataQuality: { quality_score_pct: 100, sensor_confidence: 99.5, telemetry_age_ms: 15 },
          degradationTrend: initResult.degradation.trend,
          confidencePct: initResult.rul.confidencePct,
          failureRiskScore: initResult.risk.score,
          failureRiskLevel: initResult.risk.level,
          multiHorizonRisk: initResult.risk.multiHorizon,
          pilot_advisory: initResult.advisory,
          maintenance: initResult.advisory,
          modelMetadata: initResult.modelMetadata
        };
      }
    } catch (e) {
      console.warn('Initial pipeline evaluation failed, using fallback static object', e);
    }
    return {
      rul_hours_mean: 842.0,
      rul_hours_lower_95: 818.5,
      rul_hours_upper_95: 865.5,
      engine_health_index: 98.5,
      degradation_rate_pct_per_hour: 0.12,
      remaining_mission_reachability_pct: 100.0,
      estimated_time_to_critical_minutes: 20208.0,
      reconstruction_mse: 0.0012,
      anomaly_score: 0.014,
      is_anomaly: false,
      diagnosed_fault: 'NONE',
      severity_level: 'NOMINAL',
      dominant_root_cause_feature: 'None',
      feature_attributions: {
        EGT_Cyl1: 8.2, EGT_Cyl2: 7.9, EGT_Cyl3: 9.1, EGT_Cyl4: 8.5,
        CHT_Cyl1: 6.4, CHT_Cyl2: 6.8, CHT_Cyl3: 6.1, CHT_Cyl4: 6.9,
        MAP: 12.4, Oil_Pressure: 14.2, RPM: 11.5, Vibration_gRMS: 12.0
      },
      subsystem_degradation: { thermal: 2.0, mechanical: 2.0, lubrication: 2.0, combustion: 2.0, fuel: 2.0, electrical: 2.0 },
      trajectory: [],
      historicalHealthPoints: [],
      historicalRulPoints: [],
      stressBreakdown: { thermalStress: 1.0, mechanicalStress: 1.0, lubricationStress: 1.0, combustionStress: 1.0, operatingStress: 1.0, combinedStress: 1.0 },
      dataQuality: { quality_score_pct: 100, sensor_confidence: 99.5, telemetry_age_ms: 15 },
      degradationTrend: 'NOMINAL',
      confidencePct: 90.0,
      failureRiskScore: 0.03,
      failureRiskLevel: 'LOW',
      multiHorizonRisk: { '1hr': 0.5, '4hr': 1.6, '8hr': 4.2, '24hr': 9.8 }
    };
  }, []);

  // AI Microservice Prognostics & Anomaly Prediction State
  const [aiPrognostics, setAiPrognostics] = useState(initialPrognostics);
  // Socket handler is registered once; read latest prognostics through a ref to avoid a stale closure
  const aiPrognosticsRef = useRef(initialPrognostics);
  useEffect(() => { aiPrognosticsRef.current = aiPrognostics; }, [aiPrognostics]);

  // Rolling Time-Series Telemetry Buffers (Length 60 for 60-point live charts)
  const [historyBuffer, setHistoryBuffer] = useState({
    timestamps: Array.from({ length: 40 }, (_, i) => new Date(Date.now() - (40 - i) * 1000).toLocaleTimeString()),
    egt1: Array(40).fill(842),
    egt2: Array(40).fill(840),
    egt3: Array(40).fill(844),
    egt4: Array(40).fill(841),
    cht1: Array(40).fill(106),
    cht2: Array(40).fill(107),
    cht3: Array(40).fill(106),
    cht4: Array(40).fill(108),
    map: Array(40).fill(1.42),
    oilPress: Array(40).fill(3.85),
    oilTemp: Array(40).fill(98.4),
    vibration: Array(40).fill(0.28),
    healthIndex: Array(40).fill(98.5),
    anomalyScore: Array(40).fill(0.01)
  });

  const socketRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastAlertStatusRef = useRef('NOMINAL');
  const lastMlFetchRef = useRef(0);
  const lastAiAtRef = useRef(Date.now());
  const lastHistoryUpdateRef = useRef(0);

  // Synthesize Web Audio Tactical Alert Sound
  const playAlertTone = useCallback((status) => {
    if (!audioEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (status === 'CRITICAL') {
        // High urgency alternating two-tone alarm
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(587, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (status === 'DEGRADED') {
        // Warning chime
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch (e) {
      console.warn('Audio tone could not be played:', e);
    }
  }, [audioEnabled]);



  // Map an AI result broadcast by the gateway (server-side 1 Hz inference) into UI state
  const applyMlData = useCallback((mlData) => {
    if (mlData && mlData.rul) setAiPrognostics(prev => mapAiResult(mlData, prev));
  }, []);

  // Local first-principles fallback used only while the gateway AI stream is unavailable
  const applyLocalFallback = useCallback((data) => {
    // Physics-only estimate while the AI service is offline. The injected simulator fault is
    // hidden from it, so it cannot present the scenario label as a diagnosis.
    try {
      const localResult = PrognosticsPipeline.evaluate({
        telemetry: { ...data, health: { ...data.health, activeFault: 'NONE' } },
        missionDemandHours: missionDemandHoursRef.current,
        unitId: 'Vahak-1'
      });
      if (localResult) {
        setAiPrognostics(prev => ({
          ...prev,
          rul_hours_mean: localResult.rul.hours,
          rul_hours_lower_95: localResult.rul.lower95,
          rul_hours_upper_95: localResult.rul.upper95,
          engine_health_index: localResult.health.index,
          degradation_rate_pct_per_hour: localResult.degradation.ratePerHour,
          subsystem_degradation: localResult.degradation.subsystems,
          anomaly_score: localResult.health.overallAnomalyScore,
          is_anomaly: localResult.health.status !== 'NOMINAL',
          diagnosed_fault: 'AI_OFFLINE',
          severity_level: data.health?.status || 'NOMINAL',
          aiOnline: false,
          dominant_root_cause_feature: localResult.xaiAttributions?.[0]?.name || 'None',
          feature_attributions: localResult.xaiAttributions.reduce((acc, curr) => {
            acc[curr.name] = parseFloat(curr.weight) || 10;
            return acc;
          }, {}),
          trajectory: localResult.rul.trajectory,
          historicalHealthPoints: localResult.rul.historicalHealth,
          historicalRulPoints: localResult.rul.historicalRul,
          stressBreakdown: localResult.degradation.stressBreakdown,
          dataQuality: {
            quality_score_pct: localResult.dataQuality.score,
            sensor_confidence: localResult.dataQuality.sensorConfidence,
            telemetry_age_ms: localResult.dataQuality.telemetryAgeMs
          },
          degradationTrend: localResult.degradation.trend,
          confidencePct: localResult.rul.confidencePct,
          failureRiskScore: localResult.risk.score,
          failureRiskLevel: localResult.risk.level,
          multiHorizonRisk: localResult.risk.multiHorizon,
          pilot_advisory: localResult.advisory,
          maintenance: localResult.advisory,
          modelMetadata: localResult.modelMetadata
        }));
      }
    } catch (err) {
      console.warn('Local prognostics fallback evaluation error:', err);
    }
  }, []);

  // Connect to the gateway: telemetry + server-side AI stream
  useEffect(() => {
    const socket = io(GATEWAY_URL || undefined, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      timeout: 5000
    });

    socketRef.current = socket;

    socket.on('ai_prognostics', (mlData) => {
      if (isReplayModeRef.current) return;
      lastAiAtRef.current = Date.now();
      applyMlData(mlData);
    });
    socket.on('command_rejected', ({ event, error }) => setCommandError(`${event}: ${error}`));
    socket.on('fleet_ai', (results) => {
      setFleetAi(prev => {
        const next = { ...prev };
        for (const [id, ml] of Object.entries(results || {})) if (ml?.rul) next[id] = mapAiResult(ml, prev[id] || {});
        return next;
      });
    });

    socket.on('connect', () => {
      console.log(' Tactical Web Client Connected to CAN Bus Socket');
      setIsConnected(true);
      setSocketError(null);
    });

    socket.on('telemetry_frame', (data) => {
      // Feed live frames to Black-Box Flight Data Recorder if recording
      if (flightRecorder.isRecording) {
        flightRecorder.recordFrame(data, aiPrognosticsRef.current);
      }

      // If Mission Replay is active, do not allow live frames to overwrite replay playhead
      if (isReplayModeRef.current) {
        return;
      }

      setTelemetry(data);

      // Extract FCS data from telemetry frame if present
      if (data.fcs) {
        setFcsState(data.fcs);
      }

      // Trigger Audio Alarm on Status Transition
      if (data.health.status !== lastAlertStatusRef.current) {
        playAlertTone(data.health.status);
        lastAlertStatusRef.current = data.health.status;
      }

      const now = Date.now();

      // Gateway AI stream silent for >3 s: evaluate the local physics fallback at 1 Hz.
      // Simulator only: a paused replay or a silent live feed has no new samples to score,
      // which is not an AI outage (the last AI result stays on screen).
      if ((data.source?.mode ?? 'SIM') === 'SIM' && now - lastAiAtRef.current > 3000 && now - lastMlFetchRef.current >= 1000) {
        lastMlFetchRef.current = now;
        applyLocalFallback(data);
      }

      // Append to Rolling History Buffer (strictly downsampled to 1 Hz to preserve memory)
      if (now - lastHistoryUpdateRef.current >= 1000) {
        lastHistoryUpdateRef.current = now;
        const calcAnomaly = data.health?.severity > 0 
          ? (data.health.severity * 0.85) 
          : (data.health?.index < 80 ? (100 - data.health.index) / 100 : 0.01);

        setHistoryBuffer(prev => {
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return {
            timestamps: [...prev.timestamps.slice(1), timeStr],
            egt1: [...prev.egt1.slice(1), data.engine.egt[0]],
            egt2: [...prev.egt2.slice(1), data.engine.egt[1]],
            egt3: [...prev.egt3.slice(1), data.engine.egt[2]],
            egt4: [...prev.egt4.slice(1), data.engine.egt[3]],
            cht1: [...prev.cht1.slice(1), data.engine.cht[0]],
            cht2: [...prev.cht2.slice(1), data.engine.cht[1]],
            cht3: [...prev.cht3.slice(1), data.engine.cht[2]],
            cht4: [...prev.cht4.slice(1), data.engine.cht[3]],
            map: [...prev.map.slice(1), data.engine.mapBar],
            oilPress: [...prev.oilPress.slice(1), data.engine.oilPressBar],
            oilTemp: [...prev.oilTemp.slice(1), data.engine.oilTempC],
            vibration: [...prev.vibration.slice(1), data.engine.vibrationGrms],
            healthIndex: [...prev.healthIndex.slice(1), data.health.index],
            anomalyScore: [...prev.anomalyScore.slice(1), calcAnomaly]
          };
        });
      }
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket.io] Gateway connection error:', err);
      setSocketError(`Direct CAN Socket offline (${err.message || 'error'}). Active internal simulation bridge fallback engaged.`);
      setIsConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [playAlertTone, applyMlData, applyLocalFallback]);

  // Inject Fault helper
  const injectFault = useCallback((faultType, severity = 0.85, uavId = 'Vahak-1') => {
    if (uavId !== 'Vahak-1') {
      socketRef.current?.emit('inject_fault', { faultType, severity, uavId });
      return;
    }
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('inject_fault', { faultType, severity });
    } else {
      setTelemetry(prev => ({
        ...prev,
        health: {
          ...prev.health,
          activeFault: faultType,
          severity: severity
        }
      }));
    }
  }, []);

  // Clear Fault helper
  const clearFault = useCallback((uavId = 'Vahak-1') => {
    if (typeof uavId !== 'string') uavId = 'Vahak-1';   // tolerate onClick={clearFault}
    if (uavId !== 'Vahak-1') {
      socketRef.current?.emit('clear_fault', { uavId });
      return;
    }
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('clear_fault');
    } else {
      setTelemetry(prev => ({
        ...prev,
        health: {
          ...prev.health,
          activeFault: 'NONE',
          severity: 0.0
        }
      }));
    }
  }, []);

  // Update sandbox conditions
  const updateManualConditions = useCallback((data) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('update_manual_conditions', data);
    }
  }, []);

  // ── FCS Autopilot Control Helpers ──
  // Exactly one channel per command: the socket when connected, else REST.
  const REST_FCS = {
    fcs_set_mode: '/api/fcs/mode', fcs_set_altitude: '/api/fcs/altitude', fcs_set_airspeed: '/api/fcs/airspeed',
    fcs_set_heading: '/api/fcs/heading', fcs_arm: '/api/fcs/arm', fcs_disarm: '/api/fcs/disarm',
    fcs_load_waypoints: '/api/fcs/waypoints', fcs_reset: '/api/fcs/reset',
  };
  const _emitFcs = (event, data) => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit(event, data ?? {});
    } else if (REST_FCS[event]) {
      gatewayFetch(REST_FCS[event], {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {})
      }).then(async (r) => {
        if (!r.ok) setCommandError(`${event}: ${(await r.json().catch(() => ({}))).error || `HTTP ${r.status}`}`);
      }).catch(() => {});
    }
    if (event === 'fcs_set_mode') setFcsState(prev => ({ ...prev, ap_mode: data.mode }));
    else if (event === 'fcs_set_altitude') setFcsState(prev => ({ ...prev, alt_sp_ft: data.alt_ft, ap_armed: true }));
    else if (event === 'fcs_set_airspeed') setFcsState(prev => ({ ...prev, ias_sp_kts: data.ias_kts, ap_armed: true }));
    else if (event === 'fcs_set_heading') setFcsState(prev => ({ ...prev, heading_sp_deg: data.heading_deg, ap_armed: true }));
    else if (event === 'fcs_arm') setFcsState(prev => ({ ...prev, ap_armed: true }));
    else if (event === 'fcs_disarm') setFcsState(prev => ({ ...prev, ap_armed: false, ap_mode: 'MANUAL_FBW' }));
    else if (event === 'fcs_load_waypoints') setFcsState(prev => ({ ...prev, ap_mode: 'AUTO_MISSION', ap_armed: true }));
  };

  const setFcsMode      = useCallback((mode) => _emitFcs('fcs_set_mode', { mode }), []);
  const setFcsAltitude  = useCallback((alt_ft) => _emitFcs('fcs_set_altitude', { alt_ft }), []);
  const setFcsAirspeed  = useCallback((ias_kts) => _emitFcs('fcs_set_airspeed', { ias_kts }), []);
  const setFcsHeading   = useCallback((heading_deg) => _emitFcs('fcs_set_heading', { heading_deg }), []);
  const setFcsLoiter    = useCallback((north, east, radius_m, cw) => _emitFcs('fcs_set_loiter', { north, east, radius_m, cw }), []);
  const loadFcsMission  = useCallback((waypoints) => _emitFcs('fcs_load_waypoints', { waypoints }), []);
  const fcsArm          = useCallback(() => _emitFcs('fcs_arm'), []);
  const fcsDisarm       = useCallback(() => _emitFcs('fcs_disarm'), []);
  const fcsFbwInput     = useCallback((roll, pitch, yaw, throttle) => _emitFcs('fcs_fbw_input', { roll, pitch, yaw, throttle }), []);
  const fcsReset        = useCallback(() => _emitFcs('fcs_reset'), []);

  const analytics = useMemo(() => ({
    thermal: {
      chtMax: Math.max(...telemetry.engine.cht),
      egtMax: Math.max(...telemetry.engine.egt),
      chtAvg: telemetry.engine.cht.reduce((a, b) => a + b, 0) / 4,
      egtAvg: telemetry.engine.egt.reduce((a, b) => a + b, 0) / 4,
    },
    combustion: {
      startOfInj: 18.2,
      injDuration: 1850,
      railPress: 185.4,
      ignAdv: 16.5
    },
    vibration: {
      fft1x: telemetry.engine.vibrationGrms * 0.4,
      fft2x: telemetry.engine.vibrationGrms * 0.2,
      fft05x: telemetry.engine.vibrationGrms * 0.1,
      knock: telemetry.engine.vibrationGrms > 1.0 ? 0.45 : 0.02
    },
    electrical: {
      alt1: telemetry.engine.genCurrentA * 0.5,
      alt2: telemetry.engine.genCurrentA * 0.5,
      ripple: 45.2,
      batSoc: 98.4,
      batSoh: 96.5
    }
  }), [telemetry]);

  // Compute Full Prognostics & Maintenance Pipeline


  // Replay Mode Toggle Actions
  const enterReplayMode = useCallback((sortie) => {
    setIsReplayMode(true);
    isReplayModeRef.current = true;
    if (sortie) {
      globalReplayEngine.loadSortie(sortie);
    }
  }, []);

  const exitReplayMode = useCallback(() => {
    globalReplayEngine.pause();
    setIsReplayMode(false);
    isReplayModeRef.current = false;
  }, []);

  return (
    <TelemetryContext.Provider
      value={{
        telemetry,
        aiPrognostics,
        missionDemandHours,
        setMissionDemandHours,
        analytics,
        historyBuffer,
        isConnected,
        socketError,
        audioEnabled,
        setAudioEnabled,
        injectFault,
        clearFault,
        fleetAi,
        updateManualConditions,
        // Mission Replay & Black Box Engine
        isReplayMode,
        enterReplayMode,
        exitReplayMode,
        replaySortie,
        replayPlaybackState,
        globalReplayEngine,
        flightRecorder,
        // ── FCS / Flight Controller ──
        fcsState,
        setFcsMode,
        setFcsAltitude,
        setFcsAirspeed,
        setFcsHeading,
        setFcsLoiter,
        loadFcsMission,
        fcsArm,
        fcsDisarm,
        fcsFbwInput,
        fcsReset,
        commandError,
        clearCommandError,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
};

export const useTelemetry = () => {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error('useTelemetry must be used within a TelemetryProvider');
  }
  return context;
};
