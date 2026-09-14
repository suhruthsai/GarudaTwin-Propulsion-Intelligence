/**
 * ControlSurfaceInspector.jsx
 * ============================
 * Real-time angular gauge display for all 5 UAV control surfaces + throttle.
 * Uses SVG arc gauges with animated needles showing live deflection.
 *
 * Surfaces:
 *  - Elevator  ±25°
 *  - Aileron   ±20°
 *  - Rudder    ±25°
 *  - Flap       0–40°
 *  - Throttle   0–100%
 *  - Speed Brake on/off indicator
 *  - Thrust (N) bar
 */

import React from 'react';

// ─────────────────────────────────────────────────────────────
//  Single SVG arc gauge
// ─────────────────────────────────────────────────────────────
function ArcGauge({ label, value, min, max, unit = '°', warnHigh, warnLow, color = '#00aaff', size = 90 }) {
  const pct  = (value - min) / (max - min);
  const angle = -135 + pct * 270;          // arc from -135° to +135° (270° span)
  const cx = size / 2, cy = size / 2 + 8;
  const R  = size / 2 - 10;

  // Arc path helper
  function polarToXY(deg, r) {
    const rad = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  function describeArc(startDeg, endDeg, r) {
    const [x1, y1] = polarToXY(startDeg, r);
    const [x2, y2] = polarToXY(endDeg, r);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  }

  const isWarn = (warnHigh !== undefined && value > warnHigh) || (warnLow !== undefined && value < warnLow);
  const arcColor = isWarn ? '#DC2626' : color;

  // Needle
  const needleDeg = -135 + pct * 270 - 90 + 90;  // correct angle from top
  const [nx, ny] = polarToXY(-135 + pct * 270, R - 4);

  return (
    <div style={{ textAlign: 'center', display: 'inline-block', margin: '4px 6px' }}>
      <svg width={size} height={size + 20}>
        {/* Track arc */}
        <path
          d={describeArc(-135 - 90, 135 - 90, R)}
          fill="none"
          stroke="#E2E8F0"
          strokeWidth="6"
        />
        {/* Filled arc (value) */}
        <path
          d={describeArc(-135 - 90, -135 - 90 + pct * 270, R)}
          fill="none"
          stroke={arcColor}
          strokeWidth="6"
          strokeLinecap="round"
        />
        {/* Zero tick (for bidirectional gauges) */}
        {min < 0 && (
          <circle cx={cx} cy={cy - R} r="2.5" fill="#0284C7" />
        )}
        {/* Needle dot */}
        <circle cx={nx} cy={ny} r="3.5" fill={arcColor} />
        {/* Center */}
        <circle cx={cx} cy={cy} r="3" fill="#64748B" />

        {/* Tick marks */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((t, i) => {
          const [tx, ty] = polarToXY(-135 - 90 + t * 270, R + 6);
          const [tx2, ty2] = polarToXY(-135 - 90 + t * 270, R + 12);
          return <line key={i} x1={tx} y1={ty} x2={tx2} y2={ty2} stroke="#94A3B8" strokeWidth="1" />;
        })}

        {/* Value text */}
        <text x={cx} y={cy + 16} textAnchor="middle" fill={arcColor}
          style={{ font: 'bold 13px monospace' }}>
          {Number.isFinite(value) ? (Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value)) : '--'}
        </text>
        <text x={cx} y={cy + 27} textAnchor="middle" fill="#64748B"
          style={{ font: '8px monospace' }}>
          {unit}
        </text>
      </svg>
      <div style={{ color: isWarn ? '#DC2626' : '#475569', fontSize: '10px', marginTop: '-4px', fontFamily: 'monospace', fontWeight: '600' }}>
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Throttle bar
// ─────────────────────────────────────────────────────────────
function ThrustBar({ throttle_pct = 38, thrust_N = 684 }) {
  const pct = Math.min(100, Math.max(0, throttle_pct));
  const col = pct > 85 ? '#DC2626' : pct > 65 ? '#D97706' : '#059669';
  return (
    <div style={{ padding: '6px 10px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0', marginBottom: '8px' }}>
      <div style={{ color: '#64748B', fontSize: '10px', fontFamily: 'monospace', marginBottom: '4px', fontWeight: '600' }}>THROTTLE / THRUST</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, background: '#E2E8F0', borderRadius: '4px', height: '14px', overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: col, transition: 'width 0.1s linear', borderRadius: '4px' }} />
        </div>
        <span style={{ color: col, fontFamily: 'monospace', fontSize: '13px', fontWeight: 'bold', minWidth: '45px', textAlign: 'right' }}>
          {Math.round(pct)}%
        </span>
        <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', minWidth: '65px' }}>
          {Math.round(thrust_N)} N
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Speed brake indicator
// ─────────────────────────────────────────────────────────────
function SpeedBrakeIndicator({ active }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 12px', borderRadius: '4px',
      background: active ? '#FEF2F2' : '#F8FAFC',
      border: `1px solid ${active ? '#EF4444' : '#CBD5E1'}`,
      fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold',
      color: active ? '#DC2626' : '#64748B',
    }}>
      <span style={{
        display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
        backgroundColor: active ? '#DC2626' : '#94A3B8',
        boxShadow: active ? '0 0 6px rgba(220, 38, 38, 0.6)' : 'none'
      }} />
      SPEED BRAKE [{active ? 'DEPLOYED' : 'RETRACTED'}]
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Aero efficiency display
// ─────────────────────────────────────────────────────────────
function AeroPanel({ CL, CD, LD, Nz, alpha_deg }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
      gap: '6px', padding: '8px',
      background: '#F8FAFC', borderRadius: '6px',
      border: '1px solid #E2E8F0',
    }}>
      {[
        { l: 'CL', v: CL?.toFixed(3), w: CL > 1.3 },
        { l: 'CD', v: CD?.toFixed(4) },
        { l: 'L/D', v: LD?.toFixed(1), w: LD < 5 },
        { l: 'Nz (g)', v: Nz?.toFixed(2), w: Math.abs(Nz) > 2.5 },
        { l: 'AoA°', v: alpha_deg?.toFixed(1), w: Math.abs(alpha_deg) > 12 },
      ].map(({ l, v, w }) => (
        <div key={l} style={{ textAlign: 'center' }}>
          <div style={{ color: '#64748B', fontSize: '9px', fontFamily: 'monospace', fontWeight: '600' }}>{l}</div>
          <div style={{ color: w ? '#DC2626' : '#0F172A', fontSize: '13px', fontWeight: 'bold', fontFamily: 'monospace' }}>{v ?? '--'}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Main ControlSurfaceInspector Component
// ─────────────────────────────────────────────────────────────
export default function ControlSurfaceInspector({ fcs = {} }) {
  const {
    elevator_deg = 0, aileron_deg = 0, rudder_deg = 0,
    flap_deg = 0, throttle_pct = 38, speed_brake = false,
    thrust_N = 684, CL = 0.28, CD = 0.02, LD = 14,
    Nz = 1.0, alpha_deg = 2.87,
  } = fcs;

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '10px',
      border: '1px solid #E2E8F0', padding: '12px',
      fontFamily: 'monospace', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
    }}>
      <div style={{ color: '#334155', fontSize: '11px', marginBottom: '10px', letterSpacing: '0.08em', fontWeight: 'bold' }}>
        CONTROL SURFACE DEFLECTION INSPECTOR
      </div>

      {/* Throttle bar */}
      <ThrustBar throttle_pct={throttle_pct} thrust_N={thrust_N} />

      {/* Surface gauges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px' }}>
        <ArcGauge
          label="ELEVATOR"
          value={elevator_deg}
          min={-25} max={25}
          unit="°"
          warnHigh={20} warnLow={-20}
          color="#0284C7"
        />
        <ArcGauge
          label="AILERON"
          value={aileron_deg}
          min={-20} max={20}
          unit="°"
          warnHigh={18} warnLow={-18}
          color="#7C3AED"
        />
        <ArcGauge
          label="RUDDER"
          value={rudder_deg}
          min={-25} max={25}
          unit="°"
          warnHigh={20} warnLow={-20}
          color="#EA580C"
        />
        <ArcGauge
          label="FLAP"
          value={flap_deg}
          min={0} max={40}
          unit="°"
          warnHigh={38}
          color="#059669"
        />
        <ArcGauge
          label="BANK ROLL"
          value={fcs.roll_deg ?? 0}
          min={-90} max={90}
          unit="°"
          warnHigh={45} warnLow={-45}
          color="#D97706"
        />
      </div>

      {/* Speed brake */}
      <div style={{ margin: '8px 0', textAlign: 'center' }}>
        <SpeedBrakeIndicator active={speed_brake} />
      </div>

      {/* Aero efficiency */}
      <AeroPanel CL={CL} CD={CD} LD={LD} Nz={Nz} alpha_deg={alpha_deg} />
    </div>
  );
}
