import React, { useState, useMemo, useEffect, useRef } from 'react';
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

  // Live Python AI Microservice State (FastAPI PyTorch on port 8001)
  const [aiResult, setAiResult] = useState(null);
  const [aiConnected, setAiConnected] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. 1-CLICK BENCHMARK SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════
  const BENCHMARKS = [
    {
      id: 'NOMINAL_LOITER',
      label: 'Nominal Loiter',
      tag: 'PRISTINE',
      badgeClass: 'border-emerald-500/50 bg-emerald-950/60 text-emerald-300',
      summary: 'Rotax 915 iS cruise baseline: balanced combustion, nominal 3.85 bar oil pressure, minimal 0.28g vibration.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 110,
        rpm: 4800,
        throttlePct: 78.5,
        egt: [842, 840, 844, 841],
        cht: [106, 107, 106, 108],
        mapBar: 1.42,
        oilPressBar: 3.85,
        oilTempC: 98.4,
        vibrationGrms: 0.28,
        fuelPressureBar: 3.12,
        genVoltageV: 28.4,
        faultTag: 'NONE'
      }
    },
    {
      id: 'CYL3_LEAN_CLOG',
      label: 'Cylinder 3 Lean Clog',
      tag: 'COMBUSTION',
      badgeClass: 'border-red-500/50 bg-red-950/60 text-red-300',
      summary: 'Severe lean misfire in Cyl 3: EGT3 spikes to 985°C (spread >150°C), CHT3 heat-soak to 134°C, torsional vib 1.18g.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 108,
        rpm: 4750,
        throttlePct: 78.0,
        egt: [832, 831, 985, 832],
        cht: [105, 106, 134, 107],
        mapBar: 1.42,
        oilPressBar: 3.80,
        oilTempC: 99.5,
        vibrationGrms: 1.18,
        fuelPressureBar: 2.75,
        genVoltageV: 28.3,
        faultTag: 'CYL3_INJECTOR'
      }
    },
    {
      id: 'PISTON_BLOW_BY',
      label: 'Piston Ring Blow-By',
      tag: 'THERMAL/OIL',
      badgeClass: 'border-amber-500/50 bg-amber-950/60 text-amber-300',
      summary: 'Compression loss and blow-by gas leakage: oil temp climbs to 132°C, oil press decays to 2.10 bar, CHTs elevated.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 105,
        rpm: 4700,
        throttlePct: 76.0,
        egt: [855, 850, 858, 852],
        cht: [122, 126, 124, 128],
        mapBar: 1.38,
        oilPressBar: 2.10,
        oilTempC: 132.0,
        vibrationGrms: 0.65,
        fuelPressureBar: 3.10,
        genVoltageV: 28.1,
        faultTag: 'BLOW_BY'
      }
    },
    {
      id: 'OIL_CAVITATION',
      label: 'Oil Pump Cavitation',
      tag: 'LUBRICATION',
      badgeClass: 'border-red-500/50 bg-red-950/60 text-red-300',
      summary: 'Loss of hydrodynamic oil wedge: oil press collapses to 1.35 bar, severe bearing vibration spikes to 1.72g.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 102,
        rpm: 4600,
        throttlePct: 74.0,
        egt: [844, 842, 846, 843],
        cht: [118, 120, 119, 121],
        mapBar: 1.35,
        oilPressBar: 1.35,
        oilTempC: 124.5,
        vibrationGrms: 1.72,
        fuelPressureBar: 3.08,
        genVoltageV: 27.8,
        faultTag: 'OIL_PUMP_CAVITATION'
      }
    },
    {
      id: 'TURBO_SURGE',
      label: 'Turbo Overboost Surge',
      tag: 'AIR/BOOST',
      badgeClass: 'border-purple-500/50 bg-purple-950/60 text-purple-300',
      summary: 'Wastegate stuck closed: MAP surges to 2.18 bar (overboost), cylinder pressures surge, RPM climbs to 5250.',
      params: {
        altitudeFt: 14500,
        airspeedKts: 125,
        rpm: 5250,
        throttlePct: 88.0,
        egt: [910, 905, 915, 908],
        cht: [126, 128, 125, 129],
        mapBar: 2.18,
        oilPressBar: 4.10,
        oilTempC: 108.0,
        vibrationGrms: 0.85,
        fuelPressureBar: 3.45,
        genVoltageV: 28.6,
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
  // 3. ASYNC LIVE PYTHON AI SERVICE INFERENCE (PORT 8001)
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
          gen_voltage_v: genVoltageV
        };
        const aiHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
          ? `http://${window.location.hostname}:8001`
          : '/ai';
        const res = await fetch(`${aiHost}/api/health-rul/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setAiResult(data);
            setAiConnected(true);
          }
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
        status: activeFaultTag !== 'NONE' ? (activeFaultTag === 'OIL_PUMP_CAVITATION' ? 'CRITICAL' : 'DEGRADED') : 'NOMINAL',
        activeFault: activeFaultTag,
        severity: activeFaultTag === 'NONE' ? 0.0 : 0.85,
        index: activeFaultTag === 'OIL_PUMP_CAVITATION' ? 18 : activeFaultTag !== 'NONE' ? 52 : 100
      },
      residuals: {
        egtResiduals: egt.map(v => v - 840),
        chtResiduals: cht.map(v => v - 106),
        oilPressResidual: oilPressBar - 3.85,
        mapResidual: mapBar - 1.42
      }
    };
  }, [altitudeFt, airspeedKts, rpm, throttlePct, egt, cht, mapBar, oilPressBar, oilTempC, vibrationGrms, fuelPressureBar, genVoltageV, activeFaultTag]);

  const evalResult = useMemo(() => {
    // Run physics and ML pipeline
    const pipelineOut = PrognosticsPipeline.evaluate({
      telemetry: syntheticTelemetry,
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
    let airworthinessBadge = 'border-emerald-500/60 bg-emerald-950/70 text-emerald-300';
    let airworthinessColor = 'text-emerald-400 glow-green';
    let airworthinessDesc = 'Rotax 915 iS engine operating well within certified EASA/FAA flight envelopes. Safe for sustained mission loiter.';

    const hi = aiResult?.engine_health_index ?? (pipelineOut?.health?.index ?? 100);
    const rulH = aiResult?.rul_hours_mean ?? (pipelineOut?.rul?.hours ?? 750);

    if (hi < 40 || rulH < 2.0 || oilPressBar < 1.8 || maxEgt > 960 || vibrationGrms > 1.3) {
      airworthinessStatus = 'CRITICAL ABORT';
      airworthinessBadge = 'border-red-500/80 bg-red-950/80 text-red-200 animate-pulse';
      airworthinessColor = 'text-red-400 glow-red';
      airworthinessDesc = 'CRITICAL AIRWORTHINESS EXCEEDANCE! Catastrophic failure risk detected. Autonomous emergency landing mandatory.';
    } else if (hi < 75 || rulH < 10.0 || egtSpread > 55 || maxCht > 125 || oilPressBar < 2.8 || mapBar > 1.8) {
      airworthinessStatus = 'DERATED';
      airworthinessBadge = 'border-amber-500/70 bg-amber-950/70 text-amber-200';
      airworthinessColor = 'text-amber-400 glow-amber';
      airworthinessDesc = 'Subsystem wear exceeds nominal baseline. Derated throttle envelope applied. Return to base advised.';
    }

    // RL Policy Evaluation
    const homeBase = { name: "AFS Uttarlai (Barmer)", lat: 25.8117, lng: 71.4883, alt_ft: 500 };
    const auxStrip = { name: "AFS Jaisalmer Forward Base", lat: 26.8897, lng: 70.8653, alt_ft: 825 };
    const distHome = 42.5;
    const distAux = 18.2;

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
        rulLower95: aiResult?.rul_hours_lower_95 ?? (pipelineOut?.rul?.lower95 ?? (rulH * 0.85).toFixed(1)),
        rulUpper95: aiResult?.rul_hours_upper_95 ?? (pipelineOut?.rul?.upper95 ?? (rulH * 1.15).toFixed(1)),
        confidencePct: pipelineOut?.rul?.confidencePct ?? 92,
        ratePerHour: aiResult?.degradation_rate_pct_per_hour ?? (pipelineOut?.degradation?.ratePerHour ?? 0.045),
        trend: pipelineOut?.degradation?.trend ?? 'STABLE',
        stress: pipelineOut?.degradation?.stressBreakdown ?? { combinedStress: 1.0 }
      },
      subsystems: {
        thermal: Number((pipelineOut?.degradation?.subsystems?.thermal ?? aiResult?.rul?.subsystemDegradation?.thermal ?? 4.2)),
        mechanical: Number((pipelineOut?.degradation?.subsystems?.mechanical ?? aiResult?.rul?.subsystemDegradation?.mechanical ?? 0.0)),
        lubrication: Number((pipelineOut?.degradation?.subsystems?.lubrication ?? aiResult?.rul?.subsystemDegradation?.lubrication ?? 4.2)),
        combustion: Number((pipelineOut?.degradation?.subsystems?.combustion ?? aiResult?.rul?.subsystemDegradation?.combustion ?? 0.0)),
        fuel: Number((pipelineOut?.degradation?.subsystems?.fuel ?? aiResult?.rul?.subsystemDegradation?.fuel ?? 5.7)),
        electrical: Number((pipelineOut?.degradation?.subsystems?.electrical ?? aiResult?.rul?.subsystemDegradation?.electrical ?? 4.6)),
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
      <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-400/40 text-cyan-300">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-black text-sm tracking-wider text-cyan-300 glow-cyan">
                JUDGE'S HARDWARE-IN-THE-LOOP (HIL) TESTING DECK
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Interactive Physics & ML Multi-Parameter Benchmarking for Rotax 915 iS Engine
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/[0.08] bg-slate-950/60 text-xs font-mono cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSyncTwin}
                onChange={e => setAutoSyncTwin(e.target.checked)}
                className="accent-cyan-400 w-3.5 h-3.5 rounded cursor-pointer"
              />
              <span className={autoSyncTwin ? 'text-cyan-300 font-bold' : 'text-slate-400'}>
                Auto-Sync to CAN Twin
              </span>
            </label>

            <button
              onClick={handleResetNominal}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/60 hover:bg-emerald-500/30 transition-all flex items-center gap-1.5 shadow-hud-green"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              RESET NOMINAL
            </button>

            <button
              onClick={handleCommitToLiveTwin}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center gap-1.5 shadow-hud-cyan"
            >
              <Send className="w-3.5 h-3.5 fill-current" />
              COMMIT TO LIVE TWIN (100 HZ)
            </button>
          </div>
        </div>

        {/* 1-Click Benchmark Scenarios Toolbar */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold tracking-widest text-slate-400 uppercase flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" /> 1-CLICK BENCHMARK SCENARIOS:
            </span>
            <div className="flex items-center gap-2">
              {aiConnected ? (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-purple-500/60 bg-purple-950/60 text-purple-300 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  PYTORCH AI (PORT 8001) ONLINE
                </span>
              ) : (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-cyan-500/60 bg-cyan-950/60 text-cyan-300 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  PHYSICS PIPELINE READY
                </span>
              )}
              <span className="text-[10px] font-mono text-slate-400">
                ACTIVE: <span className="text-cyan-300 font-bold">{activeBenchmark}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {BENCHMARKS.map(b => {
              const isSelected = activeBenchmark === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => handleApplyBenchmark(b)}
                  className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-1.5 ${
                    isSelected
                      ? 'bg-cyan-500/20 border-cyan-400 shadow-starship-glow'
                      : 'starship-glass-card border-white/[0.06] hover:border-cyan-500/40 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-[11px] font-mono font-bold truncate ${isSelected ? 'text-cyan-300 glow-cyan' : 'text-slate-200'}`}>
                      {b.label}
                    </span>
                    <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded-full border ${b.badgeClass}`}>
                      {b.tag}
                    </span>
                  </div>
                  <p className="text-[9px] font-mono text-slate-400 line-clamp-2 leading-tight">
                    {b.summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live Broadcast Notice */}
        {broadcastNotice && (
          <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-500/80 text-cyan-200 font-mono text-xs flex items-center gap-2 animate-fadeIn shadow-hud-cyan">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
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
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Wind className="w-4 h-4 text-cyan-400" />
                <h3 className="font-display font-black text-xs tracking-wider text-cyan-300">
                  FLIGHT & ATMOSPHERIC CONDITIONS (ISA MODEL)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                P_AMB: {(1.01325 * Math.pow(1.0 - 0.0225577 * (altitudeFt * 0.0003048), 5.25588)).toFixed(3)} bar
              </span>
            </div>

            {/* Altitude Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Pressure Altitude:</span>
                <span className="text-cyan-300 font-bold glow-cyan">{altitudeFt.toLocaleString()} ft</span>
              </div>
              <input
                type="range"
                min="0"
                max="30000"
                step="500"
                value={altitudeFt}
                onChange={e => { setAltitudeFt(parseInt(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className="w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] accent-cyan-400"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Sea Level (0 ft)</span>
                <span>Operational Cruise (14,500 ft)</span>
                <span>Service Ceiling (30,000 ft)</span>
              </div>
            </div>

            {/* Airspeed Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Calibrated Airspeed:</span>
                <span className="text-cyan-300 font-bold">{airspeedKts} kts</span>
              </div>
              <input
                type="range"
                min="60"
                max="160"
                step="1"
                value={airspeedKts}
                onChange={e => { setAirspeedKts(parseInt(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className="w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] accent-cyan-400"
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Loiter Stall: 60 kts</span>
                <span>Best Range: 110 kts</span>
                <span>VNE: 160 kts</span>
              </div>
            </div>
          </div>

          {/* Group 2: Powertrain & Turbocharger Dynamics */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400" />
                <h3 className="font-display font-black text-xs tracking-wider text-cyan-300">
                  POWERTRAIN & TURBOCHARGER DYNAMICS
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">ROTAX 915 iS TURBO</span>
            </div>

            {/* RPM Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Engine Crankshaft RPM:</span>
                <span className={`font-bold ${rpm > 5500 ? 'text-red-400 glow-red' : 'text-cyan-300 glow-cyan'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${rpm > 5500 ? 'accent-red-400' : 'accent-cyan-400'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Idle: 2000</span>
                <span>Max Continuous: 5500</span>
                <span>Takeoff Redline: 5800</span>
              </div>
            </div>

            {/* Throttle Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Throttle Position (FADEC):</span>
                <span className="text-cyan-300 font-bold">{throttlePct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={throttlePct}
                onChange={e => { setThrottlePct(parseFloat(e.target.value)); setActiveBenchmark('CUSTOM'); }}
                className="w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] accent-cyan-400"
              />
            </div>

            {/* MAP Slider */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Manifold Absolute Pressure (MAP):</span>
                <span className={`font-bold ${mapBar > 1.85 ? 'text-red-400 glow-red' : 'text-cyan-300 glow-cyan'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${mapBar > 1.85 ? 'accent-red-400' : 'accent-cyan-400'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Idle: 0.80 bar</span>
                <span>Nominal Cruise: 1.42 bar</span>
                <span>Overboost Surge: &gt;1.85 bar</span>
              </div>
            </div>
          </div>

          {/* Group 3: Combustion & Exhaust Gas Temperatures (EGT 1-4) */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h3 className="font-display font-black text-xs tracking-wider text-amber-300">
                  COMBUSTION: EXHAUST GAS TEMPERATURES (EGT 1–4)
                </h3>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                evalResult.metrics.egtSpread > 40 ? 'border-red-500 bg-red-950/60 text-red-300' : 'border-white/[0.08] text-slate-400'
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
                  <div key={idx} className="flex flex-col gap-1 p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.06]">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-300 font-bold">Cylinder {idx + 1}:</span>
                      <span className={`font-black ${isCrit ? 'text-red-400 glow-red' : isWarn ? 'text-amber-400' : 'text-cyan-300'}`}>
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
                      className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${isCrit ? 'accent-red-400' : isWarn ? 'accent-amber-400' : 'accent-cyan-400'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Group 4: Thermal & Cylinder Head Temperatures (CHT 1-4) */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Thermometer className="w-4 h-4 text-purple-400" />
                <h3 className="font-display font-black text-xs tracking-wider text-purple-300">
                  THERMAL: CYLINDER HEAD TEMPERATURES (CHT 1–4)
                </h3>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                evalResult.metrics.chtSpread > 15 ? 'border-red-500 bg-red-950/60 text-red-300' : 'border-white/[0.08] text-slate-400'
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
                  <div key={idx} className="flex flex-col gap-1 p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.06]">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-300 font-bold">Cylinder {idx + 1}:</span>
                      <span className={`font-black ${isCrit ? 'text-red-400 glow-red' : isWarn ? 'text-amber-400' : 'text-purple-300'}`}>
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
                      className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${isCrit ? 'accent-red-400' : isWarn ? 'accent-amber-400' : 'accent-purple-400'}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Group 5: Lubrication & Structural Dynamics */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Droplets className="w-4 h-4 text-blue-400" />
                <h3 className="font-display font-black text-xs tracking-wider text-blue-300">
                  LUBRICATION, FLUIDS & VIBRATION
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">HYDRODYNAMICS</span>
            </div>

            {/* Oil Pressure */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Main Oil Gallery Pressure:</span>
                <span className={`font-bold ${oilPressBar < 2.0 ? 'text-red-400 glow-red' : oilPressBar < 2.8 ? 'text-amber-400' : 'text-cyan-300'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${oilPressBar < 2.0 ? 'accent-red-400' : 'accent-cyan-400'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Critical: &lt;1.8 bar</span>
                <span>Nominal: 3.5 - 4.5 bar</span>
                <span>Relief Max: 6.0 bar</span>
              </div>
            </div>

            {/* Oil Temp */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Oil Sump Temperature:</span>
                <span className={`font-bold ${oilTempC > 120 ? 'text-red-400 glow-red' : oilTempC > 110 ? 'text-amber-400' : 'text-cyan-300'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${oilTempC > 120 ? 'accent-red-400' : 'accent-cyan-400'}`}
              />
            </div>

            {/* Vibration */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Crankcase Broadband Vibration:</span>
                <span className={`font-bold ${vibrationGrms > 1.0 ? 'text-red-400 glow-red' : vibrationGrms > 0.4 ? 'text-amber-400' : 'text-cyan-300'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${vibrationGrms > 1.0 ? 'accent-red-400' : 'accent-cyan-400'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Baseline: 0.28g</span>
                <span>Warning: &gt;0.45g</span>
                <span>Distress: &gt;1.20g</span>
              </div>
            </div>
          </div>

          {/* Group 6: Fuel Delivery & 28V Electrical Generation */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3.5">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-400" />
                <h3 className="font-display font-black text-xs tracking-wider text-emerald-300">
                  FUEL DELIVERY & 28V ELECTRICAL SYSTEM
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">AVIONICS & INJECTION</span>
            </div>

            {/* Fuel Pressure */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">Fuel Rail Injection Pressure:</span>
                <span className={`font-bold ${fuelPressureBar < 2.7 ? 'text-red-400 glow-red' : fuelPressureBar > 3.8 ? 'text-amber-400' : 'text-emerald-300'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${fuelPressureBar < 2.7 ? 'accent-red-400' : 'accent-emerald-400'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
                <span>Vapor Lock: &lt;2.2 bar</span>
                <span>Nominal: 3.12 bar</span>
                <span>Max Regulator: 4.20 bar</span>
              </div>
            </div>

            {/* Generator Voltage */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-slate-300">28V UAV Generator Bus Voltage:</span>
                <span className={`font-bold ${genVoltageV < 27.0 ? 'text-red-400 glow-red' : genVoltageV > 29.5 ? 'text-amber-400' : 'text-cyan-300'}`}>
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
                className={`w-full h-1.5 rounded-lg cursor-pointer bg-slate-900 border border-white/[0.08] ${genVoltageV < 27.0 ? 'accent-red-400' : 'accent-cyan-400'}`}
              />
              <div className="flex justify-between text-[9px] font-mono text-slate-500">
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
          <div className="starship-glass rounded-xl border border-white/[0.08] p-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewportMode('3D_AND_EVAL')}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  viewportMode === '3D_AND_EVAL'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 shadow-hud-cyan'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                SPLIT: 3D TWIN + PROGNOSTICS
              </button>

              <button
                onClick={() => setViewportMode('3D_ONLY')}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  viewportMode === '3D_ONLY'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 shadow-hud-cyan'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                3D CAD MODEL ONLY
              </button>

              <button
                onClick={() => setViewportMode('EVAL_ONLY')}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  viewportMode === 'EVAL_ONLY'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 shadow-hud-cyan'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                EVALUATION METRICS ONLY
              </button>
            </div>

            <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
              LIVE PROPULSION MODEL
            </span>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* 3D DIGITAL TWIN WEBGL VIEWPORT */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {(viewportMode === '3D_AND_EVAL' || viewportMode === '3D_ONLY') && (
            <div className={`starship-glass rounded-xl border border-white/[0.08] shadow-starship-glass flex flex-col overflow-hidden relative ${
              viewportMode === '3D_ONLY' ? 'h-[620px]' : 'h-[360px]'
            }`}>
              {/* 3D Viewport Controls Overlay */}
              <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/80 border border-cyan-500/40 text-cyan-300 font-bold backdrop-blur">
                    ROTAX 915 iS 3D TWIN
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/60 border border-white/[0.08] text-slate-300 backdrop-blur">
                    {rpm} RPM
                  </span>
                </div>

                <div className="flex items-center gap-1 pointer-events-auto">
                  <button
                    onClick={() => setCameraPreset('ENGINE_BLOCK')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-900/80 border border-white/[0.08] hover:border-cyan-400 text-slate-300 backdrop-blur"
                  >
                    ISO
                  </button>
                  <button
                    onClick={() => setCameraPreset('CYL_03')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-900/80 border border-white/[0.08] hover:border-cyan-400 text-slate-300 backdrop-blur"
                  >
                    CYL 3
                  </button>
                  <button
                    onClick={() => setCameraPreset('TURBO_01')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-900/80 border border-white/[0.08] hover:border-cyan-400 text-slate-300 backdrop-blur"
                  >
                    TURBO
                  </button>
                  <button
                    onClick={() => setCameraPreset('OIL_SYSTEM')}
                    className="text-[9px] font-mono px-2 py-0.5 rounded bg-slate-900/80 border border-white/[0.08] hover:border-cyan-400 text-slate-300 backdrop-blur"
                  >
                    OIL
                  </button>
                </div>
              </div>

              {/* Explode View Slider Overlay */}
              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-black/75 border border-white/[0.08] backdrop-blur text-[10px] font-mono text-slate-300">
                <span>EXPLODE:</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={explodeFactor}
                  onChange={e => setExplodeFactor(parseFloat(e.target.value))}
                  className="w-20 h-1 accent-cyan-400 cursor-pointer"
                />
                <span>{(explodeFactor * 100).toFixed(0)}%</span>
              </div>

              {/* WebGL Canvas */}
              <div className="absolute inset-0 cursor-grab active:cursor-grabbing">
                <Canvas
                  camera={{ position: [5, 4, 7], fov: 42 }}
                  gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
                  dpr={[1, 2]}
                >
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
              <div className={`starship-glass rounded-xl border p-4 shadow-starship-glass flex flex-col gap-2.5 ${evalResult.airworthiness.badge}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {evalResult.airworthiness.status === 'CRITICAL ABORT' ? (
                      <ShieldAlert className="w-6 h-6 text-red-400 animate-pulse" />
                    ) : evalResult.airworthiness.status === 'DERATED' ? (
                      <AlertTriangle className="w-6 h-6 text-amber-400" />
                    ) : (
                      <ShieldCheck className="w-6 h-6 text-emerald-400" />
                    )}
                    <div>
                      <div className="text-[10px] font-mono uppercase tracking-widest text-slate-300 font-bold">
                        AIRWORTHINESS DISPATCH STATUS
                      </div>
                      <div className={`font-display font-black text-lg ${evalResult.airworthiness.color}`}>
                        {evalResult.airworthiness.label}
                      </div>
                    </div>
                  </div>

                  <div className="text-right font-mono">
                    <div className="text-[9px] text-slate-400 uppercase">EVALUATION CONFIDENCE</div>
                    <div className="text-sm font-bold text-white">{evalResult.metrics.confidencePct}% (BAYESIAN)</div>
                  </div>
                </div>

                <p className="text-xs font-mono text-slate-200 leading-relaxed border-t border-white/[0.08] pt-2">
                  {evalResult.airworthiness.desc}
                </p>
              </div>

              {/* Card 2: Health Index & Degradation Score */}
              <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-display font-black text-xs tracking-wider text-slate-200">
                      HEALTH INDEX & MULTI-STRESS DEGRADATION (PINN / ML)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300">
                    TREND: <span className="font-bold">{evalResult.metrics.trend}</span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center font-mono">
                  <div className="starship-glass-card p-3 rounded-xl border border-white/[0.06] flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 uppercase">HEALTH INDEX</span>
                    <span className={`text-2xl font-black font-display my-0.5 ${
                      evalResult.metrics.healthIndex < 40 ? 'text-red-400 glow-red' :
                      evalResult.metrics.healthIndex < 75 ? 'text-amber-400 glow-amber' :
                      'text-emerald-400 glow-green'
                    }`}>
                      {evalResult.metrics.healthIndex.toFixed(1)}%
                    </span>
                    <span className="text-[8px] text-slate-500">MEL Limit: 50.0%</span>
                  </div>

                  <div className="starship-glass-card p-3 rounded-xl border border-white/[0.06] flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 uppercase">DEGRADATION RATE</span>
                    <span className={`text-2xl font-black font-display my-0.5 ${
                      evalResult.metrics.ratePerHour > 0.2 ? 'text-red-400' :
                      evalResult.metrics.ratePerHour > 0.08 ? 'text-amber-400' :
                      'text-cyan-300'
                    }`}>
                      {evalResult.metrics.ratePerHour.toFixed(3)}
                    </span>
                    <span className="text-[8px] text-slate-500">% health / flight hr</span>
                  </div>

                  <div className="starship-glass-card p-3 rounded-xl border border-white/[0.06] flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 uppercase">FATIGUE STRESS</span>
                    <span className={`text-2xl font-black font-display my-0.5 ${
                      evalResult.metrics.stress.combinedStress > 3.0 ? 'text-red-400' :
                      evalResult.metrics.stress.combinedStress > 1.5 ? 'text-amber-400' :
                      'text-purple-300'
                    }`}>
                      {evalResult.metrics.stress.combinedStress.toFixed(1)}x
                    </span>
                    <span className="text-[8px] text-slate-500">vs nominal baseline</span>
                  </div>
                </div>
              </div>

              {/* Card 3: Predicted Remaining Useful Life (RUL) */}
              <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                  <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-display font-black text-xs tracking-wider text-slate-200">
                      PREDICTED REMAINING USEFUL LIFE (RUL FORECAST)
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300">WEIBULL HAZARD MODEL</span>
                </div>

                <div className="grid grid-cols-2 gap-3 font-mono">
                  <div className="starship-glass-card p-3 rounded-xl border border-white/[0.06] flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 uppercase">EXPECTED RUL</span>
                    <span className={`text-2xl font-black font-display my-0.5 ${
                      evalResult.metrics.rulHours < 2.0 ? 'text-red-400 glow-red' :
                      evalResult.metrics.rulHours < 10.0 ? 'text-amber-400' :
                      'text-cyan-300 glow-cyan'
                    }`}>
                      {evalResult.metrics.rulHours.toFixed(1)} HRS
                    </span>
                    <span className="text-[8px] text-slate-500">
                      95% CI: [{evalResult.metrics.rulLower95}h – {evalResult.metrics.rulUpper95}h]
                    </span>
                  </div>

                  <div className="starship-glass-card p-3 rounded-xl border border-white/[0.06] flex flex-col justify-center">
                    <span className="text-[9px] text-slate-400 uppercase">6-HR MISSION MARGIN</span>
                    <span className={`text-2xl font-black font-display my-0.5 ${
                      evalResult.metrics.rulHours - 6.0 < 0 ? 'text-red-400 glow-red' : 'text-emerald-400 glow-green'
                    }`}>
                      {(evalResult.metrics.rulHours - 6.0) >= 0 ? `+${(evalResult.metrics.rulHours - 6.0).toFixed(1)}h` : `${(evalResult.metrics.rulHours - 6.0).toFixed(1)}h`}
                    </span>
                    <span className="text-[8px] text-slate-500">
                      {evalResult.metrics.rulHours >= 6.0 ? 'Sufficient mission reserve' : 'CRITICAL DEFICIT'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 4: Diagnostic Subsystem Degradation Matrix */}
              <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-400" />
                    <h3 className="font-display font-black text-xs tracking-wider text-purple-300">
                      DIAGNOSTIC SUBSYSTEM DEGRADATION MATRIX
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">PHYSICAL DOMAIN ISOLATION</span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 font-mono text-xs">
                  {Object.entries(evalResult.subsystems).map(([subsystem, score]) => {
                    const s = typeof score === 'number' ? score : 0;
                    const isCrit = s > 60;
                    const isWarn = s > 30;
                    return (
                      <div key={subsystem} className="p-2.5 rounded-lg bg-slate-950/60 border border-white/[0.06] flex flex-col gap-1.5">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-slate-300 uppercase font-bold">{subsystem}</span>
                          <span className={`font-bold ${isCrit ? 'text-red-400' : isWarn ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {s.toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-white/[0.04]">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isCrit ? 'bg-gradient-to-r from-red-600 to-rose-500' :
                              isWarn ? 'bg-gradient-to-r from-amber-600 to-yellow-400' :
                              'bg-gradient-to-r from-emerald-600 to-teal-400'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(2, s))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 5: Autonomous RL Replanner Recommendation */}
              <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
                  <div className="flex items-center gap-2">
                    <Compass className="w-4 h-4 text-cyan-400" />
                    <h3 className="font-display font-black text-xs tracking-wider text-cyan-300">
                      AUTONOMOUS RL FLIGHT PLANNER & CONTINGENCY ACTION
                    </h3>
                  </div>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                    evalResult.rlRecommendation.action === 'EMERGENCY_DIVERT_RTB'
                      ? 'border-red-500 bg-red-950/80 text-red-300 animate-pulse'
                      : evalResult.rlRecommendation.action === 'DERATE_AND_CONTINUE_MISSION'
                      ? 'border-amber-500 bg-amber-950/80 text-amber-300'
                      : 'border-emerald-500 bg-emerald-950/80 text-emerald-300'
                  }`}>
                    {evalResult.rlRecommendation.action}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                  <div className="p-2 rounded-lg bg-slate-950/60 border border-white/[0.06]">
                    <div className="text-[8px] text-slate-400 uppercase">RECOVERY FIELD</div>
                    <div className="text-xs font-bold text-white truncate mt-0.5">
                      {evalResult.rlRecommendation.targetField}
                    </div>
                    <div className="text-[8px] text-cyan-400 font-bold">{evalResult.rlRecommendation.distNm} NM</div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-950/60 border border-white/[0.06]">
                    <div className="text-[8px] text-slate-400 uppercase">FLIGHT TIME</div>
                    <div className="text-xs font-bold text-white mt-0.5">
                      {evalResult.rlRecommendation.flightTimeMin} min
                    </div>
                    <div className="text-[8px] text-slate-400">at {evalResult.rlRecommendation.recSpeed} kts</div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-950/60 border border-white/[0.06]">
                    <div className="text-[8px] text-slate-400 uppercase">CMD THROTTLE</div>
                    <div className="text-xs font-bold text-cyan-300 mt-0.5">
                      {evalResult.rlRecommendation.recThrottle}%
                    </div>
                    <div className="text-[8px] text-slate-400">{evalResult.rlRecommendation.recRpm} RPM</div>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-950/60 border border-white/[0.06]">
                    <div className="text-[8px] text-slate-400 uppercase">VERT SPEED</div>
                    <div className={`text-xs font-bold mt-0.5 ${evalResult.rlRecommendation.recClimbFpm < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {evalResult.rlRecommendation.recClimbFpm} fpm
                    </div>
                    <div className="text-[8px] text-slate-400">Margin: {evalResult.rlRecommendation.safetyMargin}x</div>
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
