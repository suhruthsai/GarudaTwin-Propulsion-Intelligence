import React from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { 
  Activity, 
  Flame, 
  Thermometer, 
  Zap, 
  Settings, 
  Droplets,
  Radio,
  Cpu,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Clock
} from 'lucide-react';

// ---------------------------------------------------------
// STARSHIP MISSION DECK: RADIAL ARC DIAL GAUGE
// ---------------------------------------------------------
const RadialDial = ({ label, value, unit, min, max, warn, crit, isHighCrit = true, icon: Icon, colorHex = '#00F0FF' }) => {
  let statusColor = 'text-emerald-400';
  let glowClass = 'glow-green';
  let strokeColor = '#10B981';
  let isAlarm = false;
  let isWarning = false;

  const numVal = typeof value === 'number' ? value : parseFloat(value) || 0;

  if (isHighCrit) {
    if (numVal >= crit) { 
      statusColor = 'text-red-400'; 
      glowClass = 'glow-red'; 
      strokeColor = '#EF4444'; 
      isAlarm = true; 
    } else if (numVal >= warn) { 
      statusColor = 'text-amber-400'; 
      glowClass = 'glow-amber'; 
      strokeColor = '#F59E0B'; 
      isWarning = true; 
    }
  } else {
    if (numVal <= crit) { 
      statusColor = 'text-red-400'; 
      glowClass = 'glow-red'; 
      strokeColor = '#EF4444'; 
      isAlarm = true; 
    } else if (numVal <= warn) { 
      statusColor = 'text-amber-400'; 
      glowClass = 'glow-amber'; 
      strokeColor = '#F59E0B'; 
      isWarning = true; 
    }
  }

  // Normalized percent 0 - 100
  const pct = Math.max(0, Math.min(100, ((numVal - min) / (max - min)) * 100));
  
  // 240-degree arc calculation
  const radius = 38;
  const arcLength = 2 * Math.PI * radius * (240 / 360);
  const strokeDashoffset = arcLength - (arcLength * pct) / 100;

  return (
    <div className={`starship-glass-card rounded-xl p-3 flex flex-col items-center justify-between relative overflow-hidden transition-all duration-300 ${
      isAlarm 
        ? 'border-red-500/80 shadow-[0_0_20px_rgba(239,68,68,0.35)] animate-pulse' 
        : isWarning 
        ? 'border-amber-500/70 shadow-[0_0_15px_rgba(245,158,11,0.25)]' 
        : 'border-white/[0.08] hover:border-cyan-400/40'
    }`}>
      {/* Header Tag */}
      <div className="w-full flex items-center justify-between text-slate-400 mb-1 z-10">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="w-3.5 h-3.5 text-cyan-400" />}
          <span className="text-[10px] font-mono tracking-wider font-bold text-slate-300">{label}</span>
        </div>
        {isAlarm && (
          <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-red-950 text-red-400 border border-red-500/60 font-bold animate-pulse">
            ALARM
          </span>
        )}
        {isWarning && !isAlarm && (
          <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-500/60 font-bold">
            WARN
          </span>
        )}
      </div>

      {/* SVG Radial Gauge */}
      <div className="relative w-28 h-24 flex items-center justify-center my-1">
        <svg className="w-full h-full transform rotate-[150deg]" viewBox="0 0 100 100">
          {/* Background Arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#121e36"
            strokeWidth="7"
            strokeDasharray={arcLength}
            strokeDashoffset="0"
            strokeLinecap="round"
          />
          {/* Animated Value Arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="7"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
            style={{
              filter: `drop-shadow(0 0 6px ${strokeColor}88)`
            }}
          />
        </svg>

        {/* Center Digital Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2 pointer-events-none">
          <span className={`text-xl font-mono font-black tracking-tight ${statusColor} ${glowClass}`}>
            {typeof value === 'number' ? value.toFixed(1) : value}
          </span>
          <span className="text-[9px] font-mono text-slate-400 uppercase">{unit}</span>
        </div>
      </div>

      {/* Min / Max Range Markers */}
      <div className="w-full flex justify-between items-center text-[9px] font-mono text-slate-500 px-1 border-t border-white/[0.05] pt-1 mt-0.5">
        <span>MIN {min}</span>
        <span className="text-slate-400 font-semibold">{pct.toFixed(0)}%</span>
        <span>MAX {max}</span>
      </div>
    </div>
  );
};

const MetricRow = ({ label, value, unit, statusStr, highlight }) => (
  <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white/[0.03] border-b border-white/[0.04] last:border-0 transition-colors">
    <span className="text-[11px] font-mono text-slate-400">{label}</span>
    <div className="flex items-center gap-2">
      {statusStr && (
        <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
          statusStr === 'NOMINAL' 
            ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/30' 
            : 'bg-red-950/70 text-red-400 border border-red-500/50 animate-pulse'
        }`}>
          {statusStr}
        </span>
      )}
      <span className={`text-xs font-mono font-bold ${highlight ? 'text-cyan-300' : 'text-slate-200'}`}>
        {value} <span className="text-[10px] text-slate-500 font-normal">{unit}</span>
      </span>
    </div>
  </div>
);

// ---------------------------------------------------------
// MAIN TAB COMPONENT
// ---------------------------------------------------------
export const TelemetryTab = () => {
  const { telemetry, analytics } = useTelemetry();
  
  if (!telemetry || !analytics) return (
    <div className="h-full flex items-center justify-center font-mono text-xs text-cyan-400 animate-pulse">
      [GARUDATWIN STARSHIP TELEMETRY SYNC IN PROGRESS...]
    </div>
  );

  const eng = telemetry.engine;
  const res = telemetry.residuals;
  const can = telemetry.canBusFrames || [];
  
  const th = analytics.thermal;
  const cb = analytics.combustion;
  const vb = analytics.vibration;
  const el = analytics.electrical;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-3.5 pb-10 pr-1">
      
      {/* 1. STARSHIP MISSION DECK: 6 CRITICAL RADIAL GAUGES */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <RadialDial label="ENGINE RPM" value={eng.rpm} unit="RPM" min={0} max={6000} warn={5500} crit={5800} icon={Settings} colorHex="#00F0FF" />
        <RadialDial label="MAX CHT" value={th.chtMax} unit="°C" min={50} max={150} warn={120} crit={135} icon={Thermometer} colorHex="#00F0FF" />
        <RadialDial label="MAX EGT" value={th.egtMax} unit="°C" min={600} max={1000} warn={880} crit={950} icon={Flame} colorHex="#F59E0B" />
        <RadialDial label="OIL PRESSURE" value={eng.oilPressBar} unit="bar" min={0} max={6} warn={2.5} crit={1.8} isHighCrit={false} icon={Droplets} colorHex="#F59E0B" />
        <RadialDial label="FUEL FLOW" value={eng.fuelFlowLph} unit="L/h" min={0} max={40} warn={32} crit={36} icon={Droplets} colorHex="#0284C7" />
        <RadialDial label="VIBRATION" value={eng.vibrationGrms} unit="g-RMS" min={0} max={3} warn={0.8} crit={1.4} icon={Activity} colorHex="#EF4444" />
      </div>

      {/* 2. DASHBOARD MAIN AREA */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3.5">
        
        {/* LEFT/CENTER: Multi-Cylinder Thermal & Pressure Spread + CAN Bus */}
        <div className="xl:col-span-2 flex flex-col gap-3.5">
          {/* MULTI-CYLINDER SPREAD */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/[0.08]">
              <h3 className="font-display font-black text-xs tracking-widest text-cyan-300 flex items-center gap-2 glow-cyan">
                <Cpu className="w-4 h-4 text-cyan-400" /> MULTI-CYLINDER COMBUSTION & THERMAL BALANCE
              </h3>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-slate-400">AVG CHT: <span className="text-cyan-300 font-bold">{th.chtAvg.toFixed(1)}°C</span></span>
                <span className="text-slate-400">AVG EGT: <span className="text-orange-400 font-bold">{th.egtAvg.toFixed(1)}°C</span></span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map(i => {
                const cylCht = eng.cht[i];
                const cylEgt = eng.egt[i];
                const rCht = res.chtResiduals[i];
                const rEgt = res.egtResiduals[i];
                const isChtCrit = cylCht > 135;
                const isEgtCrit = cylEgt > 950;
                const isAlarm = isChtCrit || isEgtCrit;
                
                const peakP = 92.5 + (cylEgt - 840) * 0.05 + rEgt * 0.1;

                return (
                  <div 
                    key={i} 
                    className={`starship-glass-card p-3 rounded-lg border transition-all duration-300 ${
                      isAlarm 
                        ? 'border-red-500/80 bg-red-950/20 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                        : 'border-white/[0.07] hover:border-cyan-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-white/[0.06]">
                      <span className="text-xs font-bold font-mono text-cyan-200">CYLINDER #{i+1}</span>
                      <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold ${
                        isAlarm ? 'bg-red-950 text-red-400 border border-red-500/60 animate-pulse' : 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
                      }`}>
                        {isAlarm ? 'FAULT' : 'NOMINAL'}
                      </span>
                    </div>
                    
                    <MetricRow label="CHT" value={cylCht.toFixed(1)} unit="°C" highlight={cylCht > 120} />
                    <MetricRow label="CHT Δ AVG" value={(cylCht - th.chtAvg).toFixed(1)} unit="°C" statusStr={Math.abs(rCht) > 10 ? 'WARN' : null} />
                    <MetricRow label="EGT" value={cylEgt.toFixed(1)} unit="°C" highlight={cylEgt > 900} />
                    <MetricRow label="EGT Δ AVG" value={(cylEgt - th.egtAvg).toFixed(1)} unit="°C" statusStr={Math.abs(rEgt) > 20 ? 'WARN' : null} />
                    <MetricRow label="PEAK PRESS" value={peakP.toFixed(1)} unit="bar" />
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* RAW CAN BUS PACKET VIEWER */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/[0.08]">
              <h3 className="font-display font-black text-xs tracking-widest text-slate-200 flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-400 animate-pulse" /> CAN 2.0B TELEMETRY BUS SNIFFER
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                100 HZ ACTIVE STREAM
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {can.map((f, i) => (
                <div key={i} className="bg-slate-950/90 border border-white/[0.08] rounded-lg p-2.5 flex flex-col font-mono text-[10px] shadow-inner hover:border-cyan-500/40 transition-colors">
                  <div className="flex justify-between text-slate-400 mb-1 border-b border-white/[0.04] pb-1">
                    <span className="text-cyan-400 font-bold">{f.canId}</span>
                    <span className="text-slate-500">DLC:{f.dlc}</span>
                  </div>
                  <div className="text-slate-200 tracking-widest font-mono text-[11px] select-all">{f.rawHex}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Subsystems */}
        <div className="flex flex-col gap-3.5">
          
          {/* ELECTRICAL */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass">
            <h3 className="font-display font-black text-xs tracking-widest text-slate-200 mb-3 pb-2 border-b border-white/[0.08] flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" /> DUAL ALTERNATORS & 28V BUS
            </h3>
            <div className="flex flex-col gap-0.5">
              <MetricRow label="MAIN BUS VOLTAGE" value={eng.genVoltageV.toFixed(1)} unit="V" statusStr={eng.genVoltageV < 24 ? 'CRITICAL' : 'NOMINAL'} highlight />
              <MetricRow label="ALT #1 CURRENT" value={el.alt1.toFixed(1)} unit="A" />
              <MetricRow label="ALT #2 CURRENT" value={el.alt2.toFixed(1)} unit="A" />
              <MetricRow label="BUS RIPPLE RMS" value={el.ripple.toFixed(1)} unit="mV" />
              <MetricRow label="BATTERY SOC" value={el.batSoc.toFixed(1)} unit="%" highlight />
              <MetricRow label="BATTERY SOH" value={el.batSoh.toFixed(1)} unit="%" />
            </div>
          </div>

          {/* INJECTION TIMING */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass">
            <h3 className="font-display font-black text-xs tracking-widest text-slate-200 mb-3 pb-2 border-b border-white/[0.08] flex items-center gap-2">
              <Settings className="w-4 h-4 text-purple-400" /> INJECTION & IGNITION TIMING
            </h3>
            <div className="flex flex-col gap-0.5">
              <MetricRow label="START OF INJECTION" value={cb.startOfInj.toFixed(1)} unit="° BTDC" />
              <MetricRow label="INJECTION DURATION" value={cb.injDuration.toFixed(0)} unit="μs" />
              <MetricRow label="COMMON RAIL PRESS" value={cb.railPress.toFixed(1)} unit="bar" highlight />
              <MetricRow label="IGNITION ADVANCE" value={cb.ignAdv.toFixed(1)} unit="° BTDC" />
            </div>
          </div>

          {/* TRI-AXIAL FFT */}
          <div className="starship-glass rounded-xl border border-white/[0.08] p-4 shadow-starship-glass">
            <h3 className="font-display font-black text-xs tracking-widest text-slate-200 mb-3 pb-2 border-b border-white/[0.08] flex items-center gap-2">
              <Activity className="w-4 h-4 text-rose-400" /> TRI-AXIAL FFT HARMONICS
            </h3>
            <div className="flex flex-col gap-0.5">
              <MetricRow label="1X CRANK (FUNDAMENTAL)" value={vb.fft1x.toFixed(3)} unit="IPS" statusStr={vb.fft1x > 0.08 ? 'WARN' : null} />
              <MetricRow label="2X HARMONIC" value={vb.fft2x.toFixed(3)} unit="IPS" />
              <MetricRow label="0.5X VALVE" value={vb.fft05x.toFixed(3)} unit="IPS" />
              <MetricRow label="KNOCK INTENSITY" value={vb.knock.toFixed(3)} unit="V RMS" statusStr={vb.knock > 0.3 ? 'CRITICAL' : null} highlight={vb.knock > 0.3} />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

