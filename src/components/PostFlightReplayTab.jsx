import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { TACTICAL_ISR_8PHASE_SORTIE } from '../replay/PreloadedSorties';
import { AtmosphericPhysicsEngine } from '../replay/AtmosphericPhysicsEngine';
import { MissionPredictor } from '../replay/MissionPredictor';
import { 
  Plane, 
  Clock, 
  Play, 
  Pause, 
  AlertTriangle, 
  Info, 
  Sliders, 
  Cloud, 
  Calculator, 
  CheckCircle2, 
  Activity, 
  Flame, 
  Gauge, 
  Wind, 
  Layers, 
  Radio, 
  Sun, 
  Mountain, 
  Waves,
  Disc,
  Snowflake,
  CloudRain,
  Zap,
  Crosshair,
  ChevronDown
} from 'lucide-react';

export const PostFlightReplayTab = () => {
  const { isReplayMode, enterReplayMode, exitReplayMode } = useTelemetry();

  // Active Phase Index (Default to Phase 7: RECOVERY to match user's image exactly!)
  const [activePhaseIndex, setActivePhaseIndex] = useState(7);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 1x, 2x, 5x, 10x, 0.5x
  const [activePreset, setActivePreset] = useState('HIGH_ALT_FL220'); // HIGH_ALT_FL220, HIGH_ALT_FL200, HOT_DESERT, MARITIME, ARCTIC_SOAK, MONSOON, FL230_CEILING, TERRAIN_MASK, ULTRA_LOITER
  const [showMoreScenarios, setShowMoreScenarios] = useState(false);

  // Environmental sliders
  const [altitudeFt, setAltitudeFt] = useState(28000);
  const [deltaIsaTempC, setDeltaIsaTempC] = useState(-28);
  const [payloadStr, setPayloadStr] = useState('85 kg (EO/IR + SAR)');
  const [headwindKts, setHeadwindKts] = useState(38);

  const sortie = TACTICAL_ISR_8PHASE_SORTIE;

  // Dynamic Real-Time Multi-Physics & AI/ML Prediction Engine
  const prediction = useMemo(() => {
    return MissionPredictor.evaluate({
      activePhaseIndex,
      altitudeFt,
      ambientTempC: deltaIsaTempC,
      payloadKg: parseInt(payloadStr) || 85,
      headwindKts,
      scenarioId: activePreset
    });
  }, [activePhaseIndex, altitudeFt, deltaIsaTempC, payloadStr, headwindKts, activePreset]);

  const { aerothermal, computedPhases, activeTelemetry, currentLogNote, trajectory, svgCoordinates } = prediction;
  const currentPhase = computedPhases[activePhaseIndex] || computedPhases[7];

  // Auto playback animation timer
  useEffect(() => {
    let timer;
    if (isPlaying) {
      const intervalMs = Math.max(250, Math.round(2500 / playbackSpeed));
      timer = setInterval(() => {
        setActivePhaseIndex(prev => {
          if (prev >= computedPhases.length - 1) {
            setIsPlaying(false);
            return 7;
          }
          return prev + 1;
        });
      }, intervalMs);
    }
    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, computedPhases.length]);

  // Handle Play/Pause toggle with automatic restart from PRE-FLIGHT if at end
  const handleTogglePlay = () => {
    if (!isPlaying) {
      if (activePhaseIndex >= sortie.phases.length - 1) {
        setActivePhaseIndex(0);
      }
      setIsPlaying(true);
    } else {
      setIsPlaying(false);
    }
  };

  // Speed toggle cycle
  const handleToggleSpeed = () => {
    const speeds = [1, 2, 5, 10, 0.5];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIdx]);
  };

  // Environmental Preset Handlers across all 9 scenarios
  const handleSelectPreset = (presetId) => {
    setActivePreset(presetId);
    const found = AtmosphericPhysicsEngine.SCENARIO_PRESETS.find(
      p => p.id === presetId || p.aliases?.includes(presetId)
    );
    if (found) {
      setAltitudeFt(found.altFt);
      setDeltaIsaTempC(found.tempC);
      setHeadwindKts(found.headwindKts);
      setPayloadStr(found.payload);
    }
  };

  // Handle click on anomaly card to jump to its phase
  const handleJumpToAnomaly = (anomaly) => {
    setActivePhaseIndex(anomaly.phaseId);
  };

  // Interactive scrubbing by clicking directly on the SVG degradation curve
  const handleSvgClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 1000;
    const xPositions = [60, 100, 170, 300, 500, 600, 800, 940];
    let closestPhase = 0;
    let minDiff = Infinity;
    xPositions.forEach((x, idx) => {
      const diff = Math.abs(clickX - x);
      if (diff < minDiff) {
        minDiff = diff;
        closestPhase = idx;
      }
    });
    setActivePhaseIndex(closestPhase);
  };

  return (
    <div className="h-full flex flex-col gap-3.5 text-slate-100 overflow-y-auto custom-scrollbar px-1 py-1 pb-10 select-none">
      {/* 1. Header Banner & Mission Scenario Presets */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0B1120]/80 border border-slate-800/80 rounded-xl px-4 py-3 shrink-0 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="text-cyan-400">
            <Plane className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-mono font-bold tracking-wider text-slate-100 uppercase">
              MALE UAV DIGITAL TWIN MISSION REPLAY & ENVIRONMENTAL ENGINE
            </h1>
            <p className="text-xs font-mono text-slate-400 mt-0.5">
              Replay full 8-phase black-box mission flight records. Examine time-synchronized propulsion telemetry, physics-twin residuals, and degradation events across all operational phases.
            </p>
          </div>
        </div>

        {/* Top-Right Environmental Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleSelectPreset('HIGH_ALT_FL220')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activePreset === 'HIGH_ALT_FL220'
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400 shadow-[0_0_12px_rgba(0,240,255,0.3)]'
                : 'bg-slate-900/60 text-slate-400 border-slate-700/80 hover:text-slate-200'
            }`}
          >
            <Mountain className="w-3.5 h-3.5 text-cyan-400" />
            <span>HIGH-ALT FL280</span>
          </button>

          <button
            onClick={() => handleSelectPreset('HOT_DESERT')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activePreset === 'HOT_DESERT'
                ? 'bg-amber-500/15 text-amber-300 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                : 'bg-slate-900/60 text-slate-400 border-slate-700/80 hover:text-slate-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            <span>HOT DESERT +48°C</span>
          </button>

          <button
            onClick={() => handleSelectPreset('MARITIME')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-2 transition-all ${
              activePreset === 'MARITIME'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : 'bg-slate-900/60 text-slate-400 border-slate-700/80 hover:text-slate-200'
            }`}
          >
            <Waves className="w-3.5 h-3.5 text-emerald-400" />
            <span>MARITIME RELAY</span>
          </button>

          {/* More Scenarios Selector */}
          <button
            onClick={() => setShowMoreScenarios(!showMoreScenarios)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 transition-all ${
              showMoreScenarios || !['HIGH_ALT_FL220', 'HOT_DESERT', 'MARITIME'].includes(activePreset)
                ? 'bg-purple-500/20 text-purple-200 border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                : 'bg-slate-900/60 text-slate-400 border-slate-700/80 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-purple-400" />
            <span>{activePreset && !['HIGH_ALT_FL220', 'HOT_DESERT', 'MARITIME'].includes(activePreset) ? activePreset.replace(/_/g, ' ') : 'MORE SCENARIOS'}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreScenarios ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expanded Scenario Tray */}
      {showMoreScenarios && (
        <div className="bg-[#0B1120]/95 border border-purple-500/40 rounded-xl p-3 flex flex-wrap items-center gap-2 shrink-0 shadow-lg animate-in fade-in">
          <span className="text-[11px] font-mono text-purple-300 font-bold mr-2 uppercase tracking-wider">
            ALL 9 AEROSPACE SCENARIOS:
          </span>
          {AtmosphericPhysicsEngine.SCENARIO_PRESETS.map((sc) => {
            const isSelected = activePreset === sc.id;
            return (
              <button
                key={sc.id}
                onClick={() => handleSelectPreset(sc.id)}
                title={sc.description}
                className={`px-2.5 py-1 rounded text-xs font-mono transition-all border flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-purple-500/30 text-white border-purple-400 font-bold shadow-[0_0_10px_rgba(168,85,247,0.4)]'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <span>{sc.label}</span>
                <span className="text-[10px] text-slate-500 font-normal">({sc.altFt}ft)</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. Tactical ISR Mission Replay Timeline • 8-Phase Sortie */}
      <div className="bg-[#0B1120]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3 shrink-0 shadow-lg">
        {/* Subheader with Play/Speed controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800/60">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wide">
                TACTICAL ISR MISSION REPLAY TIMELINE • 8-PHASE SORTIE (BLACK-BOX FADEC TRACE)
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Synchronized FADEC recorder & physics twin • Scrub timeline to inspect engine telemetry and causal residuals at any timestamp
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTogglePlay}
              className="px-3.5 py-1.5 rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-mono font-bold text-xs flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(0,240,255,0.4)]"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-slate-950" /> : <Play className="w-3.5 h-3.5 fill-slate-950" />}
              <span>{isPlaying ? 'PAUSE REPLAY' : 'PLAY REPLAY'}</span>
            </button>

            <button
              onClick={handleToggleSpeed}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-cyan-300 text-xs font-mono font-bold transition-all"
            >
              {playbackSpeed}X SPEED
            </button>
          </div>
        </div>

        {/* 8-Phase Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
          {computedPhases.map((phase) => {
            const isSelected = activePhaseIndex === phase.id;
            return (
              <div
                key={phase.id}
                onClick={() => setActivePhaseIndex(phase.id)}
                className={`relative rounded-lg p-2.5 cursor-pointer transition-all border flex flex-col justify-between h-[78px] ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
                    : 'bg-slate-900/60 border-slate-800/90 hover:border-slate-700 hover:bg-slate-900/90'
                }`}
              >
                {/* Top: Timestamp and Status Dot / Badge */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-400">{phase.time}</span>
                  {phase.badge ? (
                    <span className={`text-[8px] font-mono px-1 py-0.2 rounded font-bold uppercase tracking-wider ${
                      phase.badgeType === 'danger' 
                        ? 'bg-red-500/20 text-red-300 border border-red-500/50' 
                        : phase.badgeType === 'orange'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                        : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/50'
                    }`}>
                      {phase.badge}
                    </span>
                  ) : (
                    <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_#10B981]' : 'bg-slate-700'}`}></div>
                  )}
                </div>

                {/* Middle: Phase Title */}
                <div className="font-mono font-bold text-xs text-slate-200 uppercase truncate mt-0.5">
                  {phase.name}
                </div>

                {/* Bottom: Alt and Spd */}
                <div className="text-[10px] font-mono text-slate-400">
                  {phase.alt} • {phase.spd}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Mission Anomaly Events Timeline (Click to Inspect Residuals) */}
      <div className="bg-[#0B1120]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3 shrink-0 shadow-lg">
        <div className="flex items-center justify-between pb-1 text-xs font-mono">
          <div className="flex items-center gap-2 text-amber-400 font-bold uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4" />
            <span>MISSION ANOMALY EVENTS TIMELINE (CLICK TO INSPECT RESIDUALS)</span>
          </div>
          <span className="text-slate-400 text-xs">3 Anomaly Flags Identified</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {sortie.anomalies.map((anom) => {
            const isTargetPhase = activePhaseIndex === anom.phaseId;
            const isCritical = anom.severity === 'CRITICAL';
            const isWarning = anom.severity === 'WARNING';
            const isMinor = anom.severity === 'MINOR';

            return (
              <div
                key={anom.id}
                onClick={() => handleJumpToAnomaly(anom)}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                  isTargetPhase
                    ? 'border-cyan-400 bg-cyan-950/20 shadow-[0_0_12px_rgba(0,240,255,0.25)]'
                    : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/80'
                }`}
              >
                <div className="mt-0.5">
                  {isMinor && <Info className="w-4 h-4 text-yellow-400" />}
                  {isWarning && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                  {isCritical && (
                    <div className="w-4 h-4 rounded-full border border-red-400 flex items-center justify-center text-red-400 text-[10px] font-bold">
                      !
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono text-slate-300 font-bold">{anom.time}</span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                      isMinor ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' :
                      isWarning ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' :
                      'bg-red-500/20 text-red-300 border border-red-500/40'
                    }`}>
                      {anom.severity}
                    </span>
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-100 truncate">
                    {anom.title}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    {anom.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Time-Synchronized Telemetry Snapshot (2 Rows x 7 Cards) */}
      <div className="bg-[#0B1120]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3 shrink-0 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-800/60 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold text-cyan-300 uppercase tracking-wider">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>TIME-SYNCHRONIZED TELEMETRY SNAPSHOT • {currentPhase.time} ({currentPhase.name})</span>
          </div>
          <div className="text-slate-400 text-xs flex items-center gap-3">
            <span>COORDS: <strong className="text-slate-200">{sortie.coords}</strong></span>
            <span className="text-slate-600">•</span>
            <span>FADEC SYNC: <strong className="text-emerald-400">{sortie.fadecSync}</strong></span>
          </div>
        </div>

        {/* 14 Telemetry Cards: Row 1 (Cards 1 to 7) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs font-mono">
          {/* 1. ALTITUDE */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">1. ALTITUDE</div>
            <div className="text-base font-bold text-emerald-400">{activeTelemetry.alt}</div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.flTag}</div>
          </div>

          {/* 2. AIRSPEED */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">2. AIRSPEED</div>
            <div className="text-base font-bold text-slate-100">{activeTelemetry.spd}</div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.spdSub}</div>
          </div>

          {/* 3. THROTTLE */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">3. THROTTLE</div>
            <div className="text-base font-bold text-cyan-400">{activeTelemetry.thr}</div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.thrSub}</div>
          </div>

          {/* 4. ENGINE RPM */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">4. ENGINE RPM</div>
            <div className="text-base font-bold text-slate-100">{activeTelemetry.rpm}</div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.rpmSub}</div>
          </div>

          {/* 5. FUEL FLOW */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">5. FUEL FLOW</div>
            <div className="text-base font-bold text-cyan-400">{activeTelemetry.fuelFlow}</div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.fuelFlowSub}</div>
          </div>

          {/* 6. MAX CHT */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">6. MAX CHT</div>
            <div className={`text-base font-bold ${parseFloat(activeTelemetry.cht) > 130 ? 'text-red-400' : 'text-slate-100'}`}>
              {activeTelemetry.cht}
            </div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.chtSub}</div>
          </div>

          {/* 7. MAX EGT */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">7. MAX EGT</div>
            <div className={`text-base font-bold ${parseFloat(activeTelemetry.egt) > 900 ? 'text-amber-400' : 'text-slate-100'}`}>
              {activeTelemetry.egt}
            </div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.egtSub}</div>
          </div>
        </div>

        {/* Row 2 (Cards 8 to 14) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs font-mono">
          {/* 8. OIL PRESSURE */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">8. OIL PRESSURE</div>
            <div className="text-base font-bold text-amber-400">{activeTelemetry.oilP}</div>
            <div className="text-[10px] text-slate-500">{activeTelemetry.oilPSub}</div>
          </div>

          {/* 9. OIL TEMP */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">9. OIL TEMP</div>
            <div className="text-base font-bold text-slate-100">{activeTelemetry.oilT}</div>
            <div className="text-[10px] text-slate-500">Nom: 90-110°C</div>
          </div>

          {/* 10. VIBRATION */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">10. VIBRATION</div>
            <div className={`text-base font-bold ${parseFloat(activeTelemetry.vib) > 0.05 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {activeTelemetry.vib}
            </div>
            <div className="text-[10px] text-slate-500">Nom: &lt;0.05 IPS</div>
          </div>

          {/* 11. BOOST / MAP */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">11. BOOST / MAP</div>
            <div className="text-base font-bold text-cyan-400">{activeTelemetry.map}</div>
            <div className="text-[10px] text-slate-500">Manifold Absolute</div>
          </div>

          {/* 12. HEALTH INDEX */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">12. HEALTH INDEX</div>
            <div className={`text-base font-bold ${activeTelemetry.healthVal < 80 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {activeTelemetry.health}
            </div>
            <div className="text-[10px] text-slate-500">Prognostic Twin</div>
          </div>

          {/* 13. ANOMALY SCORE */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">13. ANOMALY SCORE</div>
            <div className={`text-base font-bold ${parseFloat(activeTelemetry.anomalyScore) > 0.25 ? 'text-red-400' : 'text-emerald-400'}`}>
              {activeTelemetry.anomalyScore}
            </div>
            <div className="text-[10px] text-slate-500">Autoencoder MSE</div>
          </div>

          {/* 14. ESTIMATED RUL */}
          <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80 flex flex-col justify-between h-[72px]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">14. ESTIMATED RUL</div>
            <div className="text-base font-bold text-cyan-400">{activeTelemetry.rul}</div>
            <div className="text-[10px] text-slate-500">Bi-LSTM 95% CI</div>
          </div>
        </div>
      </div>

      {/* 5. Phase Log Note Callout Box */}
      <div className="bg-[#0B1120]/90 border border-slate-800/80 rounded-xl px-4 py-3 text-xs font-mono text-slate-300 shadow-lg">
        <span className="text-slate-400 font-bold uppercase tracking-wider">PHASE LOG NOTE: </span>
        <span>{currentLogNote}</span>
      </div>

      {/* 6. Engine Health Through Mission • Time vs Health Index (Interactive SVG Curve) */}
      <div className="bg-[#0B1120]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col gap-3 shrink-0 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-2 font-bold text-cyan-300 uppercase tracking-wider">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>ENGINE HEALTH THROUGH MISSION • TIME VS HEALTH INDEX</span>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>Health Index (%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span>Anomaly Event</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-[1.5px] bg-red-500 border-b border-dashed border-red-500"></span>
              <span className="text-red-400">50% MEL Overhaul Limit</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] font-mono text-slate-400 -mt-1">
          Continuous multi-stress fatigue degradation curve with dynamic physics & ML projections
        </p>

        {/* SVG Degradation Curve */}
        <div className="relative w-full h-52 bg-[#060A14] rounded-lg border border-slate-800/80 p-2 overflow-hidden">
          <svg 
            className="w-full h-full cursor-pointer" 
            viewBox="0 0 1000 200" 
            preserveAspectRatio="none"
            onClick={handleSvgClick}
          >
            <defs>
              {/* Vertical Gradient Under-Curve Fill */}
              <linearGradient id="degradationGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0.35" />
                <stop offset="50%" stopColor="#F59E0B" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#EF4444" stopOpacity="0.20" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines */}
            <line x1="60" y1="30" x2="960" y2="30" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
            <text x="30" y="34" fill="#64748B" fontSize="10" fontFamily="monospace">100%</text>

            <line x1="60" y1="75" x2="960" y2="75" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
            <text x="35" y="79" fill="#64748B" fontSize="10" fontFamily="monospace">80%</text>

            <line x1="60" y1="120" x2="960" y2="120" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
            <text x="35" y="124" fill="#64748B" fontSize="10" fontFamily="monospace">60%</text>

            {/* Red Dashed 50% MEL Overhaul Limit Line */}
            <line x1="60" y1="145" x2="960" y2="145" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.85" />
            <text x="880" y="140" fill="#EF4444" fontSize="9" fontFamily="monospace" fontWeight="bold">MEL 50% LIMIT</text>

            {/* Dynamic Filled Area Under Degradation Curve */}
            <polygon
              points={svgCoordinates.polygonPoints}
              fill="url(#degradationGradient)"
            />

            {/* Dynamic Main Degradation Line */}
            <polyline
              points={svgCoordinates.polylinePoints}
              fill="none"
              stroke="#10B981"
              strokeWidth="2.5"
            />

            {/* Dynamic Phase Points along curve */}
            {svgCoordinates.xCoords.map((x, i) => {
              const y = Number((30 + (100.0 - (trajectory[i] || 70.0)) * 2.3).toFixed(1));
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="4.5"
                  fill="#10B981"
                  className="cursor-pointer hover:stroke-cyan-400 hover:stroke-2 transition-all"
                  onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(i); }}
                />
              );
            })}

            {/* Dynamic Anomaly 1 Flag (T+01:42:00 at x=300) */}
            {(() => {
              const yAnom1 = Number((30 + (100.0 - (trajectory[3] || 94.0)) * 2.3).toFixed(1));
              return (
                <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(3); }}>
                  <circle cx="300" cy={yAnom1} r="5" fill="#F59E0B" stroke="#060A14" strokeWidth="1.5" />
                  <rect x="272" y={Math.max(10, yAnom1 - 24)} width="56" height="15" rx="3" fill="#78350F" stroke="#F59E0B" strokeWidth="1" />
                  <text x="276" y={Math.max(21, yAnom1 - 13)} fill="#FDE68A" fontSize="8" fontFamily="monospace" fontWeight="bold">▲ ANOMALY</text>
                </g>
              );
            })()}

            {/* Dynamic Anomaly 2 Flag (T+03:18:00 at x=500) */}
            {(() => {
              const yAnom2 = Number((30 + (100.0 - (trajectory[4] || 86.0)) * 2.3).toFixed(1));
              return (
                <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(4); }}>
                  <circle cx="500" cy={yAnom2} r="5" fill="#F59E0B" stroke="#060A14" strokeWidth="1.5" />
                  <rect x="472" y={Math.max(10, yAnom2 - 24)} width="56" height="15" rx="3" fill="#78350F" stroke="#F59E0B" strokeWidth="1" />
                  <text x="476" y={Math.max(21, yAnom2 - 13)} fill="#FDE68A" fontSize="8" fontFamily="monospace" fontWeight="bold">▲ ANOMALY</text>
                </g>
              );
            })()}

            {/* Dynamic Anomaly 3 Vib Spike Flag (T+04:05:00 at x=600) */}
            {(() => {
              const yAnom3 = Number((30 + (100.0 - (trajectory[5] || 76.0)) * 2.3).toFixed(1));
              return (
                <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(5); }}>
                  <circle cx="600" cy={yAnom3} r="5.5" fill="#EF4444" stroke="#060A14" strokeWidth="1.5" />
                  <rect x="572" y={Math.max(10, yAnom3 - 24)} width="60" height="15" rx="3" fill="#7F1D1D" stroke="#EF4444" strokeWidth="1" />
                  <text x="576" y={Math.max(21, yAnom3 - 13)} fill="#FCA5A5" fontSize="8" fontFamily="monospace" fontWeight="bold">● VIB SPIKE</text>
                </g>
              );
            })()}

            {/* Current Active Playhead (Vertical dashed line at dynamic active coordinates) */}
            {(() => {
              const curX = svgCoordinates.activeX;
              const curY = svgCoordinates.activeY;
              const curHealth = activeTelemetry.health;
              const curTime = currentPhase.time;

              return (
                <g>
                  {/* Vertical Playhead Line */}
                  <line x1={curX} y1="20" x2={curX} y2="180" stroke="#00F0FF" strokeWidth="1.5" strokeDasharray="3 3" />
                  
                  {/* Target Cursor Circle */}
                  <circle cx={curX} cy={curY} r="7" fill="none" stroke="#00F0FF" strokeWidth="2" />
                  <circle cx={curX} cy={curY} r="3" fill="#00F0FF" />

                  {/* Playhead Tag Label */}
                  <text 
                    x={curX > 800 ? curX - 110 : curX + 10} 
                    y="40" 
                    fill="#00F0FF" 
                    fontSize="10" 
                    fontFamily="monospace" 
                    fontWeight="bold"
                  >
                    {curHealth} ({curTime})
                  </text>
                </g>
              );
            })()}

            {/* X-Axis Timestamps */}
            <text x="50" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">00:00:00</text>
            <text x="90" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">00:06:00</text>
            <text x="160" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">00:40:00</text>
            <text x="280" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">01:42:00</text>
            <text x="480" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">03:18:00</text>
            <text x="580" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">04:05:00</text>
            <text x="770" y="175" fill="#64748B" fontSize="9" fontFamily="monospace">06:00:00</text>
            <text x="910" y="175" fill="#00F0FF" fontSize="9" fontFamily="monospace" fontWeight="bold">07:00:00</text>
          </svg>
        </div>
      </div>

      {/* 7. Bottom Row: Atmospheric Environmental Boundaries + Physics Derivations (ISA 1976) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {/* Left: Atmospheric & Environmental Boundary Conditions */}
        <div className="bg-[#0B1120]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-3 shrink-0 shadow-lg">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-800/60 font-mono font-bold text-xs text-slate-200 uppercase tracking-wider">
            <Cloud className="w-4 h-4 text-cyan-400" />
            <span>ATMOSPHERIC & ENVIRONMENTAL BOUNDARY CONDITIONS</span>
          </div>

          <div className="flex flex-col gap-3 text-xs font-mono">
            {/* Slider 1: Pressure Altitude */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">PRESSURE ALTITUDE:</span>
                <span className="text-cyan-300 font-bold">{altitudeFt} FT (FL{Math.round(altitudeFt / 100)})</span>
              </div>
              <input
                type="range"
                min="0"
                max="30000"
                step="500"
                value={altitudeFt}
                onChange={(e) => setAltitudeFt(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-lg bg-slate-950 border border-slate-800 appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>SEA LEVEL</span>
                <span>FL180</span>
                <span>FL300 (SERVICE CEILING)</span>
              </div>
            </div>

            {/* Slider 2: Ambient Static Temperature (ISA Delta) */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">AMBIENT STATIC TEMPERATURE (ISA DELTA):</span>
                <span className="text-emerald-400 font-bold">{deltaIsaTempC} °C</span>
              </div>
              <input
                type="range"
                min="-50"
                max="50"
                step="1"
                value={deltaIsaTempC}
                onChange={(e) => setDeltaIsaTempC(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-lg bg-slate-950 border border-slate-800 appearance-none cursor-pointer accent-emerald-400 focus:outline-none"
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>-50°C (COLD SOAK)</span>
                <span>+15°C (ISA STD)</span>
                <span>+50°C (DESERT STRESS)</span>
              </div>
            </div>

            {/* Bottom 2 Context Cards */}
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-[10px] text-slate-500 uppercase">ISR SENSOR PAYLOAD:</div>
                <div className="text-xs font-bold text-slate-100 mt-0.5">{payloadStr}</div>
              </div>

              <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                <div className="text-[10px] text-slate-500 uppercase">TURBULENCE / HEADWIND:</div>
                <div className="text-xs font-bold text-slate-100 mt-0.5">{headwindKts} kts</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Physics-Informed Aerothermal Derivations (ISA 1976) */}
        <div className="bg-[#0B1120]/80 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between gap-3 shrink-0 shadow-lg">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-800/60 font-mono font-bold text-xs text-slate-200 uppercase tracking-wider">
            <Calculator className="w-4 h-4 text-emerald-400" />
            <span>PHYSICS-INFORMED AEROTHERMAL DERIVATIONS (ISA 1976)</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono h-full">
            {/* 1. Atmospheric Pressure */}
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">ATMOSPHERIC PRESSURE:</div>
              <div className="text-lg font-bold text-cyan-400">{aerothermal.atmosphericPressureHpa} hPa</div>
              <div className="text-[10px] text-slate-500">Barometric lapse model (ISA)</div>
            </div>

            {/* 2. Air Density */}
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">AIR DENSITY (ρ):</div>
              <div className="text-lg font-bold text-emerald-400">{aerothermal.airDensityKgM3} kg/m³</div>
              <div className="text-[10px] text-slate-500">ρ/ρ₀ = {aerothermal.densityRatio} (Density Altitude)</div>
            </div>

            {/* 3. Turbo Compensator Ratio */}
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">TURBO COMPENSATOR RATIO:</div>
              <div className="text-lg font-bold text-amber-400">{aerothermal.turboCompensatorRatio}:1 PR</div>
              <div className="text-[10px] text-slate-500">Wastegate MAP clamping</div>
            </div>

            {/* 4. Radiator Heat Flux */}
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 flex flex-col justify-between">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">RADIATOR HEAT FLUX:</div>
              <div className="text-lg font-bold text-slate-100">{aerothermal.radiatorHeatFluxKw} kW</div>
              <div className="text-[10px] text-slate-500">Forced convection transfer</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
