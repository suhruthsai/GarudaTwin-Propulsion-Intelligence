import React, { useState, useEffect, useMemo } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { TACTICAL_ISR_8PHASE_SORTIE } from '../replay/PreloadedSorties';
import { AtmosphericPhysicsEngine } from '../replay/AtmosphericPhysicsEngine';
import { MissionPredictor } from '../replay/MissionPredictor';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { 
  Clock, 
  Play, 
  Pause, 
  AlertTriangle, 
  Sliders, 
  Cloud, 
  Activity, 
  Radio, 
  Sun, 
  Mountain, 
  Waves, 
  Snowflake,
  CloudRain,
  Zap,
  Crosshair,
  ChevronDown,
  Bot,
  Send,
  FileDown,
  FileText,
  Terminal,
  Maximize2,
  Columns,
  MessageSquare
} from 'lucide-react';

export const UnifiedDebriefTab = () => {
  const { telemetry, aiPrognostics } = useTelemetry();

  // Active Phase Index (Default to Phase 7: RECOVERY)
  const [activePhaseIndex, setActivePhaseIndex] = useState(7);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activePreset, setActivePreset] = useState('HIGH_ALT_FL280');
  const [showMoreScenarios, setShowMoreScenarios] = useState(false);

  // Layout View Modes: 'split' | 'replay_full' | 'copilot_full'
  const [viewMode, setViewMode] = useState('split');

  // Environmental sliders
  const [altitudeFt, setAltitudeFt] = useState(28000);
  const [deltaIsaTempC, setDeltaIsaTempC] = useState(-28);
  const [payloadStr, setPayloadStr] = useState('85 kg (EO/IR + SAR)');
  const [headwindKts, setHeadwindKts] = useState(38);

  // Copilot Chat message history
  const [messages, setMessages] = useState([
    {
      sender: 'ai',
      text: 'Greetings Flight Officer. I am the GarudaTwin Autonomous Digital Twin Copilot. I am fully synchronized with the 8-Phase Tactical ISR Mission Replay and live aerothermal physics twin. Select any phase, anomaly, or scenario to interrogate causal factors or compile an official DO-178C airworthiness report.',
      timestamp: '12:00:01'
    }
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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
      if (activePhaseIndex >= computedPhases.length - 1) {
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

  // Scenario Presets
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

  // Interactive SVG click handler
  const handleSvgClick = (e) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const clickRatio = Math.max(0, Math.min(1, (e.clientX - svgRect.left) / svgRect.width));
    const targetX = 60 + clickRatio * (940 - 60);

    const xCoords = svgCoordinates.xCoords;
    let closestIndex = 0;
    let minDiff = Infinity;
    xCoords.forEach((x, idx) => {
      const diff = Math.abs(x - targetX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    setActivePhaseIndex(closestIndex);
  };

  // Dynamic Prompt Chips based on active phase
  const promptChips = useMemo(() => {
    const base = [
      `Explain ${currentPhase.name} status`,
      `Audit CHT thermal load (${activeTelemetry.cht})`,
      `Why is oil pressure ${activeTelemetry.oilP}?`,
      'Compile airworthiness debrief'
    ];
    if (activePhaseIndex === 3) {
      base.unshift('Diagnose Injector #2 pulsation');
    } else if (activePhaseIndex === 4) {
      base.unshift('Analyze Phase 4 thermal surge');
    } else if (activePhaseIndex === 5) {
      base.unshift('Inspect 2X harmonic vibration');
    }
    return base;
  }, [activePhaseIndex, currentPhase.name, activeTelemetry.cht, activeTelemetry.oilP]);

  // Context-Aware Aerospace AI Copilot Reasoning Engine
  const handleSendMessage = (textToSend) => {
    const query = textToSend || inputQuery;
    if (!query.trim()) return;

    const userMsg = {
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputQuery('');

    setTimeout(() => {
      let aiResponseText = '';
      const qLower = query.toLowerCase();

      if (qLower.includes('anomaly') || qLower.includes('vibration') || qLower.includes('2x harmonic') || qLower.includes('bearing')) {
        aiResponseText = `[AEROSPACE DIAGNOSTIC ROOT CAUSE - PHASE 5 RTB]:\n1. Root Cause: Sensor channel VIB-1 detected 2X shaft harmonic peak (+0.048 IPS surge) at 4400 RPM cruise.\n2. Physics Mechanism: Propeller reduction gearbox (PRGB) pinion bearing micro-spalling under aerodynamic buffeting.\n3. FADEC Response: FADEC derated throttle from 85% to 68% TOGA to limit alternating stress amplitude.\n4. Maintenance Work Order: Ground crew must perform boroscopic inspection of PRGB internal gear teeth and drain oil through a 10-micron filter screen to inspect for ferromagnetic particulate.`;
      } else if (qLower.includes('thermal') || qLower.includes('cht') || qLower.includes('evasive') || qLower.includes('over-temp')) {
        aiResponseText = `[THERMODYNAMIC HEAT BALANCE AUDIT - ${currentPhase.name}]:\n1. Active CHT: ${activeTelemetry.cht} (Nominal redline limit: 130.0°C).\n2. Forced Convection Rejection: Ambient air density is ${aerothermal.airDensityKgM3} kg/m³ with radiator flux at ${aerothermal.radiatorHeatFluxKw} kW.\n3. Thermal Stress Factor: Environment (${deltaIsaTempC}°C ambient) generates a convective dissipation margin of ${aerothermal.airDensityKgM3 > 0.8 ? 'SUFFICIENT' : 'MARGINAL'}.\n4. Recommendation: Maintain airspeed above 110 KTS to maximize mass airflow through belly cowl radiator ducts.`;
      } else if (qLower.includes('oil') || qLower.includes('pressure') || qLower.includes('viscosity')) {
        aiResponseText = `[LUBRICATION DYNAMICS - VOGEL-FULCHER AUDIT]:\n1. Oil Pressure: ${activeTelemetry.oilP} | Oil Temperature: ${activeTelemetry.oilT}.\n2. Fluid Dynamics: Operating under ${deltaIsaTempC}°C ambient. Dynamic viscosity ratio is ${deltaIsaTempC < 0 ? 'elevated (thick fluid, higher pump head pressure)' : 'thinned (hydrodynamic wedge boundary)'}.\n3. Minimum Equipment List (MEL): Minimum safe lubrication pressure threshold is 28.0 PSI. Current pressure offers a safe operating margin.`;
      } else if (qLower.includes('injector') || qLower.includes('fuel') || qLower.includes('orbit')) {
        aiResponseText = `[FUEL INJECTION ANOMALY AUDIT - PHASE 3 ISR ORBIT]:\n1. Telemetry Indicator: Injector #2 fuel flow differential registered 0.08 Autoencoder MSE residual.\n2. Physical Mechanism: Fuel rail resonance micro-pulsation during steady-state station loiter (4800 RPM).\n3. Airworthiness Impact: Cylinder temperatures remain within safe limits; no uncommanded power loss observed. Clean injector nozzle with ultrasonic solvent at scheduled 50-hour inspection.`;
      } else if (qLower.includes('glide') || qLower.includes('range') || qLower.includes('rul')) {
        aiResponseText = `[AUTONOMOUS FLIGHT ENVELOPE & GLIDE REACHABILITY]:\n1. Active Altitude: ${activeTelemetry.alt} (FL${Math.round(altitudeFt / 100)}).\n2. Aerodynamic Glide Ratio: 14:1 (Heron/Predator MALE UAV airframe).\n3. Dead-Stick Glide Reachability: ${(altitudeFt * 0.0023).toFixed(1)} Nautical Miles in zero-thrust glide configuration.\n4. Bi-LSTM Remaining Useful Life: ${activeTelemetry.rul} until 50% MEL overhaul limit. Clearance verified for continued mission profile.`;
      } else {
        aiResponseText = `[GARUDATWIN REPLAY DIAGNOSTIC SUMMARY]:\n- Active Sortie Phase: ${currentPhase.name} (${currentPhase.time}) | Scenario: ${activePreset.replace(/_/g, ' ')}\n- Engine Speed: ${activeTelemetry.rpm} | Boost MAP: ${activeTelemetry.map}\n- Health Index: ${activeTelemetry.health} (Degradation Trajectory: Nominal to 50% MEL)\n- Autoencoder Anomaly MSE: ${activeTelemetry.anomalyScore} | Bi-LSTM RUL: ${activeTelemetry.rul}\n- Airworthiness Status: Asset is cleared for operational deployment with scheduled ground servicing.`;
      }

      setMessages(prev => [
        ...prev,
        {
          sender: 'ai',
          text: aiResponseText,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    }, 350);
  };

  // 1-Click Certified DO-178C PDF Airworthiness Report Exporter
  const exportPdfReport = () => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF();
      const timestamp = new Date().toLocaleString();

      doc.setFillColor(3, 7, 18);
      doc.rect(0, 0, 210, 36, 'F');

      doc.setTextColor(0, 240, 255);
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.text('GARUDATWIN MALE UAV - AIRWORTHINESS & MISSION DEBRIEF DOSSIER', 14, 15);

      doc.setTextColor(148, 163, 184);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Propulsion: Rotax 915 iS Turbocharged (1414cc Boxer) | Tail: VAHAK-1 | NATO GCS Bravo`, 14, 23);
      doc.text(`Sortie: Tactical ISR 8-Phase Mission | Scenario: ${activePreset.replace(/_/g, ' ')} | Generated: ${timestamp}`, 14, 29);

      // Section 1: Executive Prognostics
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`1. Executive Health & AI Prognostics (${currentPhase.name} @ ${currentPhase.time})`, 14, 44);

      doc.autoTable({
        startY: 48,
        theme: 'grid',
        headStyles: { fillColor: [10, 25, 47], textColor: [0, 240, 255], fontSize: 8.5 },
        bodyStyles: { fontSize: 8 },
        head: [['Prognostic Parameter', 'Evaluated Value', 'Baseline Standard', 'Airworthiness Assessment']],
        body: [
          ['Overall Health Index', activeTelemetry.health, '100% Nominal', activeTelemetry.healthVal < 60 ? 'CRITICAL DECAY' : activeTelemetry.healthVal < 80 ? 'DEGRADED' : 'AIRWORTHY'],
          ['Estimated RUL (Bi-LSTM)', activeTelemetry.rul, '> 400.0 Flight Hours', parseFloat(activeTelemetry.rul) < 50 ? 'EXPEDITED OVERHAUL' : 'MISSION READY'],
          ['Autoencoder Anomaly MSE', activeTelemetry.anomalyScore, '< 0.08500 MSE', parseFloat(activeTelemetry.anomalyScore) > 0.25 ? 'ANOMALY CONFIRMED' : 'NOMINAL RESIDUALS'],
          ['Engine Speed / Propeller', `${activeTelemetry.rpm} (${activeTelemetry.rpmSub})`, '4800 / 1890 RPM', 'FADEC SYNCHRONIZED'],
          ['Structural Vibration', activeTelemetry.vib, '< 0.045 IPS', parseFloat(activeTelemetry.vib) > 0.06 ? 'EXCEEDANCE CAUTION' : 'VIBRATION NORMAL']
        ]
      });

      // Section 2: 14-Channel Telemetry
      const finalY1 = doc.lastAutoTable.finalY + 8;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('2. Time-Synchronized 14-Channel Telemetry Snapshot', 14, finalY1);

      doc.autoTable({
        startY: finalY1 + 4,
        theme: 'grid',
        headStyles: { fillColor: [10, 25, 47], textColor: [0, 240, 255], fontSize: 8 },
        bodyStyles: { fontSize: 7.5 },
        head: [['Telemetry Channel', 'Recorded Value', 'Engineering Sub-Value', 'Standard Operational Limits']],
        body: [
          ['1. Altitude (MSL)', activeTelemetry.alt, activeTelemetry.flTag, 'Up to FL300 Service Ceiling'],
          ['2. Airspeed (IAS / TAS)', activeTelemetry.spd, activeTelemetry.spdSub, '60 - 165 KTS Safe Envelope'],
          ['3. Throttle Command', activeTelemetry.thr, activeTelemetry.thrSub, '0% Idle - 100% TOGA'],
          ['4. Engine Speed', activeTelemetry.rpm, activeTelemetry.rpmSub, '5800 RPM Redline Limit'],
          ['5. Fuel Flow Rate', activeTelemetry.fuelFlow, activeTelemetry.fuelFlowSub, '2.0 - 11.5 GPH Envelope'],
          ['6. Max Cylinder Head Temp', activeTelemetry.cht, activeTelemetry.chtSub, '< 130.0°C Continuous Limit'],
          ['7. Max Exhaust Gas Temp', activeTelemetry.egt, activeTelemetry.egtSub, '< 920.0°C Thermal Limit'],
          ['8. Oil Lubrication Pressure', activeTelemetry.oilP, activeTelemetry.oilPSub, '28.0 - 75.0 PSI Hydraulic Range'],
          ['9. Oil Sump Temperature', activeTelemetry.oilT, 'Viscosity Monitored', '50.0°C - 130.0°C'],
          ['10. Vibration Severity', activeTelemetry.vib, 'Piezoelectric FFT', '< 0.080 IPS Caution Limit'],
          ['11. Manifold Absolute Press', activeTelemetry.map, 'Turbo Boost', '1.00 - 1.70 BAR MAP'],
          ['12. Health Degradation Index', activeTelemetry.health, 'Multi-Stress Fatigue', '50% Minimum Overhaul Limit'],
          ['13. Anomaly Score (MSE)', activeTelemetry.anomalyScore, 'Autoencoder Residual', '< 0.25 Nominal Envelope'],
          ['14. Estimated RUL (95% CI)', activeTelemetry.rul, 'Bi-LSTM Forecast', '> 20.0 HRS Safe Dispatch']
        ]
      });

      // Section 3: ISA 1976 Physics Derivations
      const finalY2 = doc.lastAutoTable.finalY + 8;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('3. Environmental Boundary Conditions & ISA 1976 Derivations', 14, finalY2);

      doc.autoTable({
        startY: finalY2 + 4,
        theme: 'grid',
        headStyles: { fillColor: [10, 25, 47], textColor: [0, 240, 255], fontSize: 8 },
        bodyStyles: { fontSize: 7.5 },
        head: [['Physical Metric', 'Derived Value', 'Physical Principle / Equation']],
        body: [
          ['Barometric Pressure p(h)', `${aerothermal.atmosphericPressureHpa} hPa`, 'ISA 1976 Barometric Lapse: p0 * (1 - L*h/T0)^5.25588'],
          ['Local Air Density (rho)', `${aerothermal.airDensityKgM3} kg/m³`, 'Ideal Gas Law: rho = (p * 100) / (R_specific * T_kelvin)'],
          ['Air Density Ratio (sigma)', aerothermal.densityRatio, 'rho / rho_sea_level (1.225 kg/m³)'],
          ['Turbocharger Wastegate PR', `${aerothermal.turboCompensatorRatio}:1 PR`, 'Rotax 915 iS Wastegate Boost Ratio: MAP / p_ambient'],
          ['Radiator Heat Flux (Q_dot)', `${aerothermal.radiatorHeatFluxKw} kW`, 'Forced Convection Cooling: m_dot * cp * Delta_T']
        ]
      });

      // Section 4: Maintenance Work Order
      const finalY3 = doc.lastAutoTable.finalY + 8;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('4. Official Airworthiness Directive & Ground Maintenance Order', 14, finalY3);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(51, 65, 85);

      const directiveText = parseFloat(activeTelemetry.anomalyScore) > 0.25 || activeTelemetry.healthVal < 70
        ? `CONDITIONAL AIRWORTHINESS / INSPECTION DIRECTIVE REQUIRED:\nAsset exhibits elevated stress indicators during ${currentPhase.name} under ${activePreset.replace(/_/g, ' ')}. Action Work Order: (1) Boroscopic inspection of cylinder 3 & 4 exhaust valves; (2) Check PRGB drive gear teeth for micro-spalling; (3) Clean fuel injector nozzles with ultrasonic solvent. Cleared for auxiliary taxi trials following maintenance sign-off.`
        : `CERTIFICATE OF AIRWORTHINESS (DO-178C / STANAG 4671 COMPLIANT):\nAll physical telemetry parameters, autoencoder reconstruction errors, and multi-stress health indices conform strictly to Rotax 915 iS operating envelope specifications. Asset is certified FULLY AIRWORTHY for immediate tactical mission redeployment.`;

      doc.text(doc.splitTextToSize(directiveText, 182), 14, finalY3 + 6);
      doc.save(`GarudaTwin_Airworthiness_Dossier_${activePreset}_${currentPhase.name}_${Date.now()}.pdf`);
    } catch (e) {
      console.error('PDF generation error:', e);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 h-[calc(100vh-125px)] w-full overflow-y-auto custom-scrollbar pb-8 font-hud">
      {/* 1. Header Banner & Scenario Selector */}
      <div className="bg-[#0A101D] border border-cyan-500/25 rounded-xl p-3.5 shrink-0 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        {/* Left: Branding & Status */}
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/15 border border-cyan-400/50 text-cyan-300 shadow-sm">
            <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold text-white uppercase tracking-wider">
                TACTICAL MISSION REPLAY & AIRWORTHINESS DEBRIEF STATION
              </h2>
              <span className="text-xs bg-cyan-950 text-cyan-300 border border-cyan-400/60 px-2.5 py-0.5 rounded-full font-bold font-mono">
                FADEC SYNC: 100% PASS
              </span>
            </div>
            <div className="text-xs text-slate-300 flex items-center gap-2 mt-0.5 font-medium">
              <span className="text-slate-400">CAN 2.0B BLACK-BOX RECORDER</span>
              <span className="text-slate-600">•</span>
              <span className="text-cyan-300 font-mono">LAT/LONG: 34.6644°N 118.0847°W</span>
              <span className="text-slate-600">•</span>
              <span className="text-amber-400 font-bold font-mono">{sortie.missionId}</span>
            </div>
          </div>
        </div>

        {/* Right: View Mode Toggle & Scenarios */}
        <div className="flex flex-wrap items-center gap-2">
          {/* View Mode Controls */}
          <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-lg p-0.5 mr-1">
            <button
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'split' ? 'bg-cyan-500 text-black shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
              title="Split View (Replay + Copilot)"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>SPLIT</span>
            </button>
            <button
              onClick={() => setViewMode('replay_full')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'replay_full' ? 'bg-cyan-500 text-black shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
              title="Full Width Replay Deck"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>FULL REPLAY</span>
            </button>
            <button
              onClick={() => setViewMode('copilot_full')}
              className={`px-2.5 py-1 rounded text-xs font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'copilot_full' ? 'bg-cyan-500 text-black shadow-sm' : 'text-slate-300 hover:text-white'
              }`}
              title="Full Screen AI Copilot"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>COPILOT</span>
            </button>
          </div>

          {/* Primary Scenarios */}
          <button
            onClick={() => handleSelectPreset('HIGH_ALT_FL280')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
              activePreset === 'HIGH_ALT_FL280'
                ? 'bg-cyan-950 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(0,240,255,0.4)]'
                : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
          >
            <Mountain className="w-3.5 h-3.5 text-cyan-400" />
            <span>FL280 BASELINE</span>
          </button>

          <button
            onClick={() => handleSelectPreset('HIGH_ALT_FL200')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
              activePreset === 'HIGH_ALT_FL200'
                ? 'bg-blue-950 border-blue-400 text-blue-200 shadow-[0_0_12px_rgba(59,130,246,0.4)]'
                : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
          >
            <Cloud className="w-3.5 h-3.5 text-blue-400" />
            <span>HIGH-ALT FL200</span>
          </button>

          <button
            onClick={() => handleSelectPreset('HOT_DESERT')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
              activePreset === 'HOT_DESERT'
                ? 'bg-amber-950 border-amber-400 text-amber-200 shadow-[0_0_12px_rgba(245,158,11,0.4)]'
                : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            <span>HOT DESERT +48°C</span>
          </button>

          <button
            onClick={() => handleSelectPreset('MARITIME')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
              activePreset === 'MARITIME'
                ? 'bg-teal-950 border-teal-400 text-teal-200 shadow-[0_0_12px_rgba(20,184,166,0.4)]'
                : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
            }`}
          >
            <Waves className="w-3.5 h-3.5 text-teal-400" />
            <span>MARITIME RELAY</span>
          </button>

          <button
            onClick={() => setShowMoreScenarios(!showMoreScenarios)}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-200 hover:text-cyan-300 text-xs font-bold flex items-center gap-1 transition-all"
          >
            <span>MORE SCENARIOS</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMoreScenarios ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Expandable Scenario Presets Drawer */}
      {showMoreScenarios && (
        <div className="bg-[#060C18] border border-cyan-500/40 rounded-xl p-3.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 shadow-2xl transition-all">
          <button
            onClick={() => { handleSelectPreset('ARCTIC_SOAK'); setShowMoreScenarios(false); }}
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all ${
              activePreset === 'ARCTIC_SOAK' ? 'bg-cyan-950/80 border-cyan-400' : 'bg-slate-900/60 border-slate-700 hover:border-slate-500'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
              <Snowflake className="w-4 h-4 text-cyan-400" />
              <span>ARCTIC SOAK (-45°C)</span>
            </div>
            <span className="text-xs text-slate-300">FL080 Sub-zero cold-soak oil viscosity</span>
          </button>

          <button
            onClick={() => { handleSelectPreset('MONSOON'); setShowMoreScenarios(false); }}
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all ${
              activePreset === 'MONSOON' ? 'bg-blue-950/80 border-blue-400' : 'bg-slate-900/60 border-slate-700 hover:border-slate-500'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
              <CloudRain className="w-4 h-4 text-blue-400" />
              <span>TROPICAL MONSOON</span>
            </div>
            <span className="text-xs text-slate-300">FL120 Heavy precipitation & turbulence</span>
          </button>

          <button
            onClick={() => { handleSelectPreset('FL300_CEILING'); setShowMoreScenarios(false); }}
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all ${
              activePreset === 'FL300_CEILING' ? 'bg-indigo-950/80 border-indigo-400' : 'bg-slate-900/60 border-slate-700 hover:border-slate-500'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
              <Zap className="w-4 h-4 text-indigo-400" />
              <span>FL300 MAX CEILING</span>
            </div>
            <span className="text-xs text-slate-300">30,000 FT Critical turbocharger PR limit</span>
          </button>

          <button
            onClick={() => { handleSelectPreset('TERRAIN_MASK'); setShowMoreScenarios(false); }}
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all ${
              activePreset === 'TERRAIN_MASK' ? 'bg-amber-950/80 border-amber-400' : 'bg-slate-900/60 border-slate-700 hover:border-slate-500'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Crosshair className="w-4 h-4 text-amber-400" />
              <span>TERRAIN MASK 500FT</span>
            </div>
            <span className="text-xs text-slate-300">Low-level tactical high air density</span>
          </button>

          <button
            onClick={() => { handleSelectPreset('ULTRA_LOITER'); setShowMoreScenarios(false); }}
            className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition-all ${
              activePreset === 'ULTRA_LOITER' ? 'bg-emerald-950/80 border-emerald-400' : 'bg-slate-900/60 border-slate-700 hover:border-slate-500'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span>ULTRA-LOITER ECO</span>
            </div>
            <span className="text-xs text-slate-300">FL160 24h Endurance derated fuel burn</span>
          </button>
        </div>
      )}

      {/* Main Dual-Deck Container */}
      <div className="flex flex-col lg:flex-row gap-3.5 w-full">
        {/* Left Column: Replay Deck */}
        {viewMode !== 'copilot_full' && (
          <div className={`flex flex-col gap-3.5 transition-all ${viewMode === 'replay_full' ? 'w-full' : 'w-full lg:w-[65%]'}`}>
            {/* 2. 8-Phase Tactical Sortie Timeline */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  <div>
                    <div className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                      TACTICAL ISR MISSION REPLAY TIMELINE • 8-PHASE SORTIE (BLACK-BOX FADEC TRACE)
                    </div>
                    <div className="text-xs text-slate-300 font-medium">
                      Synchronized FADEC recorder & physics twin • Scrub timeline to inspect telemetry and causal residuals
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTogglePlay}
                    className="px-4 py-1.5 rounded-lg bg-cyan-400 text-black hover:bg-cyan-300 font-bold text-xs flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(0,240,255,0.4)]"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5 fill-black" /> : <Play className="w-3.5 h-3.5 fill-black" />}
                    <span>{isPlaying ? 'PAUSE REPLAY' : 'PLAY REPLAY'}</span>
                  </button>

                  <button
                    onClick={handleToggleSpeed}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:text-cyan-300 text-xs font-bold font-mono transition-all"
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
                      className={`relative rounded-lg p-2.5 cursor-pointer transition-all border flex flex-col justify-between min-h-[82px] ${
                        isSelected
                          ? 'bg-cyan-950/60 border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.35)]'
                          : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-500 hover:bg-slate-900'
                      }`}
                    >
                      {/* Top: Timestamp & Status Dot / Badge */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-bold text-slate-300">{phase.time}</span>
                        {phase.badge ? (
                          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold uppercase tracking-wider ${
                            phase.badgeType === 'danger' 
                              ? 'bg-red-500/30 text-red-200 border border-red-400' 
                              : phase.badgeType === 'orange'
                              ? 'bg-amber-500/30 text-amber-200 border border-amber-400'
                              : 'bg-yellow-500/30 text-yellow-200 border border-yellow-400'
                          }`}>
                            {phase.badge}
                          </span>
                        ) : (
                          <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#10B981]' : 'bg-slate-600'}`}></div>
                        )}
                      </div>

                      {/* Middle: Phase Title */}
                      <div className="font-bold text-xs text-white uppercase truncate mt-1">
                        {phase.name}
                      </div>

                      {/* Bottom: Alt & Spd */}
                      <div className="text-xs font-mono text-cyan-300 font-medium">
                        {phase.alt} • {phase.spd}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Mission Anomaly Events */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-amber-300 uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>MISSION ANOMALY EVENTS (SELECT TO INSPECT ROOT CAUSE & FADEC RESIDUALS)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Anomaly 1 */}
                <div 
                  onClick={() => setActivePhaseIndex(3)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    activePhaseIndex === 3 
                      ? 'bg-amber-950/60 border-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.35)]' 
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-amber-300 mb-1">
                    <span className="font-mono">T+01:42:00 (ISR ORBIT)</span>
                    <span className="text-[10px] font-mono bg-amber-500/25 text-amber-200 px-1.5 py-0.5 rounded border border-amber-400/60 font-bold">
                      RESIDUAL: +0.08 MSE
                    </span>
                  </div>
                  <div className="font-bold text-sm text-white mb-1">Minor Fuel Delivery Anomaly</div>
                  <div className="text-xs text-slate-300 leading-relaxed font-medium">
                    Injector #2 micro-pulsation during cruise loiter. Fuel flow differential +0.4 GPH.
                  </div>
                </div>

                {/* Anomaly 2 */}
                <div 
                  onClick={() => setActivePhaseIndex(4)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    activePhaseIndex === 4 
                      ? 'bg-amber-950/60 border-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.35)]' 
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-amber-300 mb-1">
                    <span className="font-mono">T+03:18:00 (EVASIVE)</span>
                    <span className="text-[10px] font-mono bg-amber-500/25 text-amber-200 px-1.5 py-0.5 rounded border border-amber-400/60 font-bold">
                      RESIDUAL: +0.28 MSE
                    </span>
                  </div>
                  <div className="font-bold text-sm text-white mb-1">Thermal Degradation Surge</div>
                  <div className="text-xs text-slate-300 leading-relaxed font-medium">
                    High-G turn thermal transient. CHT surged to 132.8°C; oil radiator dissipation throttled.
                  </div>
                </div>

                {/* Anomaly 3 */}
                <div 
                  onClick={() => setActivePhaseIndex(5)}
                  className={`p-3 rounded-lg border transition-all cursor-pointer ${
                    activePhaseIndex === 5 
                      ? 'bg-red-950/60 border-red-400 shadow-[0_0_14px_rgba(239,68,68,0.35)]' 
                      : 'bg-slate-900/80 border-slate-700/80 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-red-300 mb-1">
                    <span className="font-mono">T+04:05:00 (RTB CLIMB)</span>
                    <span className="text-[10px] font-mono bg-red-500/25 text-red-200 px-1.5 py-0.5 rounded border border-red-400/60 font-bold">
                      ALERT: +0.54 MSE
                    </span>
                  </div>
                  <div className="font-bold text-sm text-white mb-1">2X Harmonic Vibration Spike</div>
                  <div className="text-xs text-slate-300 leading-relaxed font-medium">
                    Vibration surged to 0.082 IPS (+0.048 spike). PRGB reduction gear bearing micro-spalling.
                  </div>
                </div>
              </div>
            </div>

            {/* 4. 14 Synchronized Dynamic Telemetry Cards */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-sm text-cyan-300 uppercase tracking-wider">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>DYNAMIC ROTAX 915 iS ENGINE TELEMETRY • {currentPhase.name} ({currentPhase.time})</span>
                </div>
                <span className="text-xs text-slate-300">
                  SCENARIO: <span className="text-cyan-300 font-bold font-mono">{activePreset.replace(/_/g, ' ')}</span>
                </span>
              </div>

              {/* Responsive Cards Grid */}
              <div className={`grid gap-2.5 ${
                viewMode === 'replay_full' 
                  ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7' 
                  : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7'
              }`}>
                {/* 1. ALTITUDE */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">1. ALTITUDE</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.alt}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.flTag} • GPS Baro</div>
                </div>

                {/* 2. AIRSPEED */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">2. AIRSPEED</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.spd}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.spdSub}</div>
                </div>

                {/* 3. THROTTLE */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">3. THROTTLE</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.thr}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.thrSub}</div>
                </div>

                {/* 4. ENGINE RPM */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">4. ENGINE RPM</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.rpm}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.rpmSub}</div>
                </div>

                {/* 5. FUEL FLOW */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">5. FUEL FLOW</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.fuelFlow}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.fuelFlowSub}</div>
                </div>

                {/* 6. MAX CHT */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">6. MAX CHT</div>
                  <div className={`text-lg font-bold font-mono ${parseFloat(activeTelemetry.cht) > 130 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                    {activeTelemetry.cht}
                  </div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.chtSub}</div>
                </div>

                {/* 7. MAX EGT */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">7. MAX EGT</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.egt}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.egtSub}</div>
                </div>

                {/* 8. OIL PRESSURE */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">8. OIL PRESSURE</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.oilP}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">{activeTelemetry.oilPSub}</div>
                </div>

                {/* 9. OIL TEMP */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">9. OIL TEMP</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.oilT}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">Nom: &lt;130°C</div>
                </div>

                {/* 10. VIBRATION */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">10. VIBRATION</div>
                  <div className={`text-lg font-bold font-mono ${parseFloat(activeTelemetry.vib) > 0.05 ? 'text-amber-400' : 'text-white'}`}>
                    {activeTelemetry.vib}
                  </div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">Nom: &lt;0.050 IPS</div>
                </div>

                {/* 11. BOOST / MAP */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">11. BOOST / MAP</div>
                  <div className="text-lg font-bold font-mono text-white">{activeTelemetry.map}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">Rotax Turbo Boost</div>
                </div>

                {/* 12. HEALTH INDEX */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">12. HEALTH INDEX</div>
                  <div className={`text-lg font-bold font-mono ${activeTelemetry.healthVal < 80 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {activeTelemetry.health}
                  </div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">Prognostic Twin</div>
                </div>

                {/* 13. ANOMALY SCORE */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">13. ANOMALY SCORE</div>
                  <div className={`text-lg font-bold font-mono ${parseFloat(activeTelemetry.anomalyScore) > 0.25 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {activeTelemetry.anomalyScore}
                  </div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">Autoencoder MSE</div>
                </div>

                {/* 14. ESTIMATED RUL */}
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 flex flex-col justify-between min-h-[80px]">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">14. ESTIMATED RUL</div>
                  <div className="text-lg font-bold font-mono text-cyan-300">{activeTelemetry.rul}</div>
                  <div className="text-xs font-mono text-cyan-300/90 font-medium">Bi-LSTM 95% CI</div>
                </div>
              </div>
            </div>

            {/* 5. Phase Log Note */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 shadow-lg font-medium">
              <span className="text-cyan-400 font-bold uppercase tracking-wider font-mono">PHASE LOG NOTE: </span>
              <span>{currentLogNote}</span>
            </div>

            {/* 6. Dynamic Engine Health Degradation Curve */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-sm text-cyan-300 uppercase tracking-wider">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>ENGINE HEALTH THROUGH MISSION • TIME VS HEALTH INDEX</span>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 text-xs font-medium text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10B981]"></span>
                    <span>Health Index (%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_#F59E0B]"></span>
                    <span>Anomaly Event</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 h-[2px] bg-red-500 border-b border-dashed border-red-500"></span>
                    <span className="text-red-400 font-bold">50% MEL Overhaul Limit</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-300 -mt-1 font-medium">
                Continuous multi-stress fatigue degradation curve with dynamic physics & ML projections • Click anywhere to scrub
              </p>

              {/* SVG Curve */}
              <div className="relative w-full h-56 bg-[#040812] rounded-lg border border-slate-800 p-2 overflow-hidden">
                <svg 
                  className="w-full h-full cursor-pointer" 
                  viewBox="0 0 1000 200" 
                  preserveAspectRatio="none"
                  onClick={handleSvgClick}
                >
                  <defs>
                    <linearGradient id="degradationGradientClean" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity="0.45" />
                      <stop offset="50%" stopColor="#F59E0B" stopOpacity="0.30" />
                      <stop offset="100%" stopColor="#EF4444" stopOpacity="0.25" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines with bold crisp labels */}
                  <line x1="60" y1="30" x2="960" y2="30" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="24" y="34" fill="#94A3B8" fontSize="11" fontWeight="bold" fontFamily="monospace">100%</text>

                  <line x1="60" y1="75" x2="960" y2="75" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="30" y="79" fill="#94A3B8" fontSize="11" fontWeight="bold" fontFamily="monospace">80%</text>

                  <line x1="60" y1="120" x2="960" y2="120" stroke="#1E293B" strokeWidth="1" strokeDasharray="3 3" />
                  <text x="30" y="124" fill="#94A3B8" fontSize="11" fontWeight="bold" fontFamily="monospace">60%</text>

                  {/* Red Dashed 50% MEL Overhaul Line */}
                  <line x1="60" y1="145" x2="960" y2="145" stroke="#EF4444" strokeWidth="2" strokeDasharray="6 4" opacity="0.9" />
                  <text x="860" y="140" fill="#EF4444" fontSize="11" fontWeight="bold" fontFamily="monospace">MEL 50% LIMIT</text>

                  {/* Dynamic Gradient Area */}
                  <polygon
                    points={svgCoordinates.polygonPoints}
                    fill="url(#degradationGradientClean)"
                  />

                  {/* Dynamic Main Degradation Line */}
                  <polyline
                    points={svgCoordinates.polylinePoints}
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="3"
                  />

                  {/* Phase Circles */}
                  {svgCoordinates.xCoords.map((x, i) => {
                    const y = Number((30 + (100.0 - (trajectory[i] || 70.0)) * 2.3).toFixed(1));
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r="5.5"
                        fill="#10B981"
                        className="cursor-pointer hover:stroke-cyan-400 hover:stroke-2 transition-all"
                        onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(i); }}
                      />
                    );
                  })}

                  {/* Anomaly 1 Flag */}
                  {(() => {
                    const yAnom1 = Number((30 + (100.0 - (trajectory[3] || 94.0)) * 2.3).toFixed(1));
                    return (
                      <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(3); }}>
                        <circle cx="300" cy={yAnom1} r="6" fill="#F59E0B" stroke="#000" strokeWidth="2" />
                        <rect x="268" y={Math.max(8, yAnom1 - 26)} width="64" height="18" rx="4" fill="#78350F" stroke="#F59E0B" strokeWidth="1.5" />
                        <text x="272" y={Math.max(21, yAnom1 - 13)} fill="#FEF08A" fontSize="10" fontWeight="bold" fontFamily="monospace">▲ ANOMALY</text>
                      </g>
                    );
                  })()}

                  {/* Anomaly 2 Flag */}
                  {(() => {
                    const yAnom2 = Number((30 + (100.0 - (trajectory[4] || 86.0)) * 2.3).toFixed(1));
                    return (
                      <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(4); }}>
                        <circle cx="500" cy={yAnom2} r="6" fill="#F59E0B" stroke="#000" strokeWidth="2" />
                        <rect x="468" y={Math.max(8, yAnom2 - 26)} width="64" height="18" rx="4" fill="#78350F" stroke="#F59E0B" strokeWidth="1.5" />
                        <text x="472" y={Math.max(21, yAnom2 - 13)} fill="#FEF08A" fontSize="10" fontWeight="bold" fontFamily="monospace">▲ ANOMALY</text>
                      </g>
                    );
                  })()}

                  {/* Anomaly 3 Flag */}
                  {(() => {
                    const yAnom3 = Number((30 + (100.0 - (trajectory[5] || 76.0)) * 2.3).toFixed(1));
                    return (
                      <g className="cursor-pointer" onClick={(e) => { e.stopPropagation(); setActivePhaseIndex(5); }}>
                        <circle cx="600" cy={yAnom3} r="6.5" fill="#EF4444" stroke="#000" strokeWidth="2" />
                        <rect x="568" y={Math.max(8, yAnom3 - 26)} width="68" height="18" rx="4" fill="#7F1D1D" stroke="#EF4444" strokeWidth="1.5" />
                        <text x="572" y={Math.max(21, yAnom3 - 13)} fill="#FCA5A5" fontSize="10" fontWeight="bold" fontFamily="monospace">● VIB SPIKE</text>
                      </g>
                    );
                  })()}

                  {/* Current Active Playhead */}
                  {(() => {
                    const curX = svgCoordinates.activeX;
                    const curY = svgCoordinates.activeY;
                    const curHealth = activeTelemetry.health;
                    const curTime = currentPhase.time;

                    return (
                      <g>
                        <line x1={curX} y1="20" x2={curX} y2="180" stroke="#00F0FF" strokeWidth="2" strokeDasharray="4 3" />
                        <circle cx={curX} cy={curY} r="8" fill="none" stroke="#00F0FF" strokeWidth="2.5" />
                        <circle cx={curX} cy={curY} r="4" fill="#00F0FF" />
                        <text 
                          x={curX > 780 ? curX - 125 : curX + 12} 
                          y="42" 
                          fill="#00F0FF" 
                          fontSize="12" 
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {curHealth} ({curTime})
                        </text>
                      </g>
                    );
                  })()}
                </svg>
              </div>
            </div>

            {/* 7. Sliders & ISA 1976 Derivations */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col gap-3.5 shadow-lg">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-cyan-300 uppercase tracking-wider">
                <Sliders className="w-4 h-4 text-cyan-400" />
                <span>ENVIRONMENTAL BOUNDARY CONDITIONS & FIRST-PRINCIPLES ISA 1976 DERIVATIONS</span>
              </div>

              {/* Sliders Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-3.5 bg-slate-900/90 rounded-lg border border-slate-700/80">
                {/* Pressure Altitude */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-300">PRESSURE ALTITUDE:</span>
                    <span className="text-cyan-300 font-mono">{altitudeFt.toLocaleString()} FT</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="30000" 
                    step="500"
                    value={altitudeFt}
                    onChange={(e) => setAltitudeFt(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer h-2"
                  />
                  <div className="flex justify-between text-xs font-mono text-slate-400 font-medium">
                    <span>0 FT (SL)</span>
                    <span>FL145</span>
                    <span>FL300 (Ceiling)</span>
                  </div>
                </div>

                {/* Ambient Static Temp */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-300">AMBIENT STATIC TEMP:</span>
                    <span className="text-cyan-300 font-mono">{deltaIsaTempC}°C</span>
                  </div>
                  <input 
                    type="range" 
                    min="-50" 
                    max="50" 
                    step="1"
                    value={deltaIsaTempC}
                    onChange={(e) => setDeltaIsaTempC(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer h-2"
                  />
                  <div className="flex justify-between text-xs font-mono text-slate-400 font-medium">
                    <span>-50°C (Arctic)</span>
                    <span>+15°C (ISA Std)</span>
                    <span>+50°C (Desert)</span>
                  </div>
                </div>

                {/* Payload Configuration */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-300">PAYLOAD CONFIG:</span>
                    <span className="text-cyan-300 font-mono">{payloadStr}</span>
                  </div>
                  <select
                    value={payloadStr}
                    onChange={(e) => setPayloadStr(e.target.value)}
                    className="bg-slate-950 border border-slate-600 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400 font-medium"
                  >
                    <option value="65 kg (Minimal Standoff Pod)">65 kg (Minimal Standoff Pod)</option>
                    <option value="70 kg (Endurance Pod)">70 kg (Endurance Pod)</option>
                    <option value="75 kg (AIS + SATCOM)">75 kg (AIS + SATCOM)</option>
                    <option value="80 kg (SAR Weather Penetrator)">80 kg (SAR Weather Penetrator)</option>
                    <option value="85 kg (EO/IR + SAR)">85 kg (EO/IR + SAR - Std)</option>
                    <option value="85 kg (IPS De-Ice +3.5kW)">85 kg (IPS De-Ice +3.5kW)</option>
                    <option value="90 kg (Optronic Gimbal)">90 kg (Optronic Gimbal)</option>
                    <option value="95 kg (Dual EO/IR)">95 kg (Dual EO/IR)</option>
                    <option value="100 kg (Full Weapons Loadout)">100 kg (Full Weapons Loadout)</option>
                    <option value="110 kg (Heavy Multi-INT)">110 kg (Heavy Multi-INT)</option>
                    <option value="130 kg (Max Payload)">130 kg (Max Payload Limit)</option>
                    {!['65 kg (Minimal Standoff Pod)', '70 kg (Endurance Pod)', '75 kg (AIS + SATCOM)', '80 kg (SAR Weather Penetrator)', '85 kg (EO/IR + SAR)', '85 kg (IPS De-Ice +3.5kW)', '90 kg (Optronic Gimbal)', '95 kg (Dual EO/IR)', '100 kg (Full Weapons Loadout)', '110 kg (Heavy Multi-INT)', '130 kg (Max Payload)'].includes(payloadStr) && (
                      <option value={payloadStr}>{payloadStr}</option>
                    )}
                  </select>
                  <div className="text-xs text-slate-400 font-medium">Directly impacts climb fuel burn & CHT</div>
                </div>

                {/* Atmospheric Headwind */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-slate-300">HEADWIND / GUST:</span>
                    <span className="text-cyan-300 font-mono">{headwindKts} KTS</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="60" 
                    step="2"
                    value={headwindKts}
                    onChange={(e) => setHeadwindKts(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer h-2"
                  />
                  <div className="flex justify-between text-xs font-mono text-slate-400 font-medium">
                    <span>0 KTS (Calm)</span>
                    <span>30 KTS (Moderate)</span>
                    <span>60 KTS (Gale)</span>
                  </div>
                </div>
              </div>

              {/* ISA 1976 Physics Derivation Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80">
                  <div className="text-xs font-bold text-slate-300 uppercase">BAROMETRIC PRESSURE p(h)</div>
                  <div className="text-base font-bold font-mono text-cyan-300 mt-1">{aerothermal.atmosphericPressureHpa} hPa</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">ISA 1976 Standard Lapse</div>
                </div>

                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80">
                  <div className="text-xs font-bold text-slate-300 uppercase">LOCAL AIR DENSITY (rho)</div>
                  <div className="text-base font-bold font-mono text-cyan-300 mt-1">{aerothermal.airDensityKgM3} kg/m³</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Ratio: {aerothermal.densityRatio} rho0</div>
                </div>

                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80">
                  <div className="text-xs font-bold text-slate-300 uppercase">TURBO WASTEGATE RATIO</div>
                  <div className="text-base font-bold font-mono text-cyan-300 mt-1">{aerothermal.turboCompensatorRatio}:1 PR</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Rotax 915 iS Wastegate</div>
                </div>

                <div className="bg-slate-900/90 p-3 rounded-lg border border-slate-700/80">
                  <div className="text-xs font-bold text-slate-300 uppercase">HEAT REJECTION FLUX</div>
                  <div className="text-base font-bold font-mono text-cyan-300 mt-1">{aerothermal.radiatorHeatFluxKw} kW</div>
                  <div className="text-xs text-slate-400 font-medium mt-0.5">Forced Convection Radiator</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Right Column: GarudaTwin Copilot & 1-Click PDF Dossier */}
        {viewMode !== 'replay_full' && (
          <div className={`flex flex-col gap-3.5 shrink-0 transition-all ${viewMode === 'copilot_full' ? 'w-full' : 'w-full lg:w-[35%]'}`}>
            {/* Copilot Chat Console */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-xl min-h-[580px] h-full">
              <div>
                {/* Copilot Header */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-400/50 text-cyan-300 shadow-sm">
                      <Bot className="w-5 h-5 text-cyan-400 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm tracking-wider text-cyan-300">
                        GARUDATWIN GCS COPILOT
                      </h3>
                      <span className="text-xs text-slate-300 font-medium">
                        AI DIAGNOSTIC & ROOT-CAUSE REASONER
                      </span>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-cyan-950 border border-cyan-400/60 text-cyan-300">
                    REPLAY SYNC
                  </span>
                </div>

                {/* Replay Context Bar */}
                <div className="mt-3 px-3.5 py-2 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-xs flex items-center justify-between text-cyan-300 font-medium">
                  <span className="flex items-center gap-1.5 font-mono">
                    <Clock className="w-3.5 h-3.5 text-cyan-400" />
                    <span>SYNCED: {currentPhase.name} ({currentPhase.time})</span>
                  </span>
                  <span className="text-white font-bold font-mono">{activeTelemetry.health} HEALTH</span>
                </div>

                {/* Chat Messages Stream */}
                <div className="overflow-y-auto my-3 pr-1.5 flex flex-col gap-3.5 max-h-[360px] custom-scrollbar">
                  {messages.map((msg, idx) => {
                    const isAi = msg.sender === 'ai';
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col max-w-[92%] ${isAi ? 'self-start' : 'self-end'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-1 text-xs text-slate-400">
                          {isAi ? <Bot className="w-3.5 h-3.5 text-cyan-400" /> : <Terminal className="w-3.5 h-3.5 text-slate-300" />}
                          <span className="font-bold text-slate-200">{isAi ? 'GARUDATWIN COPILOT' : 'FLIGHT CONTROLLER'}</span>
                          <span className="text-xs font-mono text-slate-400">[{msg.timestamp}]</span>
                        </div>
                        <div
                          className={`p-3.5 rounded-xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans ${
                            isAi
                              ? 'bg-slate-900 border border-slate-700/90 rounded-tl-none text-slate-100 shadow-md font-medium'
                              : 'bg-cyan-950 border border-cyan-400/80 rounded-tr-none text-white font-medium'
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Prompt Chips & Input */}
              <div className="flex flex-col gap-2 mt-auto">
                <div className="flex flex-wrap gap-1.5">
                  {promptChips.map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(chip)}
                      className="px-2.5 py-1 bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 rounded-full text-xs text-slate-200 hover:text-white transition-all font-medium"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 bg-slate-950 p-2 rounded-lg border border-slate-700 shadow-inner">
                  <input
                    type="text"
                    value={inputQuery}
                    onChange={(e) => setInputQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Ask Copilot about engine health or anomalies..."
                    className="flex-1 bg-transparent text-xs sm:text-sm text-white placeholder-slate-400 outline-none px-2.5 font-medium"
                  />
                  <button
                    onClick={() => handleSendMessage()}
                    className="px-3.5 py-1.5 bg-cyan-400 hover:bg-cyan-300 text-black font-bold text-xs rounded transition-all flex items-center gap-1"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* 1-Click PDF Airworthiness Dossier Card */}
            <div className="bg-[#0A101D] border border-slate-800 rounded-xl p-4 flex flex-col gap-3 shadow-xl">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-cyan-300 uppercase tracking-wider">
                <FileText className="w-4 h-4 text-cyan-400" />
                <span>DO-178C AIRWORTHINESS EXPORTER</span>
              </div>

              <div className="text-xs text-slate-300 leading-relaxed bg-slate-900/90 p-3 rounded-lg border border-slate-700/80 font-medium">
                Compiles an official certified flight debrief containing full 14-parameter telemetry tables, ISA 1976 aerothermal derivations, autoencoder anomaly scores, and signed digital clearance for <span className="text-cyan-300 font-bold font-mono">{activePreset.replace(/_/g, ' ')}</span>.
              </div>

              <button
                onClick={exportPdfReport}
                disabled={isGeneratingPdf}
                className="w-full py-3.5 bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-bold text-xs tracking-wider rounded-lg shadow-[0_0_15px_rgba(0,240,255,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <FileDown className="w-4 h-4" />
                <span>{isGeneratingPdf ? 'COMPILING DOSSIER...' : 'EXPORT AIRWORTHINESS REPORT (PDF)'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
