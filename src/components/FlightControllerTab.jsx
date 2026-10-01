/**
 * FlightControllerTab.jsx
 * ========================
 * Master Flight Controller tab for GarudaTwin MALE UAV Digital Twin.
 *
 * Sections:
 *  1. Primary Flight Display (PFD)
 *  2. Autopilot Mode Selector panel
 *  3. TECS Energy Graph (live altitude + airspeed vs. setpoints)
 *  4. Control Surface Inspector
 *  5. FCS Database history viewer (from SQLite sortie records)
 *  6. FADEC Interlock Status panel
 *  7. Performance envelope display (Nz, L/D, Mach)
 */

import { gatewayFetch } from '../api/gateway';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import PrimaryFlightDisplay   from './PrimaryFlightDisplay';
import ControlSurfaceInspector from './ControlSurfaceInspector';
import { useTelemetry }        from '../context/TelemetryContext';

/// ─────────────────────────────────────────────────────────────
//  TECS Energy Chart (micro canvas chart, 60-sample rolling)
// ─────────────────────────────────────────────────────────────
function TecsEnergyChart({ fcsHistory }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fcsHistory.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, W, H);

    const n = fcsHistory.length;
    const altData = fcsHistory.map(f => f.alt_ft ?? 14500);
    const iasData = fcsHistory.map(f => f.ias_kts ?? 110);
    const minAlt = Math.min(...altData), maxAlt = Math.max(...altData);
    const altRange = Math.max(maxAlt - minAlt, 100);
    const minIas = Math.min(...iasData), maxIas = Math.max(...iasData);
    const iasRange = Math.max(maxIas - minIas, 10);

    function drawLine(data, min, range, color, yOffset, yScale) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = (i / (n - 1)) * W;
        const y = H * yOffset - ((v - min) / range) * H * yScale;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Altitude (top half, sky blue)
    drawLine(altData, minAlt, altRange, '#0284C7', 0.48, 0.45);
    // IAS (bottom half, emerald green)
    drawLine(iasData, minIas, iasRange, '#059669', 0.98, 0.45);

    // Labels
    ctx.fillStyle = '#0284C7'; ctx.font = 'bold 9px monospace';
    ctx.fillText(`ALT ${Math.round(altData[n-1])} ft`, 4, 14);
    ctx.fillStyle = '#059669';
    ctx.fillText(`IAS ${iasData[n-1]?.toFixed(0)} kts`, 4, H / 2 + 14);

    // Divider
    ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  }, [fcsHistory]);

  return (
    <canvas ref={canvasRef} width={340} height={120}
      style={{ borderRadius: '6px', border: '1px solid #CBD5E1', display: 'block' }} />
  );
}

// ─────────────────────────────────────────────────────────────
//  Tactical Navigation Display (ND) — 50 Hz Radar & Waypoint Tracker
// ─────────────────────────────────────────────────────────────
function TacticalNavDisplay({ fcs }) {
  const canvasRef = useRef(null);
  const trailRef = useRef([]);

  const curN = fcs.north_m ?? 0;
  const curE = fcs.east_m ?? 0;
  const curHdg = (fcs.heading_deg ?? 0) * Math.PI / 180;
  const waypoints = fcs.waypoints ?? [];
  const activeWp = fcs.target_wp;
  const wpIdx = fcs.wp_idx ?? 0;

  // Track flight path history
  useEffect(() => {
    trailRef.current = [...trailRef.current.slice(-250), { n: curN, e: curE }];
  }, [curN, curE]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Deep Tactical Canvas Background
    ctx.fillStyle = '#040714';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    // Scale: 6 km radius fits across the display
    const scale = (Math.min(W, H) * 0.44) / 5000;

    // Range Rings
    ctx.strokeStyle = 'rgba(0, 170, 255, 0.12)';
    ctx.lineWidth = 1;
    [1000, 2500, 5000].forEach(r => {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0, 170, 255, 0.35)';
      ctx.font = '8px monospace';
      ctx.fillText(`${(r / 1000).toFixed(1)}km`, cx + r * scale + 3, cy - 3);
    });

    // Crosshairs
    ctx.strokeStyle = 'rgba(0, 170, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(cx, 8); ctx.lineTo(cx, H - 8);
    ctx.moveTo(8, cy); ctx.lineTo(W - 8, cy);
    ctx.stroke();

    // Cardinal Markers
    ctx.fillStyle = '#00aaff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N (000°)', cx, 14);
    ctx.fillText('S (180°)', cx, H - 4);
    ctx.textAlign = 'left';
    ctx.fillText('E (090°)', W - 46, cy - 4);
    ctx.textAlign = 'right';
    ctx.fillText('W (270°)', 46, cy - 4);

    const toScreen = (e, n) => ({
      x: cx + (e - curE) * scale,
      y: cy - (n - curN) * scale,
    });

    // 1. Draw Past Flight Trail (Breadcrumbs)
    const trail = trailRef.current;
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      trail.forEach((pt, i) => {
        const sc = toScreen(pt.e, pt.n);
        i === 0 ? ctx.moveTo(sc.x, sc.y) : ctx.lineTo(sc.x, sc.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Draw Waypoints and Mission Route Legs
    if (waypoints.length > 0) {
      // Connect all waypoints with route corridor line
      ctx.strokeStyle = 'rgba(0, 170, 255, 0.6)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      waypoints.forEach((wp, i) => {
        const sc = toScreen(wp.east, wp.north);
        i === 0 ? ctx.moveTo(sc.x, sc.y) : ctx.lineTo(sc.x, sc.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw active leg from UAV to target waypoint
      if (activeWp) {
        const targetSc = toScreen(activeWp.east, activeWp.north);
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(targetSc.x, targetSc.y);
        ctx.stroke();
      }

      // Draw each waypoint marker
      waypoints.forEach((wp, i) => {
        const sc = toScreen(wp.east, wp.north);
        const isCurrent = i === wpIdx;

        if (isCurrent) {
          ctx.strokeStyle = '#00ffcc';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, 10, 0, 2 * Math.PI);
          ctx.stroke();
        }

        ctx.fillStyle = isCurrent ? '#00ffcc' : '#0077aa';
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y - 6);
        ctx.lineTo(sc.x + 6, sc.y);
        ctx.lineTo(sc.x + 6, sc.y);
        ctx.lineTo(sc.x - 6, sc.y);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = isCurrent ? '#ffffff' : '#88aacc';
        ctx.font = isCurrent ? 'bold 10px monospace' : '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`WP ${i + 1}`, sc.x + 8, sc.y + 3);
      });
    }

    // 3. Draw Aircraft Silhouette at Center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(curHdg);

    ctx.fillStyle = '#00ff88';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(9, 10);
    ctx.lineTo(3, 7);
    ctx.lineTo(0, 10);
    ctx.lineTo(-3, 7);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Forward Velocity Vector
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -30);
    ctx.stroke();
    ctx.restore();

    // 4. Tactical Data HUD Overlays
    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`NAV MODE: ${fcs.ap_mode ?? 'ALT_HOLD'}`, 12, 18);

    ctx.fillStyle = '#88aacc';
    ctx.font = '9px monospace';
    ctx.fillText(`POS: N ${Math.round(curN)}m · E ${Math.round(curE)}m`, 12, 32);
    ctx.fillText(`HDG: ${Math.round(fcs.heading_deg ?? 0)}° · GS: ${(fcs.tas_kts ?? 110).toFixed(0)} kts`, 12, 46);

    if (activeWp) {
      const dn = activeWp.north - curN;
      const de = activeWp.east - curE;
      const dist = Math.sqrt(dn * dn + de * de);
      const bearing = (((Math.atan2(de, dn) * 180 / Math.PI) % 360) + 360) % 360;
      const gsMs = Math.max(1, (fcs.tas_kts ?? 110) * 0.514444);
      const eteSec = Math.round(dist / gsMs);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#00ffcc';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`TARGET: WP ${(wpIdx ?? 0) + 1} / ${waypoints.length || 5}`, W - 12, 18);

      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`DIST: ${Math.round(dist)} m`, W - 12, 33);

      ctx.fillStyle = '#88aacc';
      ctx.font = '9px monospace';
      ctx.fillText(`BRG: ${Math.round(bearing)}° · ETE: ${eteSec}s`, W - 12, 47);
    }
  }, [curN, curE, curHdg, waypoints, activeWp, wpIdx, fcs]);

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '10px',
      border: '1px solid #E2E8F0', padding: '10px',
      boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ color: '#334155', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.08em' }}>
          🎯 TACTICAL NAVIGATION DISPLAY (50 Hz RADAR)
        </span>
        <span style={{ color: fcs.ap_mode === 'AUTO_MISSION' ? '#0284C7' : '#94A3B8', fontSize: '10px', fontWeight: 'bold' }}>
          {fcs.ap_mode === 'AUTO_MISSION' ? '● LIVE DYNAMIC TRACKING' : '○ STANDBY'}
        </span>
      </div>
      <canvas ref={canvasRef} width={620} height={200}
        style={{ borderRadius: '6px', border: '1px solid #CBD5E1', display: 'block', width: '100%', height: '200px' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Autopilot Mode Selector
// ─────────────────────────────────────────────────────────────
function AutopilotPanel({ fcs, setFcsMode, setFcsAltitude, setFcsAirspeed, setFcsHeading, fcsArm, fcsDisarm, loadFcsMission, fcsReset }) {
  const [altInput, setAltInput] = useState('14500');
  const [iasInput, setIasInput] = useState('110');
  const [hdgInput, setHdgInput] = useState('0');
  const [lastCmd, setLastCmd] = useState('');

  const MODE_BUTTONS = [
    { id: 'MANUAL_FBW',     label: 'MAN FBW',   col: '#475569' },
    { id: 'ALT_HOLD',       label: 'ALT HLD',   col: '#059669' },
    { id: 'LOITER',         label: 'LOITER',    col: '#D97706' },
    { id: 'AUTO_MISSION',   label: 'AUTO NAV',  col: '#0284C7' },
    { id: 'EMERGENCY_GLIDE',label: 'EMERG GLD', col: '#DC2626' },
  ];

  const currentMode = fcs.ap_mode ?? 'ALT_HOLD';
  const [demoLoaded, setDemoLoaded] = useState(false);

  const sendAlt = (val) => {
    const v = parseFloat(val ?? altInput);
    if (!isNaN(v)) {
      setFcsAltitude(v);
      setLastCmd(`ALT → ${Math.round(v)} ft`);
      setTimeout(() => setLastCmd(''), 2500);
    }
  };

  const sendIas = (val) => {
    const v = parseFloat(val ?? iasInput);
    if (!isNaN(v)) {
      setFcsAirspeed(v);
      setLastCmd(`IAS → ${Math.round(v)} kts`);
      setTimeout(() => setLastCmd(''), 2500);
    }
  };

  const sendHdg = (val) => {
    const v = parseFloat(val ?? hdgInput);
    if (!isNaN(v)) {
      setFcsHeading(v);
      setLastCmd(`HDG → ${String(Math.round(v)).padStart(3, '0')}°`);
      setTimeout(() => setLastCmd(''), 2500);
    }
  };

  const handleLoadDemoMission = () => {
    const curN = fcs.north_m ?? 0;
    const curE = fcs.east_m ?? 0;
    const curAlt = fcs.alt_ft ? (fcs.alt_ft * 0.3048) : 4419.6;

    const wps = [
      { north: Math.round(curN + 2500), east: Math.round(curE + 1200), alt_m: Math.round(curAlt) },
      { north: Math.round(curN + 5000), east: Math.round(curE + 2500), alt_m: Math.round(curAlt + 100) },
      { north: Math.round(curN + 5000), east: Math.round(curE - 1500), alt_m: Math.round(curAlt + 100) },
      { north: Math.round(curN + 2500), east: Math.round(curE - 1500), alt_m: Math.round(curAlt) },
      { north: Math.round(curN + 500),  east: Math.round(curE),        alt_m: Math.round(curAlt) },
    ];
    loadFcsMission(wps);
    setFcsMode('AUTO_MISSION');
    setDemoLoaded(true);
    setTimeout(() => setDemoLoaded(false), 6000);
  };

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '10px',
      border: '1px solid #E2E8F0', padding: '12px',
      fontFamily: 'monospace', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ color: '#334155', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.08em' }}>
          AUTOPILOT FLIGHT DIRECTOR [AP-6DOF]
        </div>
        {lastCmd && (
          <div style={{ fontSize: '9px', color: '#047857', background: '#ECFDF5', border: '1px solid #10B981', padding: '1px 6px', borderRadius: '3px', fontWeight: 'bold' }}>
            ACK: {lastCmd}
          </div>
        )}
      </div>

      {/* ARM / DISARM */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        <button onClick={fcsArm}
          style={{ flex: 1, padding: '6px', background: fcs.ap_armed ? '#ECFDF5' : '#F8FAFC',
            border: `1.5px solid ${fcs.ap_armed ? '#10B981' : '#CBD5E1'}`,
            color: fcs.ap_armed ? '#047857' : '#64748B', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>
          {fcs.ap_armed ? 'SYS ARMED' : 'ARM SYSTEM'}
        </button>
        <button onClick={fcsDisarm}
          style={{ flex: 1, padding: '6px', background: '#F8FAFC',
            border: '1.5px solid #CBD5E1',
            color: '#64748B', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>
          DISARM
        </button>
        <button onClick={fcsReset}
          style={{ padding: '6px 10px', background: '#FEF2F2',
            border: '1.5px solid #EF4444',
            color: '#B91C1C', borderRadius: '4px',
            fontFamily: 'monospace', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}>
          RESET
        </button>
      </div>

      {/* Mode buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '6px', marginBottom: '10px' }}>
        {MODE_BUTTONS.map(({ id, label, col }) => {
          const isSel = currentMode === id;
          return (
            <button key={id}
              onClick={() => setFcsMode(id)}
              style={{
                padding: '7px', borderRadius: '5px',
                background: isSel ? '#F0F9FF' : '#F8FAFC',
                border: `1.5px solid ${isSel ? '#0284C7' : '#E2E8F0'}`,
                color: isSel ? '#0369A1' : '#64748B',
                fontFamily: 'monospace', fontSize: '10px', cursor: 'pointer',
                fontWeight: isSel ? 'bold' : 'normal',
                boxShadow: isSel ? '0 1px 2px rgba(2, 132, 199, 0.15)' : 'none'
              }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Setpoint controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginBottom: '8px' }}>
        {/* ALTITUDE */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B', fontSize: '9px', marginBottom: '2px' }}>
            <span>ALT (ft)</span>
            <span style={{ color: '#0284C7', fontWeight: 'bold' }}>HOLD: {fcs.alt_sp_ft ?? 14500}</span>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <input
              type="number"
              value={altInput}
              onChange={e => setAltInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendAlt()}
              style={{
                flex: 1, background: '#F8FAFC', border: '1px solid #CBD5E1',
                color: '#0F172A', fontFamily: 'monospace', fontSize: '11px',
                padding: '3px 4px', borderRadius: '3px', width: '100%',
              }}
            />
            <button onClick={() => sendAlt()}
              style={{ padding: '3px 5px', background: '#E0F2FE', border: '1px solid #0284C7',
                color: '#0284C7', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>
              ↵
            </button>
          </div>
          {/* Quick ALT presets */}
          <div style={{ display: 'flex', gap: '2px', marginTop: '3px' }}>
            {[10000, 15000, 18000, 20000].map(v => (
              <button key={v}
                onClick={() => { setAltInput(String(v)); sendAlt(v); }}
                style={{
                  flex: 1, padding: '2px 0', background: '#F1F5F9', border: '1px solid #E2E8F0',
                  color: '#475569', fontSize: '8px', cursor: 'pointer', borderRadius: '2px', fontWeight: '600'
                }}>
                {v / 1000}k
              </button>
            ))}
          </div>
        </div>

        {/* AIRSPEED */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B', fontSize: '9px', marginBottom: '2px' }}>
            <span>IAS (kts)</span>
            <span style={{ color: '#0284C7', fontWeight: 'bold' }}>HOLD: {fcs.ias_sp_kts ?? 110}</span>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <input
              type="number"
              value={iasInput}
              onChange={e => setIasInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendIas()}
              style={{
                flex: 1, background: '#F8FAFC', border: '1px solid #CBD5E1',
                color: '#0F172A', fontFamily: 'monospace', fontSize: '11px',
                padding: '3px 4px', borderRadius: '3px', width: '100%',
              }}
            />
            <button onClick={() => sendIas()}
              style={{ padding: '3px 5px', background: '#E0F2FE', border: '1px solid #0284C7',
                color: '#0284C7', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>
              ↵
            </button>
          </div>
          {/* Quick IAS presets */}
          <div style={{ display: 'flex', gap: '2px', marginTop: '3px' }}>
            {[90, 110, 150, 200].map(v => (
              <button key={v}
                onClick={() => { setIasInput(String(v)); sendIas(v); }}
                style={{
                  flex: 1, padding: '2px 0', background: '#F1F5F9', border: '1px solid #E2E8F0',
                  color: '#475569', fontSize: '8px', cursor: 'pointer', borderRadius: '2px', fontWeight: '600'
                }}>
                {v}kt
              </button>
            ))}
          </div>
        </div>

        {/* HEADING */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B', fontSize: '9px', marginBottom: '2px' }}>
            <span>HDG (°)</span>
            <span style={{ color: '#0284C7', fontWeight: 'bold' }}>HOLD: {String(fcs.heading_sp_deg ?? 0).padStart(3, '0')}°</span>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <input
              type="number"
              value={hdgInput}
              onChange={e => setHdgInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendHdg()}
              style={{
                flex: 1, background: '#F8FAFC', border: '1px solid #CBD5E1',
                color: '#0F172A', fontFamily: 'monospace', fontSize: '11px',
                padding: '3px 4px', borderRadius: '3px', width: '100%',
              }}
            />
            <button onClick={() => sendHdg()}
              style={{ padding: '3px 5px', background: '#E0F2FE', border: '1px solid #0284C7',
                color: '#0284C7', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontWeight: 'bold' }}>
              ↵
            </button>
          </div>
          {/* Quick HDG presets */}
          <div style={{ display: 'flex', gap: '2px', marginTop: '3px' }}>
            {[0, 90, 180, 270].map(v => (
              <button key={v}
                onClick={() => { setHdgInput(String(v)); sendHdg(v); }}
                style={{
                  flex: 1, padding: '2px 0', background: '#F1F5F9', border: '1px solid #E2E8F0',
                  color: '#475569', fontSize: '8px', cursor: 'pointer', borderRadius: '2px', fontWeight: '600'
                }}>
                {String(v).padStart(3, '0')}°
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Demo mission button */}
      <button onClick={handleLoadDemoMission}
        style={{ width: '100%', padding: '7px', background: demoLoaded ? '#ECFDF5' : '#F0F9FF',
          border: `1.5px ${demoLoaded ? 'solid #10B981' : 'dashed #0284C7'}`,
          color: demoLoaded ? '#047857' : '#0369A1', borderRadius: '4px',
          fontFamily: 'monospace', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold' }}>
        {demoLoaded ? 'MISSION ACTIVE (5 WPs LOADED)' : 'LOAD MISSION PROFILE (5 WP BOX PATTERN)'}
      </button>

      {/* Active Mission Banner */}
      {fcs.ap_mode === 'AUTO_MISSION' && (
        <div style={{ marginTop: '8px', padding: '6px 8px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '4px', fontSize: '10px', color: '#166534' }}>
          <div style={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
            <span>AUTO MISSION FLIGHT PLAN</span>
            <span>WP {(fcs.wp_idx ?? 0) + 1} / {fcs.total_wps || 5}</span>
          </div>
          {fcs.target_wp && (
            <div style={{ fontSize: '9px', color: '#15803D', marginTop: '2px' }}>
              Target: N {Math.round(fcs.target_wp.north)}m · E {Math.round(fcs.target_wp.east)}m · Alt {Math.round(fcs.target_wp.alt_m * 3.28084)}ft
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  FADEC Interlock Status panel
// ─────────────────────────────────────────────────────────────
function FadecInterlockPanel({ fcs, injectFault, clearFault }) {
  const anns = [
    { key: 'engine_out',     label: 'ENGINE OUT',  crit: true  },
    { key: 'stall_warn',     label: 'STALL WARN',  crit: false },
    { key: 'overspeed_warn', label: 'OVERSPEED',   crit: true  },
    { key: 'g_limit_active', label: 'G-LIMIT',     crit: false },
    { key: 'fuel_bingo',     label: 'FUEL BINGO',  crit: false },
  ];
  const derate = fcs.engine_derate ?? 'NOMINAL';
  const isEmergency = fcs.engine_out || fcs.ap_mode === 'EMERGENCY_GLIDE' || derate === 'FLAMEOUT' || derate === 'CRITICAL';
  const derateCol = derate === 'NOMINAL' ? '#059669' : isEmergency ? '#DC2626' : '#D97706';

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '10px',
      border: '1px solid #E2E8F0', padding: '12px',
      fontFamily: 'monospace', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ color: '#334155', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.08em' }}>
          FADEC INTERLOCK STATUS
        </div>
        <div style={{
          fontSize: '9px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '3px',
          background: isEmergency ? '#FEF2F2' : '#ECFDF5',
          color: isEmergency ? '#B91C1C' : '#047857',
          border: `1px solid ${isEmergency ? '#FECACA' : '#A7F3D0'}`
        }}>
          {isEmergency ? 'INTERLOCK ACTIVE' : 'NOMINAL SAFEGUARD'}
        </div>
      </div>

      {/* Derate label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ color: '#64748B', fontSize: '10px', fontWeight: '600' }}>ENGINE DERATE STATUS:</span>
        <span style={{ color: derateCol, fontWeight: 'bold', fontSize: '12px' }}>{derate}</span>
      </div>

      {/* Annunciator matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
        {anns.map(({ key, label, crit }) => {
          const active = fcs[key] ?? false;
          return (
            <div key={key} style={{
              padding: '5px 8px', borderRadius: '4px',
              background: active ? (crit ? '#FEF2F2' : '#FFFBEB') : '#F8FAFC',
              border: `1px solid ${active ? (crit ? '#EF4444' : '#F59E0B') : '#E2E8F0'}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '9px', fontWeight: 'bold', color: active ? (crit ? '#B91C1C' : '#B45309') : '#64748B' }}>
                {label}
              </span>
              <span style={{
                fontSize: '9px', fontWeight: 'bold',
                color: active ? (crit ? '#DC2626' : '#D97706') : '#CBD5E1',
              }}>
                {active ? '●' : '○'}
              </span>
            </div>
          );
        })}
      </div>

      {/* FADEC Authority and Thrust Limit Telemetry */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginTop: '8px' }}>
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '4px 6px' }}>
          <div style={{ color: '#64748B', fontSize: '8px', fontWeight: '600' }}>THRUST CEILING</div>
          <div style={{ color: isEmergency ? '#DC2626' : '#059669', fontSize: '11px', fontWeight: 'bold' }}>
            {Math.round((fcs.thrust_factor ?? 1) * 100)}%
          </div>
        </div>
        <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '4px 6px' }}>
          <div style={{ color: '#64748B', fontSize: '8px', fontWeight: '600' }}>CONTROL AUTHORITY</div>
          <div style={{ color: '#0284C7', fontSize: '11px', fontWeight: 'bold' }}>
            {Math.round((fcs.authority_factor ?? 1) * 100)}%
          </div>
        </div>
      </div>

      {/* Glide range badge: Informational cyan in nominal, red warning only during emergency */}
      {fcs.glide_range_m > 0 && (
        <div style={{
          marginTop: '8px', padding: '6px 8px', borderRadius: '4px',
          background: isEmergency ? '#FEF2F2' : '#F0F9FF',
          border: `1px solid ${isEmergency ? '#FECACA' : '#BAE6FD'}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span style={{ color: isEmergency ? '#B91C1C' : '#0369A1', fontSize: '10px', fontWeight: 'bold' }}>
            {isEmergency ? 'EMERGENCY GLIDE REACH' : 'MAX GLIDE RANGE (L/D 14.5)'}
          </span>
          <span style={{ color: isEmergency ? '#DC2626' : '#0284C7', fontSize: '11px', fontWeight: 'bold' }}>
            {(fcs.glide_range_m / 1000).toFixed(1)} km
          </span>
        </div>
      )}

      {/* Interactive FADEC Interlock Verification Triggers */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button
          onClick={() => injectFault && injectFault('CYL3_INJECTOR', 0.95)}
          style={{
            flex: 1, padding: '5px', background: '#FFF7ED', border: '1px solid #F97316',
            color: '#C2410C', borderRadius: '4px', fontSize: '9px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold'
          }}>
          INJECT FLAMEOUT (CYL 3)
        </button>
        <button
          onClick={() => clearFault && clearFault()}
          style={{
            flex: 1, padding: '5px', background: '#ECFDF5', border: '1px solid #10B981',
            color: '#047857', borderRadius: '4px', fontSize: '9px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold'
          }}>
          RESTORE NOMINAL BASELINE
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  FCS Database History Panel
// ─────────────────────────────────────────────────────────────
function FcsDatabasePanel() {
  const [sorties, setSorties]     = useState([]);
  const [selected, setSelected]   = useState(null);
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(false);

  const fetchSorties = async () => {
    try {
      const res = await gatewayFetch('/api/database/sorties');
      const data = await res.json();
      if (data.success) setSorties(data.sorties);
    } catch (e) { /* ignore */ }
  };

  const fetchRows = async (id) => {
    setLoading(true);
    try {
      const res = await gatewayFetch(`/api/database/fcs/${id}?limit=50`);
      const data = await res.json();
      if (data.success) setRows(data.data);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchSorties(); }, []);

  // Download via fetch so the gateway URL works both direct and behind a proxy
  const exportCsv = async () => {
    try {
      const res = await gatewayFetch(`/api/database/export/csv/${selected}`);
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `sortie_${selected}_fcs.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { /* ignore */ }
  };

  const handleSelect = (id) => {
    setSelected(id);
    fetchRows(id);
  };

  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '10px',
      border: '1px solid #E2E8F0', padding: '12px',
      fontFamily: 'monospace', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ color: '#334155', fontSize: '11px', fontWeight: 'bold' }}>SORTIE HISTORICAL ARCHIVE [SQLITE3]</span>
        <button onClick={fetchSorties}
          style={{ padding: '3px 8px', background: '#F8FAFC', border: '1px solid #CBD5E1',
            color: '#475569', borderRadius: '3px', cursor: 'pointer', fontSize: '9px', fontWeight: 'bold' }}>
          REFRESH
        </button>
      </div>

      {/* Sortie list */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {sorties.map(s => (
          <button key={s.id}
            onClick={() => handleSelect(s.id)}
            style={{
              padding: '3px 8px', borderRadius: '3px',
              background: selected === s.id ? '#F0F9FF' : '#F8FAFC',
              border: `1px solid ${selected === s.id ? '#0284C7' : '#CBD5E1'}`,
              color: selected === s.id ? '#0369A1' : '#64748B',
              fontSize: '9px', cursor: 'pointer', fontWeight: selected === s.id ? 'bold' : 'normal'
            }}>
            #{s.id} {s.uav_id}
          </button>
        ))}
      </div>

      {/* FCS data table */}
      {loading && <div style={{ color: '#64748B', fontSize: '10px' }}>Loading...</div>}
      {rows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto', maxHeight: '160px', overflowY: 'auto' }}>
            <table style={{ fontSize: '9px', color: '#334155', borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                  {['Roll°','Pitch°','Hdg°','IAS','ALT','VSI','Mode'].map(h => (
                    <th key={h} style={{ padding: '2px 4px', color: '#64748B', textAlign: 'left', fontWeight: 'bold' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(-20).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '2px 4px' }}>{r.roll_deg?.toFixed(1)}</td>
                    <td style={{ padding: '2px 4px' }}>{r.pitch_deg?.toFixed(1)}</td>
                    <td style={{ padding: '2px 4px' }}>{r.heading_deg?.toFixed(0)}</td>
                    <td style={{ padding: '2px 4px' }}>{r.ias_kts?.toFixed(0)}</td>
                    <td style={{ padding: '2px 4px' }}>{r.alt_ft?.toFixed(0)}</td>
                    <td style={{ padding: '2px 4px', fontWeight: 'bold', color: r.vsi_fpm > 0 ? '#059669' : r.vsi_fpm < -50 ? '#DC2626' : '#64748B' }}>{r.vsi_fpm?.toFixed(0)}</td>
                    <td style={{ padding: '2px 4px', fontWeight: 'bold', color: '#0284C7' }}>{r.ap_mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <button
              onClick={exportCsv}
              style={{ display: 'inline-block', marginTop: '6px', padding: '4px 8px',
                background: '#F0F9FF', border: '1px solid #0284C7', color: '#0369A1', cursor: 'pointer',
                borderRadius: '3px', fontSize: '9px', fontWeight: 'bold', textDecoration: 'none' }}>
              EXPORT CSV (MISSION LOG)
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Kinematics Info Bar
// ─────────────────────────────────────────────────────────────
function KinematicsBar({ fcs }) {
  const items = [
    { l: 'TAS', v: fcs.tas_kts?.toFixed(0) + ' kts' },
    { l: 'MACH', v: fcs.mach?.toFixed(3) },
    { l: 'BETA°', v: fcs.beta_deg?.toFixed(1) },
    { l: 'p°/s', v: fcs.p_dps?.toFixed(1) },
    { l: 'q°/s', v: fcs.q_dps?.toFixed(1) },
    { l: 'r°/s', v: fcs.r_dps?.toFixed(1) },
    { l: 'L/D', v: fcs.LD?.toFixed(1) },
    { l: 'FCS t', v: fcs.fcs_time_s?.toFixed(0) + 's' },
  ];
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '8px 10px',
      background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
      {items.map(({ l, v }) => (
        <div key={l} style={{ textAlign: 'center', minWidth: '45px', flex: 1 }}>
          <div style={{ color: '#64748B', fontSize: '8px', fontWeight: 'bold' }}>{l}</div>
          <div style={{ color: '#0F172A', fontSize: '11px', fontWeight: 'bold', fontFamily: 'monospace' }}>{v ?? '--'}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Main FlightControllerTab
// ─────────────────────────────────────────────────────────────
export default function FlightControllerTab() {
  const {
    fcsState,
    setFcsMode, setFcsAltitude, setFcsAirspeed, setFcsHeading,
    setFcsLoiter, loadFcsMission, fcsArm, fcsDisarm, fcsFbwInput, fcsReset,
    injectFault, clearFault,
    telemetry,
  } = useTelemetry();

  // Rolling history for TECS chart
  const historyRef = useRef([]);
  useEffect(() => {
    historyRef.current = [...historyRef.current.slice(-59), { ...fcsState }];
  }, [fcsState]);
  const [fcsHistory, setFcsHistory] = useState([]);
  useEffect(() => {
    const id = setInterval(() => setFcsHistory([...historyRef.current]), 500);
    return () => clearInterval(id);
  }, []);

  const altSp  = fcsState.alt_sp_ft      ?? 14500;
  const iasSp  = fcsState.ias_sp_kts     ?? 110;
  const hdgSp  = fcsState.heading_sp_deg ?? 0;

  return (
    <div
      className="h-full w-full overflow-y-auto custom-scrollbar"
      style={{
        padding: '12px 12px 60px 12px',
        background: '#F8FAFC',
        fontFamily: 'monospace',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ color: '#0F172A', fontSize: '16px', fontWeight: 'bold', letterSpacing: '0.08em' }}>
            FLIGHT CONTROL SYSTEM (FCS)
          </div>
          <div style={{ color: '#64748B', fontSize: '10px', marginTop: '2px' }}>
            GarudaTwin MALE UAV — 6-DOF Physics + TECS + L1 Guidance | 50 Hz
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            padding: '4px 12px', borderRadius: '4px',
            background: fcsState.ap_armed ? '#ECFDF5' : '#FEF2F2',
            border: `1px solid ${fcsState.ap_armed ? '#10B981' : '#EF4444'}`,
            color: fcsState.ap_armed ? '#047857' : '#B91C1C',
            fontSize: '11px', fontWeight: 'bold',
          }}>
            {fcsState.ap_mode ?? 'ALT_HOLD'}
          </div>
          <div style={{ color: '#64748B', fontSize: '9px', marginTop: '3px' }}>
            FCS t={fcsState.fcs_time_s?.toFixed(0) ?? 0}s
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '10px' }}>

        {/* Left column: PFD */}
        <div>
          <PrimaryFlightDisplay fcs={fcsState} altSp={altSp} iasSp={iasSp} hdgSp={hdgSp} />
          <div style={{ marginTop: '8px' }}>
            <KinematicsBar fcs={fcsState} />
          </div>
        </div>

        {/* Right column: Controls + TECS + Surfaces + FADEC */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

          {/* Row 1: Autopilot + FADEC */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <AutopilotPanel
              fcs={fcsState}
              setFcsMode={setFcsMode}
              setFcsAltitude={setFcsAltitude}
              setFcsAirspeed={setFcsAirspeed}
              setFcsHeading={setFcsHeading}
              fcsArm={fcsArm}
              fcsDisarm={fcsDisarm}
              loadFcsMission={loadFcsMission}
              fcsReset={fcsReset}
            />
            <FadecInterlockPanel fcs={fcsState} injectFault={injectFault} clearFault={clearFault} />
          </div>

          {/* Row 2: Tactical Navigation Display (50 Hz Moving Radar Map) */}
          <TacticalNavDisplay fcs={fcsState} />

          {/* Row 3: TECS energy chart & Control Surface Inspector */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: '8px' }}>
            <div style={{
              background: '#FFFFFF', borderRadius: '10px',
              border: '1px solid #E2E8F0', padding: '10px',
              boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)'
            }}>
              <div style={{ color: '#334155', fontSize: '11px', fontWeight: 'bold', marginBottom: '6px' }}>
                TOTAL ENERGY CONTROL SYSTEM (TECS) — POTENTIAL &amp; KINETIC
              </div>
              <TecsEnergyChart fcsHistory={fcsHistory} />
            </div>
            <ControlSurfaceInspector fcs={fcsState} />
          </div>

          {/* Row 4: Database history */}
          <FcsDatabasePanel />
        </div>
      </div>
    </div>
  );
}
