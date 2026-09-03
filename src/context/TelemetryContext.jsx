import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { PrognosticsPipeline } from '../prognostics/prognostics_pipeline';
import { globalReplayEngine } from '../replay/ReplayEngine';
import { flightRecorder } from '../replay/FlightDataRecorder';

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

export const TelemetryProvider = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [socketError, setSocketError] = useState(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [missionDemandHours, setMissionDemandHours] = useState(6.0);

  // Mission Replay & Black-Box State
  const [isReplayMode, setIsReplayMode] = useState(false);
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
              diagnosed_fault: event.frame.health?.activeFault ?? prev.diagnosed_fault,
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
    fleetState: [
      {
        id: 'Vahak-2',
        callsign: 'Vahak-2 (ESCORT LEAD)',
        engine: 'Rotax 915 iS (S/N: RTX-0819)',
        status: 'ON STATION',
        health: 96.2,
        rulHours: 785.0,
        flightHours: 415.0,
        tboDueHours: 785.0,
        subsystems: { combustion: 98, lubrication: 95, induction: 97, cooling: 96, vibration: 95 }
      },
      {
        id: 'Vahak-3',
        callsign: 'Vahak-3 (RELAY ORBIT)',
        engine: 'Rotax 916 iS (S/N: RTX-0902)',
        status: 'CLIMB TO CRUISE',
        health: 99.1,
        rulHours: 1120.0,
        flightHours: 80.0,
        tboDueHours: 1120.0,
        subsystems: { combustion: 100, lubrication: 99, induction: 98, cooling: 99, vibration: 100 }
      },
      {
        id: 'Vahak-4',
        callsign: 'Vahak-4 (PERIMETER PATROL)',
        engine: 'Rotax 915 iS (S/N: RTX-0754)',
        status: 'DERATED CRUISE',
        health: 84.5,
        rulHours: 420.0,
        flightHours: 780.0,
        tboDueHours: 420.0,
        subsystems: { combustion: 88, lubrication: 82, induction: 85, cooling: 86, vibration: 80 }
      },
      {
        id: 'Vahak-5',
        callsign: 'Vahak-5 (HANGAR RESERVE)',
        engine: 'Rotax 915 iS (S/N: RTX-0699)',
        status: 'MAINTENANCE HOLD',
        health: 38.0,
        rulHours: 120.0,
        flightHours: 1080.0,
        tboDueHours: 120.0,
        subsystems: { combustion: 42, lubrication: 35, induction: 50, cooling: 45, vibration: 30 }
      }
    ],
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
  const isFetchingMlRef = useRef(false);
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



  // Connect to Node.js CAN Telemetry Server & Fallback Simulator
  useEffect(() => {
    // Connect to backend server. If served via Vite proxy or direct, prioritize window.location or localhost:5002
    const socketUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? `http://${window.location.hostname}:5002`
      : undefined;

    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      timeout: 5000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(' Tactical Web Client Connected to CAN Bus Socket');
      setIsConnected(true);
      setSocketError(null);
    });

    socket.on('telemetry_frame', (data) => {
      // Feed live frames to Black-Box Flight Data Recorder if recording
      if (flightRecorder.isRecording) {
        flightRecorder.recordFrame(data, aiPrognostics);
      }

      // If Mission Replay is active, do not allow live frames to overwrite replay playhead
      if (isReplayModeRef.current) {
        return;
      }

      setTelemetry(data);

      // Trigger Audio Alarm on Status Transition
      if (data.health.status !== lastAlertStatusRef.current) {
        playAlertTone(data.health.status);
        lastAlertStatusRef.current = data.health.status;
      }

      // Update AI Prognostics by explicitly fetching from Python Microservice (Single Source of Truth)

      const now = Date.now();

      // Async fetch real ML Health + RUL prediction from migrated ai_health_rul microservice (throttled to 1 Hz)
      if (now - lastMlFetchRef.current >= 1000 && !isFetchingMlRef.current) {
        lastMlFetchRef.current = now;
        isFetchingMlRef.current = true;
        const aiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? `http://${window.location.hostname}:8001`
          : '/ai';
        fetch(`${aiHost}/api/health-rul/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timestamp_s: data.timestamp / 1000,
            rpm: data.engine.rpm,
            true_cht: data.engine.cht[2],
            sensor_cht: data.engine.cht[2],
            egt: data.engine.egt[2],
            oil_pressure: data.engine.oilPressBar,
            oil_temp: data.engine.oilTempC,
            fuel_flow: data.engine.fuelFlowLph,
            vibration: data.engine.vibrationGrms,
            battery_voltage: data.engine.genVoltageV,
            injection_timing: 18.5,
            health_index: data.health.index / 100.0,
            altitude: data.mission.altitudeFt,
            ambient_temp: data.mission.ambientTempC,
            throttle: data.engine.throttlePct
          })
        })
        .then(res => res.ok ? res.json() : null)
        .then(mlData => {
          if (mlData && mlData.rul) {
            // Map Python evidence items to UI format
            let mappedEvidence = [];
            if (Array.isArray(mlData.maintenance?.evidence)) {
              mappedEvidence = mlData.maintenance.evidence.map(ev => ({
                parameter: ev.feature || ev.parameter || 'Sensor Channel',
                goldenModel: ev.nominal_value !== undefined ? `< ${ev.nominal_value} ${ev.unit || ''}` : (ev.goldenModel || 'Nominal'),
                liveTelemetry: ev.observed_value !== undefined ? `${ev.observed_value} ${ev.unit || ''}` : (ev.liveTelemetry || 'In Spec'),
                residual: ev.residual !== undefined ? `${ev.residual > 0 ? '+' : ''}${ev.residual} ${ev.unit || ''}` : (ev.residual || '0.0'),
                diagnosticWeight: ev.contribution_pct !== undefined ? `${ev.contribution_pct}%` : (ev.diagnosticWeight || '85%'),
                status: ev.contribution_pct > 35 ? 'CRITICAL' : ev.contribution_pct > 15 ? 'WARNING' : 'NOMINAL'
              }));
            }

            const rawFault = mlData.health?.diagnosed_fault;
            const normFault = (!rawFault || ['none', 'NONE', 'NOMINAL', 'NOMINAL_OPERATION', 'NOMINAL BASELINE'].includes(rawFault))
              ? 'NONE'
              : rawFault;

            setAiPrognostics(prev => ({
              ...prev,
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
                evidence: mappedEvidence.length > 0 ? mappedEvidence : (prev.maintenance?.evidence || [])
              },
              feature_attributions: Array.isArray(mlData.feature_attributions) ? mlData.feature_attributions.reduce((acc, curr) => {
                acc[curr.feature] = curr.importance_pct;
                return acc;
              }, {}) : prev.feature_attributions
            }));
          }
        })
        .catch(() => {
          // Seamless fallback to local first-principles physics prognostics pipeline
          try {
            const localResult = PrognosticsPipeline.evaluate({
              telemetry: data,
              missionDemandHours: missionDemandHours,
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
                diagnosed_fault: localResult.health.activeFault,
                severity_level: localResult.health.status,
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
        })
        .finally(() => {
          isFetchingMlRef.current = false;
        });
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
      console.error('[Socket.io] Connection error to http://localhost:5002:', err);
      setSocketError(`Direct CAN Socket offline (${err.message || 'error'}). Active internal simulation bridge fallback engaged.`);
      setIsConnected(false);
    });

    return () => {
      socket.disconnect();
    };
  }, [playAlertTone]);

  // Inject Fault helper
  const injectFault = useCallback((faultType, severity = 0.85) => {
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
  const clearFault = useCallback(() => {
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
        updateManualConditions,
        // Mission Replay & Black Box Engine
        isReplayMode,
        enterReplayMode,
        exitReplayMode,
        replaySortie,
        replayPlaybackState,
        globalReplayEngine,
        flightRecorder
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
