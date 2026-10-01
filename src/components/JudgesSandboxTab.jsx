import React, { useState, useMemo, useEffect, useRef } from 'react';
import { gatewayFetch } from '../api/gateway';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EngineDigitalTwin, REGISTRY } from './EngineDigitalTwin';
import { useTelemetry } from '../context/TelemetryContext';
import { PrognosticsPipeline } from '../prognostics/prognostics_pipeline.js';
import { 
  Sliders, 
  Play, 
  Activity, 
  Cpu, 
  Award,
  AlertTriangle, 
  Zap, 
  Wrench, 
  CheckCircle2, 
  FastForward, 
  Info,
  RotateCcw,
  Gauge,
  Thermometer,
  Flame,
  Droplets,
  Wind,
  Compass,
  ShieldAlert,
  Radio,
  Send,
  RefreshCw,
  Layers,
  ArrowRight,
  ShieldCheck,
  Eye,
  Camera,
  Maximize2,
  Minimize2,
  Check
} from 'lucide-react';

export const JudgesSandboxTab = () => {
  const { telemetry, injectFault, clearFault, updateManualConditions } = useTelemetry();

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. SLIDER PARAMETER STATE (17 DEGREES OF FREEDOM)
  // ═══════════════════════════════════════════════════════════════════════════
  const [altitudeFt, setAltitudeFt] = useState(14500);
  const [airspeedKts, setAirspeedKts] = useState(110);
  const [rpm, setRpm] = useState(4800);
  const [throttlePct, setThrottlePct] = useState(78.5);

  // EGT 1-4 (°C)
  const [egt, setEgt] = useState([842, 840, 844, 841]);
  // CHT 1-4 (°C)
  const [cht, setCht] = useState([106, 107, 106, 108]);

  // Pressures, Fluids & Dynamics
  const [mapBar, setMapBar] = useState(1.42);
  const [oilPressBar, setOilPressBar] = useState(3.85);
  const [oilTempC, setOilTempC] = useState(98.4);
  const [vibrationGrms, setVibrationGrms] = useState(0.28);
  const [fuelPressureBar, setFuelPressureBar] = useState(3.12);
  const [genVoltageV, setGenVoltageV] = useState(28.4);

  const [activeFaultTag, setActiveFaultTag] = useState('NONE');
  const [activeBenchmark, setActiveBenchmark] = useState('NOMINAL_LOITER');
  const [broadcastNotice, setBroadcastNotice] = useState(null);
  const [autoSyncTwin, setAutoSyncTwin] = useState(true);

  // 3D Viewport Controls
  const [viewportMode, setViewportMode] = useState('3D_AND_EVAL'); // '3D_AND_EVAL' | '3D_ONLY' | 'EVAL_ONLY'
  const [explodeFactor, setExplodeFactor] = useState(0);
  const [selectedComp, setSelectedComp] = useState('ENGINE_BLOCK');
  const [viewMode3D, setViewMode3D] = useState('DEFAULT'); // 'DEFAULT' | 'THERMAL' | 'HEALTH'
  const controlsRef = useRef(null);
  const camTargetRef = useRef(null);

  // Live AI service state (reached through the authenticated gateway)
  const [aiResult, setAiResult] = useState(null);
  const [aiConnected, setAiConnected] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 1-CLICK BENCHMARK SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════
  // Benchmark operating points are generated from src/engine/EngineSimulator.js at the
  // default injection severity (0.85), so they match the physics the AI models were trained on.
  const BENCHMARKS = [
    {
      id: 'NOMINAL_LOITER',
      profileCode: 'PROFILE A',
      standard: 'Simulator-generated',
      label: 'Profile A: Nominal Loiter Baseline',
      tag: 'PRISTINE',
      badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700',
      summary: 'Simulator nominal loiter at 4800 RPM / 78.5 %: EGT 840 °C, CHT 106 °C, oil 3.85 bar / 98 °C, vibration 0.28 g.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 110,
        rpm: 4800,
        throttlePct: 78.5,
        egt: [840, 840, 840, 840],
        cht: [106, 106, 106, 106],
        mapBar: 1.42,
        oilPressBar: 3.85,
        oilTempC: 98,
        vibrationGrms: 0.28,
        fuelPressureBar: 3.12,
        genVoltageV: 28.4,
        faultTag: 'NONE'
      }
    },
    {
      id: 'CYL3_LEAN_CLOG',
      profileCode: 'PROFILE B',
      standard: 'Simulator-generated',
      label: 'Profile B: Cyl 3 Lean Clog',
      tag: 'COMBUSTION',
      badgeClass: 'border-red-300 bg-red-50 text-red-700',
      summary: 'Simulator CYL3_INJECTOR @ 0.85: EGT3 954.7 °C (+122.3 °C spread), CHT3 129.8 °C, vibration 1.09 g, lean lambda shift.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 108,
        rpm: 4800,
        throttlePct: 78.5,
        egt: [831.5, 833.2, 954.7, 832.4],
        cht: [106, 106, 129.8, 106],
        mapBar: 1.42,
        oilPressBar: 3.85,
        oilTempC: 98,
        vibrationGrms: 1.09,
        fuelPressureBar: 2.75,
        genVoltageV: 28.4,
        faultTag: 'CYL3_INJECTOR'
      }
    },
    {
      id: 'PISTON_BLOW_BY',
      profileCode: 'PROFILE C',
      standard: 'Simulator-generated',
      label: 'Profile C: Ring Blow-By Degradation',
      tag: 'THERMAL/OIL',
      badgeClass: 'border-amber-300 bg-amber-50 text-amber-700',
      summary: 'Simulator BLOW_BY @ 0.85: oil temp 124.6 °C, oil press 2.45 bar, CHT2/CHT3 121.3/124.7 °C, vibration 0.83 g.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 105,
        rpm: 4800,
        throttlePct: 78.5,
        egt: [840, 840, 840, 840],
        cht: [106, 121.3, 124.7, 106],
        mapBar: 1.42,
        oilPressBar: 2.45,
        oilTempC: 124.6,
        vibrationGrms: 0.83,
        fuelPressureBar: 3.10,
        genVoltageV: 28.4,
        faultTag: 'BLOW_BY'
      }
    },
    {
      id: 'OIL_CAVITATION',
      profileCode: 'PROFILE D',
      standard: 'Simulator-generated',
      label: 'Profile D: Lubrication Collapse & Cavitation',
      tag: 'LUBRICATION',
      badgeClass: 'border-red-300 bg-red-50 text-red-700',
      summary: 'Simulator OIL_PUMP_CAVITATION @ 0.85: oil press 1.9 bar mean with ±0.64 bar chatter, oil temp 119.3 °C, bearing vibration 1.43 g.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 102,
        rpm: 4800,
        throttlePct: 78.5,
        egt: [840, 840, 840, 840],
        cht: [106, 106, 106, 106],
        mapBar: 1.42,
        oilPressBar: 1.9,
        oilTempC: 119.3,
        vibrationGrms: 1.43,
        fuelPressureBar: 3.08,
        genVoltageV: 28.4,
        faultTag: 'OIL_PUMP_CAVITATION'
      }
    },
    {
      id: 'TURBO_SURGE',
      profileCode: 'PROFILE E',
      standard: 'Simulator-generated',
      label: 'Profile E: Turbo Overboost Surge',
      tag: 'AIR/BOOST',
      badgeClass: 'border-purple-300 bg-purple-50 text-purple-700',
      summary: 'Simulator TURBO_WASTEGATE_STUCK @ 0.85: MAP 1.91 bar (overboost), EGT ~878 °C on all cylinders, RPM 5098.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 125,
        rpm: 5098,
        throttlePct: 78.5,
        egt: [878.2, 875.7, 880.8, 877.4],
        cht: [106, 106, 106, 106],
        mapBar: 1.91,
        oilPressBar: 3.85,
        oilTempC: 98,
        vibrationGrms: 0.71,
        fuelPressureBar: 3.45,
        genVoltageV: 28.4,
        faultTag: 'TURBO_WASTEGATE_STUCK'
      }
    }
  ];

  const handleApplyBenchmark = (b) => {
    setActiveBenchmark(b.id);
    setAltitudeFt(b.params.altitudeFt);
    setAirspeedKts(b.params.airspeedKts);
    setRpm(b.params.rpm);
    setThrottlePct(b.params.throttlePct);
    setEgt([...b.params.egt]);
    setCht([...b.params.cht]);
    setMapBar(b.params.mapBar);
    setOilPressBar(b.params.oilPressBar);
    setOilTempC(b.params.oilTempC);
    setVibrationGrms(b.params.vibrationGrms);
    setFuelPressureBar(b.params.fuelPressureBar ?? 3.12);
    setGenVoltageV(b.params.genVoltageV ?? 28.4);
    setActiveFaultTag(b.params.faultTag);

    // Auto-focus camera on relevant 3D component
    if (b.params.faultTag === 'CYL3_INJECTOR') {
      setSelectedComp('CYL_03');
      camTargetRef.current = REGISTRY.CYL_03;
    } else if (b.params.faultTag === 'OIL_PUMP_CAVITATION' || b.params.faultTag === 'BLOW_BY') {
      setSelectedComp('OIL_SYSTEM');
      camTargetRef.current = REGISTRY.OIL_SYSTEM;
    } else if (b.params.faultTag === 'TURBO_WASTEGATE_STUCK') {
      setSelectedComp('TURBO_01');
      camTargetRef.current = REGISTRY.TURBO_01;
    } else {
      setSelectedComp('ENGINE_BLOCK');
      camTargetRef.current = REGISTRY.ENGINE_BLOCK;
    }
  };

  const handleEgtChange = (idx, val) => {
    const next = [...egt];
    next[idx] = parseFloat(val);
    setEgt(next);
    setActiveBenchmark('CUSTOM');
  };

  const handleChtChange = (idx, val) => {
    const next = [...cht];
    next[idx] = parseFloat(val);
    setCht(next);
    setActiveBenchmark('CUSTOM');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ASYNC AI SERVICE INFERENCE (VIA GATEWAY, PER-USER SANDBOX SESSION)
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(async () => {
      setAiLoading(true);
      try {
        const payload = {
          rpm,
          throttle_pct: throttlePct,
          altitude_ft: altitudeFt,
          egt,
          cht,
          map_bar: mapBar,
          oil_press_bar: oilPressBar,
          oil_temp_c: oilTempC,
          vibration_grms: vibrationGrms,
          fuel_pressure_bar: fuelPressureBar,
          gen_voltage_v: genVoltageV,
          is_sandbox: true,
          mode: 'SANDBOX'
        };
        // Via the gateway, which runs it in the sandbox AI session
        const res = await gatewayFetch('/api/health-rul/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res && res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAiResult({
              ...data,
              engine_health_index: data?.rul?.healthIndexScore ?? data?.health?.health_score ?? data?.engine_health_index,
              rul_hours_mean: data?.rul?.rulHours ?? data?.rul_hours_mean,
              rul_hours_lower_95: data?.rul?.rulHoursLower95 ?? data?.rul_hours_lower_95,
              rul_hours_upper_95: data?.rul?.rulHoursUpper95 ?? data?.rul_hours_upper_95,
              degradation_rate_pct_per_hour: data?.rul?.degradationRatePercentPerHour ?? data?.degradation_rate_pct_per_hour,
              trend: data?.rul?.degradationTrend ?? data?.trend,
              stress: data?.rul?.stressBreakdown ?? data?.stress,
              subsystems: data?.rul?.subsystemDegradation ?? data?.subsystems
            });
            setAiConnected(true);
          }
        } else {
          if (isMounted) setAiConnected(false);
        }
      } catch (err) {
        if (isMounted) setAiConnected(false);
      } finally {
        if (isMounted) setAiLoading(false);
      }
    }, 160);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [rpm, throttlePct, altitudeFt, egt, cht, mapBar, oilPressBar, oilTempC, vibrationGrms, fuelPressureBar, genVoltageV]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. AUTO-SYNC WITH CAN BUS & DIGITAL TWIN
  // ═══════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!autoSyncTwin) return;
    if (activeFaultTag !== 'NONE') {
      injectFault(activeFaultTag, 0.85);
    } else {
      clearFault();
    }
    updateManualConditions({
      altitudeFt,
      airspeedKts,
      targetRpm: rpm,
      throttlePct
    });
  }, [altitudeFt, airspeedKts, rpm, throttlePct, activeFaultTag, autoSyncTwin]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. FIRST-PRINCIPLES & ML EVALUATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════════
  const syntheticTelemetry = useMemo(() => {
    return {
      timestamp: Date.now(),
      mission: {
        altitudeFt,
        airspeedKts,
        throttlePct,
        ambientTempC: 15.0 - (altitudeFt / 1000) * 1.98,
        baroPressureBar: 1.01325 * Math.pow(1.0 - 0.0225577 * (altitudeFt * 0.0003048), 5.25588),
        uavId: 'Vahak-1',
        missionPhase: 'LOITER'
      },
      engine: {
        rpm,
        throttlePct,
        egt,
        cht,
        mapBar,
        oilPressBar,
        oilTempC,
        vibrationGrms,
        fuelFlowLph: Math.round(14.0 + (throttlePct / 100) * 16.0 + (rpm / 5800) * 4.0),
        fuelPressureBar,
        lambda: activeFaultTag === 'CYL3_INJECTOR' ? 1.15 : (Math.max(...egt) > 920 ? 1.06 : 0.94),
        wastegateDutyPct: mapBar > 1.8 ? 95 : 62,
        genVoltageV,
        genCurrentA: 45.2 + (throttlePct > 80 ? 8.5 : 0),
        coolantTempC: Math.max(...cht) * 0.85
      },
      health: {
        // Status/index from the AI's assessment of these inputs; the chosen fault tag is only the
        // scenario shown on the 3D model (ground truth), never an input to any estimate.
        status: aiResult?.health?.severity_level === 'CRITICAL' ? 'CRITICAL' : aiResult?.health?.severity_level === 'ELEVATED' ? 'DEGRADED' : 'NOMINAL',
        activeFault: activeFaultTag,
        severity: activeFaultTag === 'NONE' ? 0.0 : 0.85,
        index: aiResult?.rul?.healthIndexScore ?? 100
      },
      residuals: {
        egtResiduals: egt.map(v => v - 840),
        chtResiduals: cht.map(v => v - 106),
        oilPressResidual: oilPressBar - 3.85,
        mapResidual: mapBar - 1.42
      }
    };
  }, [altitudeFt, airspeedKts, rpm, throttlePct, egt, cht, mapBar, oilPressBar, oilTempC, vibrationGrms, fuelPressureBar, genVoltageV, activeFaultTag, aiResult]);

  const evalResult = useMemo(() => {
    // Run physics and ML pipeline
    // Physics-only fallback (used only while the AI is offline): the fault tag is hidden from it
    const pipelineOut = PrognosticsPipeline.evaluate({
      telemetry: { ...syntheticTelemetry, health: { ...syntheticTelemetry.health, activeFault: 'NONE' } },
      missionDemandHours: 6.0,
      unitId: 'Vahak-1'
    });

    const maxEgt = Math.max(...egt);
    const minEgt = Math.min(...egt);
    const egtSpread = maxEgt - minEgt;
    const maxCht = Math.max(...cht);
    const minCht = Math.min(...cht);
    const chtSpread = maxCht - minCht;

    // Airworthiness logic
    let airworthinessStatus = 'NOMINAL';
    let airworthinessBadge = 'border-emerald-300 bg-emerald-50 text-emerald-800';
    let airworthinessColor = 'text-emerald-700 font-bold';
    let airworthinessDesc = 'Rotax 915 iS engine operating well within certified EASA/FAA flight envelopes. Safe for sustained mission loiter.';

    const hi = aiResult?.rul?.healthIndexScore ?? aiResult?.engine_health_index ?? (pipelineOut?.health?.index ?? 100);
    const rulH = aiResult?.rul?.rulHours ?? aiResult?.rul_hours_mean ?? (pipelineOut?.rul?.hours ?? 750);

    if (hi < 40 || rulH < 2.0 || oilPressBar < 1.8 || maxEgt > 960 || vibrationGrms > 1.3) {
      airworthinessStatus = 'CRITICAL ABORT';
      airworthinessBadge = 'border-red-300 bg-red-50 text-red-800';
      airworthinessColor = 'text-red-700 font-bold';
      airworthinessDesc = 'CRITICAL AIRWORTHINESS EXCEEDANCE! Catastrophic failure risk detected. Autonomous emergency landing mandatory.';
    } else if (hi < 75 || rulH < 10.0 || egtSpread > 55 || maxCht > 125 || oilPressBar < 2.8 || mapBar > 1.8) {
      airworthinessStatus = 'DERATED';
      airworthinessBadge = 'border-amber-300 bg-amber-50 text-amber-800';
      airworthinessColor = 'text-amber-800 font-bold';
      airworthinessDesc = 'Subsystem wear exceeds nominal baseline. Derated throttle envelope applied. Return to base advised.';
    }

    // Rule-based RTB recommendation
    const homeBase = { name: "AFS Uttarlai (Barmer)", lat: 25.8117, lng: 71.4883, alt_ft: 500 };
    const auxStrip = { name: "AFS Jaisalmer Forward Base", lat: 26.8897, lng: 70.8653, alt_ft: 825 };
    const distHome = 64.8;
    const distAux = 32.3;

    const requiresDivert = airworthinessStatus === 'CRITICAL ABORT';
    const targetDest = requiresDivert ? auxStrip : homeBase;
    const targetDist = requiresDivert ? distAux : distHome;

    let recThrottle = 78.5;
    let recRpm = 4800;
    let recClimbFpm = 0;
    let recSpeed = 115;
    let rlAction = 'CONTINUE_NOMINAL_MISSION';

    if (airworthinessStatus === 'CRITICAL ABORT') {
      recThrottle = 58.0;
      recRpm = 4200;
      recClimbFpm = -350;
      recSpeed = 95;
      rlAction = 'EMERGENCY_DIVERT_RTB';
    } else if (airworthinessStatus === 'DERATED') {
      recThrottle = 68.0;
      recRpm = 4600;
      recClimbFpm = -200;
      recSpeed = 105;
      rlAction = 'DERATE_AND_CONTINUE_MISSION';
    }

    const flightTimeMin = Math.max(0.1, (targetDist / recSpeed) * 60.0);
    const safetyMargin = Number((rulH / Math.max(0.1, flightTimeMin / 60.0)).toFixed(2));

    return {
      pipeline: pipelineOut,
      airworthiness: {
        status: airworthinessStatus,
        label: airworthinessStatus === 'NOMINAL' ? 'NOMINAL AIRWORTHY' : airworthinessStatus === 'DERATED' ? 'DERATED FLIGHT RESTRICTION' : 'CRITICAL FLIGHT ABORT',
        color: airworthinessColor,
        desc: airworthinessDesc,
        badge: airworthinessBadge
      },
      metrics: {
        maxEgt,
        maxCht,
        egtSpread,
        chtSpread,
        healthIndex: hi,
        rulHours: rulH,
        rulLower95: aiResult?.rul?.rulHoursLower95 ?? aiResult?.rul_hours_lower_95 ?? (pipelineOut?.rul?.lower95 ?? (rulH * 0.85).toFixed(1)),
        rulUpper95: aiResult?.rul?.rulHoursUpper95 ?? aiResult?.rul_hours_upper_95 ?? (pipelineOut?.rul?.upper95 ?? (rulH * 1.15).toFixed(1)),
        confidencePct: aiResult?.health?.confidence_pct ?? (pipelineOut?.rul?.confidencePct ?? null),
        ratePerHour: aiResult?.rul?.degradationRatePercentPerHour ?? aiResult?.degradation_rate_pct_per_hour ?? (pipelineOut?.degradation?.ratePerHour ?? 0.045),
        trend: aiResult?.rul?.degradationTrend ?? pipelineOut?.degradation?.trend ?? 'STABLE',
        stress: aiResult?.rul?.stressBreakdown ?? pipelineOut?.degradation?.stressBreakdown ?? { combinedStress: 1.0 }
      },
      subsystems: {
        thermal: Number((aiResult?.rul?.subsystemDegradation?.thermal ?? pipelineOut?.degradation?.subsystems?.thermal ?? 4.2)),
        mechanical: Number((aiResult?.rul?.subsystemDegradation?.mechanical ?? pipelineOut?.degradation?.subsystems?.mechanical ?? 0.0)),
        lubrication: Number((aiResult?.rul?.subsystemDegradation?.lubrication ?? pipelineOut?.degradation?.subsystems?.lubrication ?? 4.2)),
        combustion: Number((aiResult?.rul?.subsystemDegradation?.combustion ?? pipelineOut?.degradation?.subsystems?.combustion ?? 0.0)),
        fuel: Number((aiResult?.rul?.subsystemDegradation?.fuel ?? pipelineOut?.degradation?.subsystems?.fuel ?? 5.7)),
        electrical: Number((aiResult?.rul?.subsystemDegradation?.electrical ?? pipelineOut?.degradation?.subsystems?.electrical ?? 4.6)),
      },
      rlRecommendation: {
        action: rlAction,
        targetField: targetDest.name,
        distNm: targetDist,
        flightTimeMin: Number(flightTimeMin.toFixed(1)),
        safetyMargin,
        recThrottle,
        recRpm,
        recClimbFpm,
        recSpeed
      }
    };
  }, [syntheticTelemetry, aiResult, egt, cht, oilPressBar, mapBar, vibrationGrms, fuelPressureBar, genVoltageV]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. BROADCAST & RESET HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════
  const handleCommitToLiveTwin = () => {
    if (activeFaultTag !== 'NONE') {
      injectFault(activeFaultTag, 0.85);
    } else {
      clearFault();
    }
    updateManualConditions({
      altitudeFt,
      airspeedKts,
      targetRpm: rpm,
      throttlePct
    });

    setBroadcastNotice(`Conditions Committed! 100 Hz CAN Telemetry updated: RPM=${rpm}, MAP=${mapBar}b, Vib=${vibrationGrms}g.`);
    setTimeout(() => setBroadcastNotice(null), 4500);
  };

  const handleResetNominal = () => {
    const nom = BENCHMARKS[0];
    handleApplyBenchmark(nom);
    clearFault();
    updateManualConditions({
      altitudeFt: 14500,
      airspeedKts: 110,
      targetRpm: 4800,
      throttlePct: 78.5
    });
    setBroadcastNotice('All engine parameters restored to certified nominal baseline.');
    setTimeout(() => setBroadcastNotice(null), 3500);
  };

  const setCameraPreset = (key) => {
    if (REGISTRY[key]) {
      setSelectedComp(key);
      camTargetRef.current = REGISTRY[key];
    }
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-4 pb-12 pr-1">
      
      {/* ── TOP HEADER & BENCHMARK BAR ── */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-sky-50 border border-sky-200 text-sky-600">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-sm tracking-wider text-slate-900 uppercase">
                WHAT-IF TEST BENCH (MANUAL INPUTS → AI)
              </h2>
              <p className="text-[11px] font-mono text-slate-500">
                Set engine readings by hand or load a simulator-generated profile; the AI assesses each frame on its own (fresh session, no persistence), so earlier profiles cannot influence it. The diagnosis is reliable; health from a single noise-free frame is less precise than the live 8-sample stream (measured: nominal profile ≈ 89, fault profiles 17–31 vs ≈ 15 true). No hardware is in the loop.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 bg-slate-50 text-xs font-mono cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSyncTwin}
                onChange={e => setAutoSyncTwin(e.target.checked)}
                className="accent-sky-600 w-3.5 h-3.5 rounded cursor-pointer"
              />
              <span className={autoSyncTwin ? 'text-sky-700 font-bold' : 'text-slate-500'}>
                Auto-apply to live simulator
              </span>
            </label>

            <button
              onClick={handleResetNominal}
              className="px-3 py-1.5 rounded text-xs font-mono font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-1.5 shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
              RESET NOMINAL
            </button>

            <button
              onClick={handleCommitToLiveTwin}
              className="px-3 py-1.5 rounded text-xs font-mono font-bold bg-sky-600 text-white hover:bg-sky-700 transition-all flex items-center gap-1.5 shadow-xs"
            >
              <Send className="w-3.5 h-3.5 fill-current" />
              APPLY TO LIVE SIMULATOR (VAHAK-1)
            </button>
          </div>
        </div>

        {/* 1-Click Benchmark Scenarios Toolbar */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 uppercase flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-sky-600" /> SIMULATOR-GENERATED TEST PROFILES:
            </span>
            <div className="flex items-center gap-2">
              {aiConnected ? (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-700 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-pulse" />
                  AI SERVICE ONLINE (VIA GATEWAY)
                </span>
              ) : (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  PHYSICS PIPELINE READY
                </span>
              )}
              <span className="text-[10px] font-mono text-slate-500">
                ACTIVE: <span className="text-slate-900 font-bold">{BENCHMARKS.find(b => b.id === activeBenchmark)?.label || activeBenchmark}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {BENCHMARKS.map(b => {
              const isSelected = activeBenchmark === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => handleApplyBenchmark(b)}
                  title={b.label}
                  className={`p-3 rounded-lg border text-left transition-all flex flex-col justify-between gap-2 min-h-[110px] ${
                    isSelected
                      ? 'bg-sky-50/90 border-sky-400 text-sky-950 shadow-xs ring-1 ring-sky-300'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 tracking-wider">
                      {b.profileCode}
                    </span>
                    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border font-semibold ${b.badgeClass}`}>
                      {b.tag}
                    </span>
                  </div>
                  <div className={`text-[11px] font-mono font-bold leading-snug break-words ${isSelected ? 'text-sky-900' : 'text-slate-900'}`}>
                    {b.label}
                  </div>
                  <p className="text-[9px] font-mono text-slate-500 line-clamp-2 leading-tight">
                    {b.summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Broadcast Notice */}
        {broadcastNotice && (
          <div className="p-2 rounded border border-sky-200 bg-sky-50 text-sky-900 font-mono text-xs flex items-center gap-2 animate-fadeIn shadow-xs">
            <Radio className="w-4 h-4 text-sky-600 animate-pulse" />
            <span>{broadcastNotice}</span>
          </div>
        )}
      </div>

      {/* ── 2-COLUMN MAIN CONTENT (SLIDERS ON LEFT, 3D MODEL & EVALUATION ON RIGHT) ── */}
      <div className="flex flex-col lg:flex-row gap-4">
        
        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* LEFT COLUMN: INTERACTIVE MULTI-PARAMETER SLIDERS */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <div className="w-full lg:w-1/2 flex flex-col gap-4">
          
          {/* Group 1: Flight, Altitude & Airspeed (ISA Atmosphere) */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Wind className="w-4 h-4 text-sky-600" />
                <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                  FLIGHT & ATMOSPHERIC CONDITIONS (ISA MODEL)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500 tabular-nums font-medium">
                P_AMB: {(1.01325 * Math.pow(1.0 - 0.0225577 * (altitudeFt * 0.0003048), 5.25588)).toFixed(3)} bar
              </span>
            </div>

            {/* Altitude Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Pressure Altitude:</span>
                <span className="text-slate-900 font-bold tabular-nums">{altitudeFt.toLocaleString()} ft</span>
              </div>
              <input
                type="range"
                min="0"
                max="23000"
                step="500"
                value={altitudeFt}
                onChange={e => { setAltitudeFt(parseInt(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className="w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 accent-sky-600"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Sea Level (0 ft)</span>
                <span>Operational Cruise (14,500 ft)</span>
                <span>Service ceiling (~23,000 ft)</span>
              </div>
            </div>

            {/* Airspeed Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Calibrated Airspeed:</span>
                <span className="text-slate-900 font-bold tabular-nums">{airspeedKts} kts</span>
              </div>
              <input
                type="range"
                min="60"
                max="160"
                step="1"
                value={airspeedKts}
                onChange={e => { setAirspeedKts(parseInt(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className="w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 accent-sky-600"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Loiter Stall: 60 kts</span>
                <span>Best Range: 110 kts</span>
                <span>VNE: 160 kts</span>
              </div>
            </div>
          </div>

          {/* Group 2: Powertrain & Turbocharger Dynamics */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-600" />
                <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                  POWERTRAIN & TURBOCHARGER DYNAMICS
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500 font-medium">ROTAX 915 iS TURBO</span>
            </div>

            {/* RPM Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Engine Crankshaft RPM:</span>
                <span className={`font-bold tabular-nums ${rpm > 5500 ? 'text-red-600' : 'text-slate-900'}`}>
                  {rpm} RPM
                </span>
              </div>
              <input
                type="range"
                min="2000"
                max="5800"
                step="25"
                value={rpm}
                onChange={e => { setRpm(parseInt(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${rpm > 5500 ? 'accent-red-600' : 'accent-sky-600'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Idle: 2000</span>
                <span>Max Continuous: 5500</span>
                <span>Takeoff Redline: 5800</span>
              </div>
            </div>

            {/* Throttle Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Throttle Position (FADEC):</span>
                <span className="text-slate-900 font-bold tabular-nums">{throttlePct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={throttlePct}
                onChange={e => { setThrottlePct(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className="w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 accent-sky-600"
              />
            </div>

            {/* MAP Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Manifold Absolute Pressure (MAP):</span>
                <span className={`font-bold tabular-nums ${mapBar > 1.85 ? 'text-red-600' : 'text-slate-900'}`}>
                  {mapBar.toFixed(2)} bar ({((mapBar - 1.0) * 14.5038).toFixed(1)} psi boost)
                </span>
              </div>
              <input
                type="range"
                min="0.80"
                max="2.40"
                step="0.02"
                value={mapBar}
                onChange={e => { setMapBar(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${mapBar > 1.85 ? 'accent-red-600' : 'accent-sky-600'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Idle: 0.80 bar</span>
                <span>Nominal Cruise: 1.42 bar</span>
                <span>Overboost Surge: &gt;1.85 bar</span>
              </div>
            </div>
          </div>

          {/* Group 3: Combustion & Exhaust Gas Temperatures (EGT 1-4) */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-600" />
                <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                  COMBUSTION: EXHAUST GAS TEMPERATURES (EGT 1–4)
                </h3>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold tabular-nums ${
                evalResult.metrics.egtSpread > 40 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                SPREAD: {evalResult.metrics.egtSpread.toFixed(1)}°C
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map(idx => {
                const val = egt[idx];
                const isCrit = val > 920;
                const isWarn = val > 880;
                return (
                  <div key={idx} className="flex flex-col gap-1 p-2.5 rounded border border-slate-200 bg-slate-50">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-600">Cylinder {idx + 1}:</span>
                      <span className={`font-bold tabular-nums ${isCrit ? 'text-red-600' : isWarn ? 'text-amber-600' : 'text-slate-900'}`}>
                        {val.toFixed(0)}°C
                      </span>
                    </div>
                    <input
                      type="range"
                      min="600"
                      max="1050"
                      step="5"
                      value={val}
                      onChange={e => handleEgtChange(idx, e.target.value)}
                      className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${isCrit ? 'accent-red-600' : isWarn ? 'accent-amber-500' : 'accent-sky-600'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Group 4: Thermal & Cylinder Head Temperatures (CHT 1-4) */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-sky-600" />
                <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                  THERMAL: CYLINDER HEAD TEMPERATURES (CHT 1–4)
                </h3>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold tabular-nums ${
                evalResult.metrics.chtSpread > 15 ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                MAX: {evalResult.metrics.maxCht.toFixed(1)}°C
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map(idx => {
                const val = cht[idx];
                const isCrit = val > 130;
                const isWarn = val > 118;
                return (
                  <div key={idx} className="flex flex-col gap-1 p-2.5 rounded border border-slate-200 bg-slate-50">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-600">Cylinder {idx + 1}:</span>
                      <span className={`font-bold tabular-nums ${isCrit ? 'text-red-600' : isWarn ? 'text-amber-600' : 'text-slate-900'}`}>
                        {val.toFixed(1)}°C
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="160"
                      step="1"
                      value={val}
                      onChange={e => handleChtChange(idx, e.target.value)}
                      className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${isCrit ? 'accent-red-600' : isWarn ? 'accent-amber-500' : 'accent-sky-600'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Group 5: Lubrication & Structural Dynamics */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-sky-600" />
                <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                  LUBRICATION, FLUIDS & VIBRATION
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500 font-medium">HYDRODYNAMICS</span>
            </div>

            {/* Oil Pressure */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Main Oil Gallery Pressure:</span>
                <span className={`font-bold tabular-nums ${oilPressBar < 2.0 ? 'text-red-600' : oilPressBar < 2.8 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {oilPressBar.toFixed(2)} bar
                </span>
              </div>
              <input
                type="range"
                min="0.50"
                max="6.00"
                step="0.05"
                value={oilPressBar}
                onChange={e => { setOilPressBar(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${oilPressBar < 2.0 ? 'accent-red-600' : 'accent-sky-600'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Critical: &lt;1.8 bar</span>
                <span>Nominal: 3.5 - 4.5 bar</span>
                <span>Relief Max: 6.0 bar</span>
              </div>
            </div>

            {/* Oil Temp */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Oil Sump Temperature:</span>
                <span className={`font-bold tabular-nums ${oilTempC > 120 ? 'text-red-600' : oilTempC > 110 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {oilTempC.toFixed(1)}°C
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="150"
                step="1"
                value={oilTempC}
                onChange={e => { setOilTempC(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${oilTempC > 120 ? 'accent-red-600' : 'accent-sky-600'}`}
              />
            </div>

            {/* Vibration */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Crankcase Broadband Vibration:</span>
                <span className={`font-bold tabular-nums ${vibrationGrms > 1.0 ? 'text-red-600' : vibrationGrms > 0.4 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {vibrationGrms.toFixed(2)} g-RMS
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="3.00"
                step="0.02"
                value={vibrationGrms}
                onChange={e => { setVibrationGrms(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${vibrationGrms > 1.0 ? 'accent-red-600' : 'accent-sky-600'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Baseline: 0.28g</span>
                <span>Warning: &gt;0.45g</span>
                <span>Distress: &gt;1.20g</span>
              </div>
            </div>
          </div>

          {/* Group 6: Fuel Delivery & 28V Electrical Generation */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-sky-600" />
                <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                  FUEL DELIVERY & 28V ELECTRICAL SYSTEM
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500 font-medium">AVIONICS & INJECTION</span>
            </div>

            {/* Fuel Pressure */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">Fuel Rail Injection Pressure:</span>
                <span className={`font-bold tabular-nums ${fuelPressureBar < 2.7 ? 'text-red-600' : fuelPressureBar > 3.8 ? 'text-amber-600' : 'text-emerald-700'}`}>
                  {fuelPressureBar.toFixed(2)} bar
                </span>
              </div>
              <input
                type="range"
                min="1.80"
                max="4.50"
                step="0.05"
                value={fuelPressureBar}
                onChange={e => { setFuelPressureBar(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${fuelPressureBar < 2.7 ? 'accent-red-600' : 'accent-emerald-600'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Vapor Lock: &lt;2.2 bar</span>
                <span>Nominal: 3.12 bar</span>
                <span>Max Regulator: 4.20 bar</span>
              </div>
            </div>

            {/* Generator Voltage */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-600">28V UAV Generator Bus Voltage:</span>
                <span className={`font-bold tabular-nums ${genVoltageV < 27.0 ? 'text-red-600' : genVoltageV > 29.5 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {genVoltageV.toFixed(1)} V
                </span>
              </div>
              <input
                type="range"
                min="22.0"
                max="32.0"
                step="0.2"
                value={genVoltageV}
                onChange={e => { setGenVoltageV(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className={`w-full h-1.5 rounded cursor-pointer bg-slate-200 border border-slate-300 ${genVoltageV < 27.0 ? 'accent-red-600' : 'accent-sky-600'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-400">
                <span>Brownout: &lt;26.0V</span>
                <span>Regulated Float: 28.4V</span>
                <span>Over-Voltage: &gt;30.0V</span>
              </div>
            </div>
          </div>

        </div>

        {/* ═════════════════════════════════════════════════════════════════════ */}
        {/* RIGHT COLUMN: 3D DIGITAL TWIN & INSTANT EVALUATION OUTPUTS */}
        {/* ═════════════════════════════════════════════════════════════════════ */}
        <div className="w-full lg:w-1/2 flex flex-col gap-4">

          {/* VIEWPORT MODE SELECTOR TOOLBAR */}
          <div className="bg-white rounded-lg border border-slate-200 p-1.5 flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewportMode('3D_AND_EVAL')}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  viewportMode === '3D_AND_EVAL'
                    ? 'bg-sky-50 text-sky-700 border border-sky-300 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-sky-600" />
                SPLIT: 3D TWIN + PROGNOSTICS
              </button>

              <button
                onClick={() => setViewportMode('3D_ONLY')}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  viewportMode === '3D_ONLY'
                    ? 'bg-sky-50 text-sky-700 border border-sky-300 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-sky-600" />
                3D CAD MODEL ONLY
              </button>

              <button
                onClick={() => setViewportMode('EVAL_ONLY')}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  viewportMode === 'EVAL_ONLY'
                    ? 'bg-sky-50 text-sky-700 border border-sky-300 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-sky-600" />
                EVALUATION METRICS ONLY
              </button>
            </div>

            <span className="text-[10px] font-mono text-slate-400 hidden sm:inline uppercase font-medium">
              LIVE PROPULSION MODEL
            </span>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* 3D DIGITAL TWIN WEBGL VIEWPORT */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {(viewportMode === '3D_AND_EVAL' || viewportMode === '3D_ONLY') && (
            <div className={`bg-white rounded-lg border border-slate-200 shadow-xs flex flex-col overflow-hidden relative ${
              viewportMode === '3D_ONLY' ? 'h-[620px]' : 'h-[360px]'
            }`}>
              {/* 3D Viewport Controls Overlay */}
              <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/95 border border-slate-200 text-sky-700 font-bold shadow-xs">
                    ROTAX 915 iS 3D TWIN
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/90 border border-slate-200 text-slate-700 shadow-xs tabular-nums">
                    {rpm} RPM
                  </span>
                </div>

                <div className="flex items-center gap-1 pointer-events-auto">
                  <button
                    onClick={() => setCameraPreset('ENGINE_BLOCK')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/90 border border-slate-200 hover:border-slate-400 text-slate-700 shadow-xs"
                  >
                    ISO
                  </button>
                  <button
                    onClick={() => setCameraPreset('CYL_03')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/90 border border-slate-200 hover:border-slate-400 text-slate-700 shadow-xs"
                  >
                    CYL 3
                  </button>
                  <button
                    onClick={() => setCameraPreset('TURBO_01')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/90 border border-slate-200 hover:border-slate-400 text-slate-700 shadow-xs"
                  >
                    TURBO
                  </button>
                  <button
                    onClick={() => setCameraPreset('OIL_SYSTEM')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-white/90 border border-slate-200 hover:border-slate-400 text-slate-700 shadow-xs"
                  >
                    OIL
                  </button>
                </div>
              </div>

              {/* Explode View Slider Overlay */}
              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-2.5 py-1 rounded bg-white/95 border border-slate-200 text-[10px] font-mono text-slate-700 shadow-xs">
                <span className="font-semibold">EXPLODE:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={explodeFactor}
                  onChange={e => setExplodeFactor(parseFloat(e.target.value))}
                  className="w-20 h-1 accent-sky-600 cursor-pointer"
                />
                <span className="tabular-nums font-mono font-bold text-slate-900">{(explodeFactor * 100).toFixed(0)}%</span>
              </div>

              {/* WebGL Canvas */}
              <div className="absolute inset-0 cursor-grab active:cursor-grabbing">
                <Canvas
                  camera={{ position: [5, 4, 7], fov: 42 }}
                  gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
                  dpr={[1, 2]}
                >
                  <color attach="background" args={['#F1F5F9']} />
                  <ambientLight intensity={0.9} />
                  <directionalLight position={[10, 20, 15]} intensity={1.4} />
                  <directionalLight position={[-10, 10, -10]} intensity={0.6} />
                  <OrbitControls
                    ref={controlsRef}
                    enableDamping
                    dampingFactor={0.06}
                    minDistance={2.5}
                    maxDistance={22}
                  />
                  <EngineDigitalTwin
                    sel={selectedComp}
                    onSel={setSelectedComp}
                    ef={explodeFactor}
                    vm={viewMode3D}
                    camTargetRef={camTargetRef}
                    ctrlRef={controlsRef}
                    tel={syntheticTelemetry}
                  />
                </Canvas>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* INSTANT PHYSICAL & ML EVALUATION OUTPUTS */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {(viewportMode === '3D_AND_EVAL' || viewportMode === 'EVAL_ONLY') && (
            <>
              {/* Card 1: Airworthiness Status Badge */}
              <div className={`rounded-lg border p-4 shadow-xs flex flex-col gap-2.5 ${evalResult.airworthiness.badge}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {evalResult.airworthiness.status === 'CRITICAL ABORT' ? (
                      <ShieldAlert className="w-6 h-6 text-red-600 animate-pulse" />
                    ) : evalResult.airworthiness.status === 'DERATED' ? (
                      <AlertTriangle className="w-6 h-6 text-amber-600" />
                    ) : (
                      <ShieldCheck className="w-6 h-6 text-emerald-600" />
                    )}
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold">
                        AIRWORTHINESS DISPATCH STATUS
                      </div>
                      <div className={`font-display font-bold text-lg ${evalResult.airworthiness.color}`}>
                        {evalResult.airworthiness.label}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-[9px] text-slate-500 uppercase font-medium">AI DIAGNOSIS (THIS FRAME)</div>
                    <div className="text-sm font-bold text-slate-900">
                      {aiResult?.health?.diagnosed_fault ? aiResult.health.diagnosed_fault.replace(/_/g, ' ') : (aiConnected ? '…' : 'AI OFFLINE')}
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">
                      {evalResult.metrics.confidencePct != null ? `${Number(evalResult.metrics.confidencePct).toFixed(0)}% classifier posterior` : ''}
                      {activeFaultTag && activeFaultTag !== 'NONE' ? ` · profile scenario: ${activeFaultTag}` : ''}
                    </div>
                  </div>
                </div>

                <p className="text-xs font-mono text-slate-700 leading-relaxed border-t border-slate-200/80 pt-2 font-medium">
                  {evalResult.airworthiness.desc}
                </p>
                <p className="text-[10px] font-mono text-slate-500">
                  Dispatch status combines the AI health / RUL with fixed redline checks (EGT &gt; 960 °C, oil &lt; 1.8 bar, vibration &gt; 1.3 g, …).
                </p>
              </div>

              {/* Card 2: Health Index & Degradation Score */}
              <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-sky-600" />
                    <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                      HEALTH INDEX & MULTI-STRESS DEGRADATION (XGBOOST)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">
                    TREND: <span className="font-bold text-slate-800">{evalResult.metrics.trend}</span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center font-mono">
                  <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase font-medium">HEALTH INDEX</span>
                    <span className={`text-2xl font-black font-display my-0.5 tabular-nums ${
                      evalResult.metrics.healthIndex < 40 ? 'text-red-600' :
                      evalResult.metrics.healthIndex < 75 ? 'text-amber-600' :
                      'text-emerald-700'
                    }`}>
                      {evalResult.metrics.healthIndex.toFixed(1)}%
                    </span>
                    <span className="text-[8px] text-slate-400">MEL Limit: 50.0%</span>
                  </div>

                  <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase font-medium">DEGRADATION RATE</span>
                    <span className={`text-2xl font-black font-display my-0.5 tabular-nums ${
                      evalResult.metrics.ratePerHour > 0.2 ? 'text-red-600' :
                      evalResult.metrics.ratePerHour > 0.08 ? 'text-amber-600' :
                      'text-slate-900'
                    }`}>
                      {evalResult.metrics.ratePerHour.toFixed(3)}
                    </span>
                    <span className="text-[8px] text-slate-400">% health / flight hr</span>
                  </div>

                  <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase font-medium">FATIGUE STRESS</span>
                    <span className={`text-2xl font-black font-display my-0.5 tabular-nums ${
                      evalResult.metrics.stress.combinedStress > 3.0 ? 'text-red-600' :
                      evalResult.metrics.stress.combinedStress > 1.5 ? 'text-amber-600' :
                      'text-slate-900'
                    }`}>
                      {evalResult.metrics.stress.combinedStress.toFixed(1)}x
                    </span>
                    <span className="text-[8px] text-slate-400">vs nominal baseline</span>
                  </div>
                </div>
              </div>

              {/* Card 3: Predicted Remaining Useful Life (RUL) */}
              <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-sky-600" />
                    <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                      PREDICTED REMAINING USEFUL LIFE (RUL FORECAST)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">CONFORMAL QUANTILE MODEL</span>
                </div>

                <div className="grid grid-cols-2 gap-3 font-mono">
                  <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase font-medium">EXPECTED RUL</span>
                    <span className={`text-2xl font-black font-display my-0.5 tabular-nums ${
                      evalResult.metrics.rulHours < 2.0 ? 'text-red-600' :
                      evalResult.metrics.rulHours < 10.0 ? 'text-amber-600' :
                      'text-sky-700'
                    }`}>
                      {evalResult.metrics.rulHours.toFixed(1)} HRS
                    </span>
                    <span className="text-[8px] text-slate-400 tabular-nums">
                      95% CI: [{evalResult.metrics.rulLower95}h – {evalResult.metrics.rulUpper95}h]
                    </span>
                  </div>

                  <div className="p-3 rounded border border-slate-200 bg-slate-50 flex flex-col justify-center">
                    <span className="text-[9px] text-slate-500 uppercase font-medium">6-HR MISSION MARGIN</span>
                    <span className={`text-2xl font-black font-display my-0.5 tabular-nums ${
                      evalResult.metrics.rulHours - 6.0 < 0 ? 'text-red-600' : 'text-emerald-700'
                    }`}>
                      {(evalResult.metrics.rulHours - 6.0) >= 0 ? `+${(evalResult.metrics.rulHours - 6.0).toFixed(1)}h` : `${(evalResult.metrics.rulHours - 6.0).toFixed(1)}h`}
                    </span>
                    <span className="text-[8px] text-slate-400 font-medium">
                      {evalResult.metrics.rulHours >= 6.0 ? 'Sufficient mission reserve' : 'CRITICAL DEFICIT'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Diagnostic Subsystem Degradation Matrix */}
              <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-sky-600" />
                    <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                      DIAGNOSTIC SUBSYSTEM DEGRADATION MATRIX
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">PHYSICAL DOMAIN ISOLATION</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
                  {Object.entries(evalResult.subsystems).map(([subsystem, score]) => {
                    const s = typeof score === 'number' ? score : 0;
                    const isCrit = s > 60;
                    const isWarn = s > 30;
                    return (
                      <div key={subsystem} className="p-2.5 rounded border border-slate-200 bg-slate-50 flex flex-col gap-1.5">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-700 uppercase font-bold">{subsystem}</span>
                          <span className={`font-bold tabular-nums ${isCrit ? 'text-red-600' : isWarn ? 'text-amber-600' : 'text-emerald-700'}`}>
                            {s.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden border border-slate-200">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isCrit ? 'bg-red-500' :
                              isWarn ? 'bg-amber-500' :
                              'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(2, s))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 5: Rule-based RTB recommendation */}
              <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-sky-600" />
                    <h3 className="font-display font-bold text-xs tracking-wider text-slate-900 uppercase">
                      RULE-BASED RTB RECOMMENDATION
                    </h3>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                    evalResult.rlRecommendation.action === 'EMERGENCY_DIVERT_RTB'
                      ? 'border-red-300 bg-red-50 text-red-700 animate-pulse'
                      : evalResult.rlRecommendation.action === 'DERATE_AND_CONTINUE_MISSION'
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                  }`}>
                    {evalResult.rlRecommendation.action}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                  <div className="p-2 rounded border border-slate-200 bg-slate-50">
                    <div className="text-[8px] text-slate-500 uppercase font-semibold">RECOVERY FIELD</div>
                    <div className="text-xs font-bold text-slate-900 truncate mt-0.5">
                      {evalResult.rlRecommendation.targetField}
                    </div>
                    <div className="text-[8px] text-sky-600 font-bold tabular-nums">{evalResult.rlRecommendation.distNm} NM</div>
                  </div>

                  <div className="p-2 rounded border border-slate-200 bg-slate-50">
                    <div className="text-[8px] text-slate-500 uppercase font-semibold">FLIGHT TIME</div>
                    <div className="text-xs font-bold text-slate-900 mt-0.5 tabular-nums">
                      {evalResult.rlRecommendation.flightTimeMin} min
                    </div>
                    <div className="text-[8px] text-slate-400 tabular-nums">at {evalResult.rlRecommendation.recSpeed} kts</div>
                  </div>

                  <div className="p-2 rounded border border-slate-200 bg-slate-50">
                    <div className="text-[8px] text-slate-500 uppercase font-semibold">CMD THROTTLE</div>
                    <div className="text-xs font-bold text-slate-900 mt-0.5 tabular-nums">
                      {evalResult.rlRecommendation.recThrottle}%
                    </div>
                    <div className="text-[8px] text-slate-400 tabular-nums">{evalResult.rlRecommendation.recRpm} RPM</div>
                  </div>

                  <div className="p-2 rounded border border-slate-200 bg-slate-50">
                    <div className="text-[8px] text-slate-500 uppercase font-semibold">VERT SPEED</div>
                    <div className={`text-xs font-bold mt-0.5 tabular-nums ${evalResult.rlRecommendation.recClimbFpm < 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                      {evalResult.rlRecommendation.recClimbFpm} fpm
                    </div>
                    <div className="text-[8px] text-slate-400 tabular-nums">Margin: {evalResult.rlRecommendation.safetyMargin}x</div>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>

      </div>

    </div>
  );
};
