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
// PRECISION AVIONICS RADIAL DIAL GAUGE (STANAG 4586 / MIL-STD-1472H)
// ---------------------------------------------------------
const RadialDial = ({ label, value, unit, min, max, warn, crit, isHighCrit = true, icon: Icon }) => {
  let statusColor = 'text-emerald-700';
  let strokeColor = '#059669';
  let isAlarm = false;
  let isWarning = false;

  const numVal = typeof value === 'number' ? value : parseFloat(value) || 0;

  if (isHighCrit) {
    if (numVal >= crit) { 
      statusColor = 'text-red-700'; 
      strokeColor = '#DC2626'; 
      isAlarm = true; 
    } else if (numVal >= warn) { 
      statusColor = 'text-amber-700'; 
      strokeColor = '#D97706'; 
      isWarning = true; 
    }
  } else {
    if (numVal <= crit) { 
      statusColor = 'text-red-700'; 
      strokeColor = '#DC2626'; 
      isAlarm = true; 
    } else if (numVal <= warn) { 
      statusColor = 'text-amber-700'; 
      strokeColor = '#D97706'; 
      isWarning = true; 
    }
  }

  // Normalized percent 0 - 100
  const pct = Math.max(0, Math.min(100, ((numVal - min) / (max - min)) * 100));
  
  // 240-degree arc calculation
  const radius = 38;
  const arcLength = 2 * Math.PI * radius * (240 / 360);
  const strokeDashoffset = arcLength - (arcLength * pct) / 100;

  // Generate tick marks (major at 0%, 25%, 50%, 75%, 100%)
  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className={`gcs-card p-2.5 flex flex-col items-center justify-between relative overflow-hidden transition-colors border shadow-xs ${
      isAlarm 
        ? 'border-red-300 bg-red-50/70' 
        : isWarning 
        ? 'border-amber-300 bg-amber-50/70' 
        : 'border-slate-200 hover:border-slate-300 bg-white'
    }`}>
      {/* Header Tag */}
      <div className="w-full flex items-center justify-between text-slate-500 mb-1 z-10">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="w-3.5 h-3.5 text-sky-600" />}
          <span className="text-[10px] font-mono tracking-wider font-semibold text-slate-700 uppercase">{label}</span>
        </div>
        {isAlarm && (
          <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-red-100 text-red-700 border border-red-300 font-bold">
            ALARM
          </span>
        )}
        {isWarning && !isAlarm && (
          <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold">
            WARN
          </span>
        )}
      </div>

      {/* SVG Precision Dial with Calibrated Ticks */}
      <div className="relative w-28 h-24 flex items-center justify-center my-0.5">
        <svg className="w-full h-full transform rotate-[150deg]" viewBox="0 0 100 100">
          {/* Background Arc Track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="5"
            strokeDasharray={arcLength}
            strokeDashoffset="0"
            strokeLinecap="round"
          />

          {/* Tick Hashes */}
          {ticks.map((t, idx) => {
            const angle = 150 + (t / 100) * 240;
            const rad = (angle * Math.PI) / 180;
            const x1 = 50 + (radius - 5) * Math.cos(rad);
            const y1 = 50 + (radius - 5) * Math.sin(rad);
            const x2 = 50 + (radius + 2) * Math.cos(rad);
            const y2 = 50 + (radius + 2) * Math.sin(rad);
            return (
              <line
                key={idx}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#CBD5E1"
                strokeWidth="1.2"
                transform="rotate(-150 50 50)"
              />
            );
          })}

          {/* Active Value Arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="5"
            strokeDasharray={arcLength}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
        </svg>

        {/* Center Precision Telemetry Display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2 pointer-events-none">
          <span className={`text-xl font-mono font-bold tracking-tight tabular-nums ${statusColor}`}>
            {typeof value === 'number' ? value.toFixed(1) : value}
          </span>
          <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{unit}</span>
        </div>
      </div>

      {/* Min / Max Range Markers */}
      <div className="w-full flex justify-between items-center text-[9px] font-mono text-slate-400 px-1 border-t border-slate-100 pt-1 mt-0.5 tabular-nums">
        <span>{min}</span>
        <span className="text-slate-600 font-semibold">{pct.toFixed(0)}%</span>
        <span>{max}</span>
      </div>
    </div>
  );
};

const MetricRow = ({ label, value, unit, statusStr, highlight }) => (
  <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors">
    <span className="text-[11px] font-mono text-slate-600">{label}</span>
    <div className="flex items-center gap-2">
      {statusStr && (
        <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold ${
          statusStr === 'NOMINAL' 
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
            : statusStr === 'CRITICAL'
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-amber-50 text-amber-800 border border-amber-200'
        }`}>
          {statusStr}
        </span>
      )}
      <span className={`text-xs font-mono font-semibold tabular-nums ${highlight ? 'text-sky-700' : 'text-slate-900'}`}>
        {value} <span className="text-[10px] text-slate-400 font-normal">{unit}</span>
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
    <div className="h-full flex items-center justify-center font-mono text-xs text-slate-400">
      [PROPULSION TELEMETRY BUS SYNC IN PROGRESS...]
    </div>
  );

  const eng = telemetry.engine;
  const res = telemetry.residuals;
  const can = telemetry.canBusFrames || [];
  
  const th = analytics.thermal;
  const cb = analytics.combustion;
  const vb = analytics.vibration;
  const el = analytics.electrical;
  const air = analytics.air;
  const f = (v, d) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-3 pb-6 pr-1 select-none">
      
      {/* 1. MASTER AVIONICS GAUGE CLUSTER: 6 CRITICAL METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <RadialDial label="ENGINE RPM" value={eng.rpm} unit="RPM" min={0} max={6000} warn={5500} crit={5800} icon={Settings} />
        <RadialDial label="MAX CHT" value={th.chtMax} unit="°C" min={50} max={150} warn={120} crit={135} icon={Thermometer} />
        <RadialDial label="MAX EGT" value={th.egtMax} unit="°C" min={600} max={1000} warn={880} crit={950} icon={Flame} />
        <RadialDial label="OIL PRESSURE" value={eng.oilPressBar} unit="bar" min={0} max={6} warn={2.5} crit={1.8} isHighCrit={false} icon={Droplets} />
        <RadialDial label="FUEL FLOW" value={eng.fuelFlowLph} unit="L/h" min={0} max={40} warn={32} crit={36} icon={Droplets} />
        <RadialDial label="VIBRATION" value={eng.vibrationGrms} unit="g-RMS" min={0} max={3} warn={0.8} crit={1.4} icon={Activity} />
      </div>

      {/* 2. DASHBOARD MAIN AREA */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        
        {/* LEFT/CENTER: Multi-Cylinder Thermal & Pressure Spread + CAN Bus */}
        <div className="xl:col-span-2 flex flex-col gap-3">
          {/* MULTI-CYLINDER SPREAD */}
          <div className="gcs-panel rounded-lg border border-slate-200 p-3.5 shadow-xs">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-600" /> CYLINDER COMBUSTION & THERMAL SPREAD
              </h3>
              <div className="flex items-center gap-4 text-xs font-mono">
                <span className="text-slate-500">AVG CHT: <span className="text-slate-900 font-bold tabular-nums">{th.chtAvg.toFixed(1)}°C</span></span>
                <span className="text-slate-500">AVG EGT: <span className="text-amber-700 font-bold tabular-nums">{th.egtAvg.toFixed(1)}°C</span></span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
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
                    className={`gcs-card p-2.5 rounded-lg border transition-colors shadow-xs ${
                      isAlarm 
                        ? 'border-red-300 bg-red-50/70' 
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-100">
                      <span className="text-xs font-bold font-mono text-slate-800">CYLINDER #{i+1}</span>
                      <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                        isAlarm ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {isAlarm ? 'ALERT' : 'NOMINAL'}
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
          <div className="gcs-panel rounded-lg border border-slate-200 p-3.5 shadow-xs">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <Radio className="w-4 h-4 text-emerald-600" /> CAN 2.0B TELEMETRY BUS SNIFFER
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 font-semibold">
                100 HZ ACTIVE STREAM
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {can.map((f, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-md p-2 flex flex-col font-mono text-[10px] hover:border-slate-300 transition-colors">
                  <div className="flex justify-between text-slate-500 mb-1 border-b border-slate-200 pb-0.5">
                    <span className="text-sky-700 font-bold">{f.canId}</span>
                    <span className="text-slate-400 tabular-nums">DLC:{f.dlc}</span>
                  </div>
                  <div className="text-slate-800 tracking-wider font-mono text-[11px] select-all tabular-nums font-semibold">{f.rawHex}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: Subsystems */}
        <div className="flex flex-col gap-3">
          
          {/* ELECTRICAL */}
          <div className="gcs-panel rounded-lg border border-slate-200 p-3.5 shadow-xs">
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase mb-3 pb-2 border-b border-slate-200 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-600" /> ALTERNATOR, BATTERY & 28 V BUS
            </h3>
            <div className="flex flex-col">
              <MetricRow label="BUS VOLTAGE" value={f(el.busV, 1)} unit="V" statusStr={el.busV < 25 ? 'CRITICAL' : el.busV < 26.5 ? 'LOW' : 'NOMINAL'} highlight />
              <MetricRow label="ALTERNATOR OUTPUT" value={f(el.altA, 1)} unit="A" />
              <MetricRow label="ELECTRICAL LOAD (ALT − BATT)" value={f(el.loadA, 1)} unit="A" />
              <MetricRow label="BATTERY CURRENT" value={el.batA == null ? '—' : `${el.batA >= 0 ? '+' : ''}${el.batA.toFixed(1)}`} unit={el.batA < 0 ? 'A DISCHARGING' : 'A charging'} statusStr={el.batA < -5 ? 'CRITICAL' : el.batA < -0.5 ? 'LOW' : null} />
              <MetricRow label="BATTERY STATE OF CHARGE" value={f(el.batSoc, 1)} unit="%" statusStr={el.batSoc < 20 ? 'CRITICAL' : el.batSoc < 40 ? 'LOW' : null} highlight />
              <MetricRow label="BATTERY-ONLY ENDURANCE" value={el.enduranceMin == null ? 'charging' : f(el.enduranceMin, 0)} unit={el.enduranceMin == null ? '' : 'min'} statusStr={el.enduranceMin != null && el.enduranceMin < 30 ? 'CRITICAL' : null} />
            </div>
          </div>

          {/* INJECTION TIMING */}
          <div className="gcs-panel rounded-lg border border-slate-200 p-3.5 shadow-xs">
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase mb-3 pb-2 border-b border-slate-200 flex items-center gap-2">
              <Settings className="w-4 h-4 text-sky-600" /> FUEL INJECTION (ECU)
            </h3>
            <div className="flex flex-col">
              <MetricRow label="INJECTION TIME" value={f(cb.injPulseMs, 2)} unit="ms" highlight />
              <MetricRow label="INJECTION TIME vs NOMINAL" value={cb.injResidualPct == null ? '—' : `${cb.injResidualPct >= 0 ? '+' : ''}${cb.injResidualPct.toFixed(1)}`} unit="%" statusStr={Math.abs(cb.injResidualPct ?? 0) > 10 ? 'WARN' : null} />
              <MetricRow label="ECU CLOSED-LOOP FUEL TRIM" value={cb.fuelTrimPct == null ? '—' : `${cb.fuelTrimPct >= 0 ? '+' : ''}${cb.fuelTrimPct.toFixed(1)}`} unit="%" statusStr={Math.abs(cb.fuelTrimPct ?? 0) >= 14.5 ? 'CRITICAL' : Math.abs(cb.fuelTrimPct ?? 0) > 10 ? 'WARN' : null} />
              <MetricRow label="INJECTOR DUTY CYCLE" value={f(cb.injDutyPct, 0)} unit="%" />
              <MetricRow label="LAMBDA / FUEL FLOW" value={`${f(cb.lambda, 3)} / ${f(cb.fuelFlowLph, 1)}`} unit="L/h" />
              <div className="text-[9px] font-mono text-slate-400 px-2 pt-1">Port injection, ~3 bar rail. Ignition timing is not modelled.</div>
            </div>
          </div>

          {/* TRI-AXIAL FFT */}
          <div className="gcs-panel rounded-lg border border-slate-200 p-3.5 shadow-xs">
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase mb-3 pb-2 border-b border-slate-200 flex items-center gap-2">
              <Activity className="w-4 h-4 text-slate-600" /> AIR DATA, TURBO & VIBRATION
            </h3>
            <div className="flex flex-col">
              <MetricRow label="PRESSURE ALTITUDE" value={f(air.altitudeFt, 0)} unit="ft" />
              <MetricRow label="OUTSIDE AIR TEMP" value={f(air.oatC, 1)} unit="°C" />
              <MetricRow label="AMBIENT PRESSURE" value={f(air.pressureBar, 3)} unit="bar" />
              <MetricRow label="WASTEGATE CLOSED" value={f(air.wastegatePct, 0)} unit="%" statusStr={air.wastegatePct >= 99 ? 'AT LIMIT' : null} />
              <MetricRow label="VIBRATION (BROADBAND)" value={f(vb.grms, 3)} unit="g-RMS" statusStr={(vb.residual ?? 0) > 0.25 ? 'WARN' : null} />
              <div className="text-[9px] font-mono text-slate-400 px-2 pt-1">Wastegate at its limit = above critical altitude (MAP can no longer be held). No spectral vibration sensor is modelled.</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

