import React, { useState, useEffect, useRef } from 'react';
import { useTelemetry } from './context/TelemetryContext';
import { 
  Box, 
  Activity, 
  Brain, 
  Map, 
  Users, 
  Sliders, 
  FileText, 
  Volume2, 
  VolumeX, 
  Radio, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle, 
  Flame, 
  Wrench, 
  Plane,
  Clock,
  Sparkles,
  Columns,
  Maximize2,
  Minimize2,
  X,
  Layers,
  ArrowRightLeft,
  RotateCcw,
  Compass,
  Keyboard,
  Database
} from 'lucide-react';

// Tab Components
import { UavBlueprintTab } from './components/UavBlueprintTab';
import { TelemetryTab } from './components/TelemetryTab';
import { PrognosticsTab } from './components/PrognosticsTab';
import { MissionMapTab } from './components/MissionMapTab';
import { FleetTab } from './components/FleetTab';
import { JudgesSandboxTab } from './components/JudgesSandboxTab';
import { CopilotTab } from './components/CopilotTab';
import { PostFlightReplayTab } from './components/PostFlightReplayTab';
import { UnifiedDebriefTab } from './components/UnifiedDebriefTab';
import { FeaturesInspectorModal } from './components/FeaturesInspectorModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import FlightControllerTab from './components/FlightControllerTab';
import { DataSourceTab } from './components/DataSourceTab';

export default function App() {
  const { telemetry, isConnected, audioEnabled, setAudioEnabled, injectFault, clearFault, isReplayMode, exitReplayMode, commandError, clearCommandError, aiPrognostics } = useTelemetry();

  // Server-side command rejections (e.g. invalid input) are shown briefly
  useEffect(() => {
    if (!commandError) return;
    const t = setTimeout(clearCommandError, 5000);
    return () => clearTimeout(t);
  }, [commandError, clearCommandError]);
  const [activeTab, setActiveTab] = useState('BLUEPRINT');
  const [secondaryTab, setSecondaryTab] = useState('MISSION_MAP');
  const [isDualDocked, setIsDualDocked] = useState(false);
  const [missionClock, setMissionClock] = useState(new Date().toLocaleTimeString());
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isKeybindingsOpen, setIsKeybindingsOpen] = useState(false);

  // Measured link figures for the status tray (frames received per second, age of the latest frame)
  const frameCountRef = useRef(0);
  const [linkStats, setLinkStats] = useState({ hz: null, ageMs: null });
  const lastFrameTsRef = useRef(null);
  useEffect(() => { frameCountRef.current += 1; lastFrameTsRef.current = telemetry.timestamp; }, [telemetry.timestamp]);
  useEffect(() => {
    const t = setInterval(() => {
      const ts = lastFrameTsRef.current;
      setLinkStats({ hz: frameCountRef.current, ageMs: ts ? Math.max(0, Date.now() - ts) : null });
      frameCountRef.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Update Clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setMissionClock(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard navigation shortcuts (1-9, D, K, Esc). Keep keyMap in the same order as `tabs` below.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const keyMap = {
        '1': 'BLUEPRINT',
        '2': 'PROGNOSTICS',
        '3': 'TELEMETRY',
        '4': 'MISSION_MAP',
        '5': 'FLEET',
        '6': 'DATA',
        '7': 'FLIGHT_CONTROLLER',
        '8': 'SANDBOX',
        '9': 'DEBRIEF',
      };
      if (keyMap[e.key]) {
        setActiveTab(keyMap[e.key]);
      } else if (e.key === 'd' || e.key === 'D') {
        setIsDualDocked(prev => !prev);
      } else if (e.key === 'k' || e.key === 'K' || e.key === '?') {
        setIsKeybindingsOpen(prev => !prev);
      } else if (e.key === 'Escape') {
        setIsKeybindingsOpen(false);
        setIsInspectorOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const health = telemetry.health;
  const isCritical = health.status === 'CRITICAL';
  const isDegraded = health.status === 'DEGRADED';
  const isNoData = health.status === 'NO_DATA';
  const srcMode = telemetry.source?.mode ?? 'SIM';

  // Tabs in demo order: inject & see (1) -> AI diagnosis (2) -> evidence (3) -> decision (4) -> fleet (5)
  // -> real-data path (6) -> aircraft (7) -> manual bench (8); the hand-authored demo scenario is last (9).
  // Hotkeys must match keyMap above.
  const tabs = [
    { id: 'BLUEPRINT', hotkey: '1', label: '3D CAD BLUEPRINT', icon: Box, component: UavBlueprintTab },
    { id: 'PROGNOSTICS', hotkey: '2', label: 'AI PROGNOSTICS & XAI', icon: Brain, component: PrognosticsTab },
    { id: 'TELEMETRY', hotkey: '3', label: 'LIVE TELEMETRY', icon: Activity, component: TelemetryTab },
    { id: 'MISSION_MAP', hotkey: '4', label: 'RTB CONTINGENCY PLANNER', icon: Map, component: MissionMapTab },
    { id: 'FLEET', hotkey: '5', label: 'FLEET HEALTH', icon: Users, component: FleetTab },
    { id: 'DATA', hotkey: '6', label: 'DATA SOURCE & REPLAY', icon: Database, component: DataSourceTab },
    { id: 'FLIGHT_CONTROLLER', hotkey: '7', label: '6-DOF FLIGHT CONTROLLER', icon: Compass, component: FlightControllerTab },
    { id: 'SANDBOX', hotkey: '8', label: "WHAT-IF TEST BENCH", icon: Sliders, component: JudgesSandboxTab },
    { id: 'DEBRIEF', hotkey: '9', label: 'MISSION DEBRIEF (DEMO SCENARIO)', icon: RotateCcw, component: UnifiedDebriefTab },
  ];

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || (activeTab === 'REPLAY' || activeTab === 'COPILOT' || activeTab === 'DEBRIEF' ? UnifiedDebriefTab : UavBlueprintTab);
  const SecondaryComponent = tabs.find(t => t.id === secondaryTab)?.component || (secondaryTab === 'REPLAY' || secondaryTab === 'COPILOT' || secondaryTab === 'DEBRIEF' ? UnifiedDebriefTab : MissionMapTab);

  const handleSwapPanes = () => {
    const temp = activeTab;
    setActiveTab(secondaryTab);
    setSecondaryTab(temp);
  };

  return (
    <div className="h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans relative overflow-hidden select-none">
      {/* 1. Master GCS Annunciator Bar */}
      <header className="bg-white border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0 z-50 shadow-xs">
        {/* Left: Callout & Airframe Registry */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-sky-50 border border-sky-200 flex items-center justify-center shadow-xs">
            <Plane className="w-5 h-5 text-sky-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-sm tracking-wider text-slate-900 uppercase">
                GarudaTwin <span className="text-slate-400 font-mono text-xs font-normal">//</span> Tactical GCS
              </h1>
              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-700 tracking-wider font-medium">
                SIH 2026 PROTOTYPE
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-slate-600 tracking-wider font-medium">
                SIMULATOR DATA
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 flex items-center gap-2">
              <span>ROTAX 915 iS PROPULSION</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-800 font-semibold tracking-wider">TAIL: VAHAK-1</span>
            </div>
          </div>
        </div>

        {/* Center: Real-Time Annunciator & Aviation Metrics Ticker */}
        <div className="hidden xl:flex items-center gap-5 bg-slate-50 px-4 py-1.5 rounded-md text-xs font-mono border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 text-slate-700">
            <Clock className="w-3.5 h-3.5 text-sky-600" />
            <span className="text-slate-900 font-bold tabular-nums">ZULU {missionClock}</span>
          </div>
          <div className="h-3.5 w-[1px] bg-slate-200"></div>
          <div className="text-slate-500">
            ALT <span className="text-slate-900 font-bold ml-1 tabular-nums">{telemetry.mission.altitudeFt.toLocaleString()}</span> <span className="text-[10px] text-slate-400">FT</span>
          </div>
          <div className="h-3.5 w-[1px] bg-slate-200"></div>
          <div className="text-slate-500">
            AIRSPEED <span className="text-slate-900 font-bold ml-1 tabular-nums">{telemetry.mission.airspeedKts}</span> <span className="text-[10px] text-slate-400">KTS</span>
          </div>
          <div className="h-3.5 w-[1px] bg-slate-200"></div>
          <div className="text-slate-600 flex items-center gap-2">
            <span className="font-medium">HEALTH</span>
            <span className={`font-mono font-bold text-xs px-2 py-0.5 rounded tabular-nums border ${
              isCritical ? 'text-red-700 bg-red-50 border-red-300' : 
              isDegraded ? 'text-amber-800 bg-amber-50 border-amber-300' : 
              'text-emerald-800 bg-emerald-50 border-emerald-300'
            }`}>
              {health.index.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Right: Controls, System State & Bus Indicator */}
        <div className="flex items-center gap-2">
          {/* Operator Keybindings Quick Toggle */}
          <button
            onClick={() => setIsKeybindingsOpen(true)}
            className="px-2 py-1.5 rounded-md bg-white hover:bg-slate-50 border border-slate-200 hover:border-sky-400 text-slate-700 hover:text-slate-900 transition-colors text-xs font-mono font-medium flex items-center gap-1 shadow-xs"
            title="Operator Keybindings Reference (Hotkey: K / ?)"
          >
            <Keyboard className="w-3.5 h-3.5 text-sky-600" />
            <span className="font-bold text-[10px]">[K]</span>
          </button>

          {/* AI Features System Modal Trigger */}
          <button
            onClick={() => setIsInspectorOpen(true)}
            className="px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-50 border border-slate-200 hover:border-sky-400 text-slate-700 hover:text-slate-900 transition-colors text-xs font-mono font-medium flex items-center gap-1.5 shadow-xs"
            title="Inspect the AI model input features (live)"
          >
            <Sliders className="w-3.5 h-3.5 text-sky-600" />
            <span className="hidden sm:inline">AI METRICS</span>
            <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[10px] font-mono font-semibold">{aiPrognostics?.modelMetadata?.num_features ?? '—'}</span>
          </button>

          {/* Split-Screen Dual Docking Toggle */}
          <button
            onClick={() => setIsDualDocked(!isDualDocked)}
            title={isDualDocked ? 'Switch to Single View (Hotkey: D)' : 'Enable Split-Screen Dual Docking (Hotkey: D)'}
            className={`px-2.5 py-1.5 rounded-md text-xs font-mono transition-colors flex items-center gap-1.5 border shadow-xs ${
              isDualDocked
                ? 'bg-sky-50 text-sky-700 border-sky-300 font-semibold'
                : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{isDualDocked ? 'DUAL DOCK' : 'SPLIT'}</span>
            <span className="text-[10px] text-slate-400 font-mono">[D]</span>
          </button>

          {/* Audio Alarm Toggle */}
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            title={audioEnabled ? 'Audio Alarms: Active' : 'Audio Alarms: Muted'}
            className={`p-2 rounded-md border text-xs font-mono transition-colors flex items-center shadow-xs ${
              audioEnabled
                ? 'bg-sky-50 text-sky-700 border-sky-300'
                : 'bg-white text-slate-400 border-slate-200 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          {/* Replay Mode Indicator Badge if active */}
          {isReplayMode && (
            <button
              onClick={() => setActiveTab('DEBRIEF')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs font-mono font-semibold shadow-xs"
              title="Mission Replay Active"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>REPLAY ACTIVE</span>
            </button>
          )}

          {/* Engine data source (gateway link + which source feeds the twin) */}
          <button
            onClick={() => setActiveTab('DATA')}
            title="Engine data source: open Data Source & Replay [6]"
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs font-mono shadow-xs ${
              srcMode === 'REPLAY' ? 'bg-amber-50 border-amber-300' : srcMode === 'LIVE' ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200'}`}
          >
            <span className={`w-2 h-2 rounded-full ${!isConnected || isNoData ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
            <span className={isConnected ? 'text-slate-800 font-semibold' : 'text-amber-700 font-semibold'}>
              {!isConnected ? 'GATEWAY OFFLINE'
                : srcMode === 'REPLAY' ? `REPLAY ${telemetry.source?.replay?.playing ? '▶' : '❚❚'}`
                : srcMode === 'LIVE' ? (isNoData ? 'LIVE · NO DATA' : 'LIVE INGEST')
                : 'SIMULATOR'}
            </span>
          </button>

          {/* Overall Health Status Annunciator */}
          <div className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-bold flex items-center gap-1.5 border shadow-xs ${
            isCritical
              ? 'bg-red-50 border-red-300 text-red-700'
              : isDegraded
              ? 'bg-amber-50 border-amber-300 text-amber-800'
              : isNoData
              ? 'bg-slate-100 border-slate-400 text-slate-700'
              : 'bg-emerald-50 border-emerald-300 text-emerald-800'
          }`}>
            {isCritical || isNoData ? <ShieldAlert className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            <span className="tracking-wider">{health.status}</span>
          </div>
        </div>
      </header>

      {telemetry.fcs?.geofence?.status === 'RETURNING' && (
        <div role="alert" className="px-4 py-2 text-xs font-mono bg-red-50 border-b border-red-300 text-red-800">
          GEOFENCE: Vahak-1 returned to its station orbit — {(telemetry.fcs.geofence.lastEvent?.reasons || telemetry.fcs.geofence.reasons || []).join('; ')}.
          Border distance {telemetry.fcs.geofence.borderNm?.toFixed?.(1)} NM (minimum {telemetry.fcs.geofence.bufferNm} NM). Logged as an emergency event.
        </div>
      )}

      {isNoData && (
        <div role="alert" className="px-4 py-2 text-xs font-mono bg-slate-100 border-b border-slate-300 text-slate-800">
          {health.alertMessage}
        </div>
      )}

      {aiPrognostics?.aiOnline === false && !isReplayMode && srcMode === 'SIM' && (
        <div role="alert" className="px-4 py-2 text-xs font-mono bg-amber-50 border-b border-amber-300 text-amber-800">
          AI service offline — diagnosis unavailable; showing physics-only health estimate. Start it with <code>npm run start:all</code> (or <code>npm run ai</code>).
        </div>
      )}

      {commandError && (
        <div role="alert" className="px-4 py-2 text-xs font-mono bg-amber-50 border-b border-amber-300 text-amber-800">
          Command rejected by gateway — {commandError}
        </div>
      )}

      {/* 2. Tactical Emergency / Degradation Master Caution Bar */}
      {(isCritical || isDegraded) && (
        <div className={`px-4 py-2 flex items-center justify-between text-xs font-mono border-b ${
          isCritical
            ? 'bg-red-50 text-red-900 border-red-300'
            : 'bg-amber-50 text-amber-900 border-amber-300'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1 rounded ${isCritical ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}>
              <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
            <span className="font-semibold tracking-wide uppercase">{health.alertMessage}</span>
          </div>
          <button 
            onClick={() => setActiveTab('MISSION_MAP')}
            className="font-bold flex items-center gap-1 px-3 py-1 rounded bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 transition-all text-xs shadow-xs"
          >
            <span>RTB CONTINGENCY PLAN</span>
            <span className="text-sky-600">→</span>
          </button>
        </div>
      )}

      {/* 3. Rack-Mount Switch Tab Navigation */}
      <nav className="bg-white border-b border-slate-200 px-3 py-1 flex items-center justify-between gap-1 shrink-0 overflow-x-auto custom-scrollbar">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const isSecondary = isDualDocked && secondaryTab === tab.id;
            const Icon = tab.icon;
            const hasAlert = (tab.id === 'PROGNOSTICS' || tab.id === 'MISSION_MAP') && (isCritical || isDegraded);

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative py-1.5 px-3 rounded text-xs font-mono uppercase whitespace-nowrap transition-colors flex items-center gap-2 border ${
                  isActive
                    ? 'bg-slate-100 text-slate-900 border-slate-300 font-bold shadow-xs after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-sky-600'
                    : isSecondary
                    ? 'bg-sky-50 text-sky-700 border-sky-300'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-3.5 h-3.5 ${
                    isActive ? 'text-sky-600' : isSecondary ? 'text-sky-600' : 'text-slate-400'
                  }`} />
                  {hasAlert && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500"></span>
                  )}
                </div>

                <span className="tracking-wide">{tab.label}</span>

                {/* Hotkey Tag */}
                <span className={`text-[9px] font-mono px-1 rounded ${
                  isActive 
                    ? 'bg-sky-100 text-sky-800 font-bold' 
                    : 'bg-slate-100 border border-slate-200 text-slate-500'
                }`}>
                  [{tab.hotkey}]
                </span>

                {/* Secondary Dock Indicator */}
                {isSecondary && (
                  <span className="text-[8px] font-mono px-1 rounded bg-sky-200 text-sky-900 font-bold">
                    DOCKED
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Dual Dock Secondary Selector */}
        {isDualDocked && (
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono pl-3 border-l border-slate-200">
            <span className="text-slate-500 text-[11px]">DOCK:</span>
            <select
              value={secondaryTab}
              onChange={(e) => setSecondaryTab(e.target.value)}
              className="bg-white text-slate-800 border border-slate-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-sky-500"
            >
              {tabs.map(t => (
                <option key={t.id} value={t.id} disabled={t.id === activeTab}>
                  {t.label}
                </option>
              ))}
            </select>
            <button 
              onClick={handleSwapPanes}
              title="Swap Viewport Panes"
              className="p-1 rounded bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </nav>

      {/* 4. Main Active Viewport Container */}
      <main className="flex-1 min-h-0 p-2.5 overflow-hidden relative bg-[#F8FAFC]">
        {isDualDocked ? (
          <div className="flex flex-col lg:flex-row h-full gap-2.5 overflow-hidden">
            {/* Primary Viewport Pane */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-white rounded-lg p-2 relative border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between px-2 pb-1.5 mb-1.5 border-b border-slate-100 text-xs font-mono shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-sky-600"></span>
                  <span className="text-slate-800 font-semibold tracking-wider uppercase">PRIMARY // {tabs.find(t => t.id === activeTab)?.label}</span>
                </div>
                <button
                  onClick={() => setIsDualDocked(false)}
                  title="Maximize to Single View"
                  className="p-1 rounded text-slate-400 hover:text-slate-700 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden relative">
                <ActiveComponent />
              </div>
            </div>

            {/* Secondary Docked Viewport Pane */}
            <div className="flex-1 flex flex-col h-full overflow-hidden bg-white rounded-lg p-2 relative border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between px-2 pb-1.5 mb-1.5 border-b border-slate-100 text-xs font-mono shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                  <span className="text-slate-700 font-semibold tracking-wider uppercase">SECONDARY // {tabs.find(t => t.id === secondaryTab)?.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={secondaryTab}
                    onChange={(e) => setSecondaryTab(e.target.value)}
                    className="bg-white text-slate-800 border border-slate-200 rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none"
                  >
                    {tabs.map(t => (
                      <option key={t.id} value={t.id} disabled={t.id === activeTab}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setIsDualDocked(false)}
                    title="Close Secondary Dock"
                    className="p-1 rounded text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden relative">
                <SecondaryComponent />
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full w-full overflow-hidden relative">
            <ActiveComponent />
          </div>
        )}
      </main>

      {/* Defense-Style Status Tray Footer */}
      <footer className="h-6 bg-slate-900 text-slate-300 border-t border-slate-800 px-4 flex items-center gap-4 text-[10px] font-mono shrink-0 select-none z-40">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
          <span className="text-slate-400 font-semibold">Gateway telemetry:</span>
          <span className={isConnected ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
            {isConnected ? `${linkStats.hz ?? '—'} frames/s (measured)` : 'DISCONNECTED'}
          </span>
        </div>
        <span className="text-slate-700">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-semibold">Frame age:</span>
          <span className="text-slate-200 font-bold">{linkStats.ageMs == null ? '—' : `${linkStats.ageMs} ms`}</span>
        </div>
        <span className="text-slate-700">|</span>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-semibold">FCS Loop:</span>
          <span className="text-sky-300 font-bold">50 Hz sim-time [TECS+L1]</span>
        </div>
      </footer>

      {/* 5. AI Features & Diagnostics Modal */}
      <FeaturesInspectorModal isOpen={isInspectorOpen} onClose={() => setIsInspectorOpen(false)} />

      {/* 7. Operator Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal isOpen={isKeybindingsOpen} onClose={() => setIsKeybindingsOpen(false)} />
    </div>
  );
}


