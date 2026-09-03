import React, { useState, useEffect } from 'react';
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
  RotateCcw
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

export default function App() {
  const { telemetry, isConnected, audioEnabled, setAudioEnabled, injectFault, clearFault, isReplayMode, exitReplayMode } = useTelemetry();
  const [activeTab, setActiveTab] = useState('BLUEPRINT');
  const [secondaryTab, setSecondaryTab] = useState('MISSION_MAP');
  const [isDualDocked, setIsDualDocked] = useState(false);
  const [missionClock, setMissionClock] = useState(new Date().toLocaleTimeString());
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // Update Clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setMissionClock(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard navigation shortcuts (1-8) for Mission Control
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      const keyMap = {
        '1': 'BLUEPRINT',
        '2': 'TELEMETRY',
        '3': 'PROGNOSTICS',
        '4': 'MISSION_MAP',
        '5': 'FLEET',
        '6': 'SANDBOX',
        '7': 'DEBRIEF',
        '8': 'DEBRIEF',
      };
      if (keyMap[e.key]) {
        setActiveTab(keyMap[e.key]);
      } else if (e.key === 'd' || e.key === 'D') {
        setIsDualDocked(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const health = telemetry.health;
  const isCritical = health.status === 'CRITICAL';
  const isDegraded = health.status === 'DEGRADED';

  // Tabs Configuration (Consolidated: Tab 7 integrates Mission Replay & AI Debrief)
  const tabs = [
    { id: 'BLUEPRINT', hotkey: '1', label: '3D CAD BLUEPRINT', icon: Box, component: UavBlueprintTab },
    { id: 'TELEMETRY', hotkey: '2', label: 'LIVE TELEMETRY', icon: Activity, component: TelemetryTab },
    { id: 'PROGNOSTICS', hotkey: '3', label: 'AI PROGNOSTICS & XAI', icon: Brain, component: PrognosticsTab },
    { id: 'MISSION_MAP', hotkey: '4', label: 'RL REPLANNER', icon: Map, component: MissionMapTab },
    { id: 'FLEET', hotkey: '5', label: 'SWARM FLEET', icon: Users, component: FleetTab },
    { id: 'SANDBOX', hotkey: '6', label: "JUDGE'S SANDBOX", icon: Sliders, component: JudgesSandboxTab },
    { id: 'DEBRIEF', hotkey: '7', label: 'MISSION REPLAY & AI DEBRIEF', icon: RotateCcw, component: UnifiedDebriefTab },
  ];

  const ActiveComponent = tabs.find(t => t.id === activeTab)?.component || (activeTab === 'REPLAY' || activeTab === 'COPILOT' || activeTab === 'DEBRIEF' ? UnifiedDebriefTab : UavBlueprintTab);
  const SecondaryComponent = tabs.find(t => t.id === secondaryTab)?.component || (secondaryTab === 'REPLAY' || secondaryTab === 'COPILOT' || secondaryTab === 'DEBRIEF' ? UnifiedDebriefTab : MissionMapTab);

  const handleSwapPanes = () => {
    const temp = activeTab;
    setActiveTab(secondaryTab);
    setSecondaryTab(temp);
  };

  return (
    <div className="h-screen bg-[#02040A] text-slate-100 flex flex-col font-hud relative overflow-hidden selection:bg-cyan-400 selection:text-black">
      {/* 1. Starship Mission Deck Tactical Header */}
      <header className="starship-glass border-b border-cyan-500/20 px-4 py-2 flex flex-wrap items-center justify-between gap-3 shrink-0 z-50">
        {/* Left: Branding & UAV Metadata */}
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-400/60 flex items-center justify-center shadow-hud-cyan overflow-hidden group">
            <div className="absolute inset-0 bg-cyan-400/10 animate-ping opacity-40 rounded-lg pointer-events-none"></div>
            <Plane className="w-5 h-5 text-cyan-300 drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-black text-sm tracking-widest text-cyan-300 glow-cyan">
                GarudaTwin <span className="text-white/40 font-mono text-xs font-normal">//</span> Propulsion Intelligence
              </h1>
              <span className="text-[9px] font-mono px-2 py-0.5 bg-slate-900/90 border border-cyan-500/30 rounded-full text-cyan-200 tracking-wider shadow-sm">
                DO-178C
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
              <span>ROTAX 915/916 iS PROGNOSTICS</span>
              <span className="text-slate-600">•</span>
              <span className="text-cyan-400/90 font-bold tracking-wider">TAIL: VAHAK-1</span>
            </div>
          </div>
        </div>

        {/* Center: Live Mission Clock & Telemetry Ticker */}
        <div className="hidden xl:flex items-center gap-5 starship-glass-card px-4 py-1.5 rounded-full text-xs font-mono border border-cyan-500/25 shadow-starship-glass">
          <div className="flex items-center gap-2 text-slate-300">
            <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span className="text-cyan-300 font-bold">ZULU {missionClock}</span>
          </div>
          <div className="h-3.5 w-[1px] bg-slate-700/60"></div>
          <div className="text-slate-400">
            ALT <span className="text-white font-bold ml-1">{telemetry.mission.altitudeFt.toLocaleString()}</span> <span className="text-[10px] text-slate-500">FT</span>
          </div>
          <div className="h-3.5 w-[1px] bg-slate-700/60"></div>
          <div className="text-slate-400">
            AIRSPEED <span className="text-white font-bold ml-1">{telemetry.mission.airspeedKts}</span> <span className="text-[10px] text-slate-500">KTS</span>
          </div>
          <div className="h-3.5 w-[1px] bg-slate-700/60"></div>
          <div className="text-slate-400 flex items-center gap-1.5">
            <span>HEALTH</span>
            <span className={`font-mono font-black text-sm px-1.5 py-0.2 rounded ${
              isCritical ? 'text-red-400 bg-red-950/60 border border-red-500/50 glow-red' : 
              isDegraded ? 'text-amber-400 bg-amber-950/60 border border-amber-500/50 glow-amber' : 
              'text-emerald-400 bg-emerald-950/60 border border-emerald-500/50 glow-green'
            }`}>
              {health.index.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Right: Socket Status, Split View, Audio Alarm Toggle & Health Badge */}
        <div className="flex items-center gap-2.5">
          {/* AI Features Inspector Button */}
          <button
            onClick={() => setIsInspectorOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/20 hover:border-cyan-400 transition-all text-xs font-mono font-bold flex items-center gap-1.5 shadow-hud-cyan group"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400 group-hover:rotate-12 transition-transform" />
            <span className="hidden sm:inline">INSPECT AI FEATURES</span>
            <span className="px-1.5 py-0.2 rounded bg-cyan-400/20 text-cyan-200 text-[10px]">71</span>
          </button>

          {/* Split-Screen Dual Docking Toggle */}
          <button
            onClick={() => setIsDualDocked(!isDualDocked)}
            title={isDualDocked ? 'Switch to Single View (Hotkey: D)' : 'Enable Split-Screen Dual Docking (Hotkey: D)'}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono transition-all flex items-center gap-1.5 ${
              isDualDocked
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-hud-cyan font-bold'
                : 'bg-slate-900/80 text-slate-400 border-slate-700 hover:text-slate-200 hover:border-slate-500'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{isDualDocked ? 'DUAL DOCK' : 'SPLIT DOCK'}</span>
          </button>

          {/* Audio Alarm Toggle */}
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            title={audioEnabled ? 'Audio Alarms: Active' : 'Audio Alarms: Muted'}
            className={`p-2 rounded-lg border text-xs font-mono transition-colors flex items-center gap-1 ${
              audioEnabled
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/60 shadow-sm shadow-cyan-500/20'
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {/* Replay Mode Indicator Badge if active */}
          {isReplayMode && (
            <button
              onClick={() => setActiveTab('REPLAY')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-950/80 border border-purple-500/60 text-purple-300 text-xs font-mono font-bold animate-pulse shadow-sm shadow-purple-900/40"
              title="Mission Replay Active - Click to view PFA Tab"
            >
              <RotateCcw className="w-3.5 h-3.5 text-purple-400" />
              <span>REPLAY TIME-TRAVEL</span>
            </button>
          )}

          {/* Connection Status */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs font-mono shadow-inner">
            <Radio className={`w-3.5 h-3.5 ${isConnected ? 'text-emerald-400 animate-pulse' : 'text-amber-400 animate-pulse'}`} />
            <span className={isConnected ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
              {isConnected ? 'CAN 100 Hz' : 'INTERNAL BRIDGE'}
            </span>
          </div>

          {/* Overall Health Status Badge */}
          <div className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 border transition-all ${
            isCritical
              ? 'bg-red-950/90 border-red-500 text-red-300 animate-pulse shadow-hud-red'
              : isDegraded
              ? 'bg-amber-950/90 border-amber-500 text-amber-300 shadow-hud-amber'
              : 'bg-emerald-950/90 border-emerald-500 text-emerald-300 shadow-hud-green'
          }`}>
            {isCritical ? <ShieldAlert className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span className="tracking-wider">{health.status}</span>
          </div>
        </div>
      </header>

      {/* 2. Starship Active Alert Banner */}
      {(isCritical || isDegraded) && (
        <div className={`px-4 py-2 flex items-center justify-between text-xs font-mono border-b backdrop-blur-lg ${
          isCritical
            ? 'bg-red-950/90 text-red-100 border-red-500/80 animate-pulse shadow-lg shadow-red-950/50'
            : 'bg-amber-950/90 text-amber-100 border-amber-500/80 shadow-md shadow-amber-950/40'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1 rounded ${isCritical ? 'bg-red-500 text-black' : 'bg-amber-500 text-black'}`}>
              <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />
            </div>
            <span className="font-bold tracking-wide">{health.alertMessage}</span>
          </div>
          <button 
            onClick={() => setActiveTab('MISSION_MAP')}
            className="font-bold underline flex items-center gap-1 px-3 py-1 rounded bg-black/40 hover:bg-black/60 border border-white/20 transition-all text-xs"
          >
            <span>VIEW AUTONOMOUS RL REPLAN</span>
            <span className="text-cyan-300">→</span>
          </button>
        </div>
      )}

      {/* 3. Starship Futuristic Top Tab Navigation */}
      <nav className="starship-glass border-b border-white/[0.08] px-4 py-1.5 flex items-center justify-between gap-2 shrink-0 overflow-x-auto custom-scrollbar">
        <div className="flex items-center gap-1.5">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const isSecondary = isDualDocked && secondaryTab === tab.id;
            const Icon = tab.icon;
            const hasAlert = (tab.id === 'PROGNOSTICS' || tab.id === 'MISSION_MAP') && (isCritical || isDegraded);

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group relative py-2 px-3 rounded-lg text-xs font-mono whitespace-nowrap transition-all flex items-center gap-2 border ${
                  isActive
                    ? 'border-cyan-400/80 text-cyan-200 font-bold bg-gradient-to-b from-cyan-500/20 to-cyan-600/5 shadow-starship-glow'
                    : isSecondary
                    ? 'border-purple-500/60 text-purple-300 font-bold bg-purple-500/10'
                    : 'border-transparent text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-3.5 h-3.5 transition-colors ${
                    isActive ? 'text-cyan-300' : isSecondary ? 'text-purple-300' : 'text-slate-500 group-hover:text-slate-300'
                  }`} />
                  {hasAlert && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                  )}
                </div>

                <span>{tab.label}</span>

                {/* Hotkey Tag */}
                <span className={`text-[9px] font-mono px-1 rounded transition-opacity ${
                  isActive 
                    ? 'bg-cyan-400/20 text-cyan-300 font-bold' 
                    : 'bg-slate-900/60 text-slate-500 group-hover:text-slate-400'
                }`}>
                  {tab.hotkey}
                </span>

                {/* Secondary Dock Indicator */}
                {isSecondary && (
                  <span className="text-[8px] font-mono px-1 rounded bg-purple-500/30 text-purple-200 border border-purple-400/40">
                    DOCKED
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Dual Dock Status / Quick Selector */}
        {isDualDocked && (
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono pl-3 border-l border-white/10">
            <span className="text-slate-400 text-[11px]">DOCK:</span>
            <select
              value={secondaryTab}
              onChange={(e) => setSecondaryTab(e.target.value)}
              className="bg-slate-950 text-purple-300 border border-purple-500/40 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-purple-400"
            >
              {tabs.map(t => (
                <option key={t.id} value={t.id} disabled={t.id === activeTab}>
                  {t.label}
                </option>
              ))}
            </select>
            <button 
              onClick={handleSwapPanes}
              title="Swap Left and Right Viewports"
              className="p-1 rounded bg-slate-900 text-slate-300 hover:text-cyan-300 hover:bg-slate-800 border border-slate-700 transition-colors"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </nav>

      {/* 4. Main Active Content View Container (Single View or Split-Screen Dual Docking) */}
      <main className="flex-1 min-h-0 p-3 overflow-hidden relative">
        {isDualDocked ? (
          <div className="flex flex-col lg:flex-row h-full gap-3 overflow-hidden">
            {/* Primary Viewport Pane */}
            <div className="flex-1 flex flex-col h-full overflow-hidden starship-dock-pane rounded-xl p-2.5 relative border border-cyan-500/30">
              <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-white/[0.08] text-xs font-mono shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                  <span className="text-cyan-300 font-bold">PRIMARY: {tabs.find(t => t.id === activeTab)?.label}</span>
                </div>
                <button
                  onClick={() => setIsDualDocked(false)}
                  title="Maximize to Single View"
                  className="p-1 rounded text-slate-400 hover:text-cyan-300 transition-colors"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden relative">
                <ActiveComponent />
              </div>
            </div>

            {/* Secondary Docked Viewport Pane */}
            <div className="flex-1 flex flex-col h-full overflow-hidden starship-dock-pane rounded-xl p-2.5 relative border border-purple-500/30">
              <div className="flex items-center justify-between px-2 pb-2 mb-2 border-b border-white/[0.08] text-xs font-mono shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                  <span className="text-purple-300 font-bold">DOCKED: {tabs.find(t => t.id === secondaryTab)?.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={secondaryTab}
                    onChange={(e) => setSecondaryTab(e.target.value)}
                    className="bg-slate-950 text-purple-200 border border-purple-500/40 rounded px-1.5 py-0.5 text-[11px] font-mono focus:outline-none"
                  >
                    {tabs.map(t => (
                      <option key={t.id} value={t.id} disabled={t.id === activeTab}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setIsDualDocked(false)}
                    title="Close Dock"
                    className="p-1 rounded text-slate-400 hover:text-red-400 transition-colors"
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

      {/* 5. AI Features & RUL Inspector Modal */}
      <FeaturesInspectorModal isOpen={isInspectorOpen} onClose={() => setIsInspectorOpen(false)} />
    </div>
  );
}


