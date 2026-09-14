/**
 * PrimaryFlightDisplay.jsx
 * ========================
 * Military-grade SVG Primary Flight Display (PFD) for GarudaTwin MALE UAV
 *
 * Instruments rendered:
 *  - Attitude Indicator (AI): Artificial horizon with pitch ladder, bank angle arc
 *  - Airspeed Tape: IAS in kts with trend vector
 *  - Altitude Tape: Altitude in ft with VSI (vertical speed indicator)
 *  - Heading Tape: Magnetic heading with compass arc
 *  - Mach number display
 *  - AoA (Angle of Attack) indicator with bracket
 *  - Load factor (Nz) readout
 *  - Flight director crosshair (magenta)
 *  - FADEC annunciator bar (stall/overspeed/G-limit/engine-out/fuel-bingo)
 *  - Autopilot mode annunciator (FMA - Flight Mode Annunciator)
 *  - Speed and altitude bugs (setpoints)
 *  - VSI arc on right side
 */

import React, { useRef, useEffect, useMemo } from 'react';

// ─────────────────────────────────────────────────────────────
//  Canvas drawing helpers
// ─────────────────────────────────────────────────────────────
const PFD_W  = 420;
const PFD_H  = 540;
const AI_CX  = 210;
const AI_CY  = 240;
const AI_R   = 165;   // attitude indicator radius

function drawHorizon(ctx, roll, pitch) {
  // Horizon background: sky top, earth bottom
  ctx.save();
  ctx.beginPath();
  ctx.arc(AI_CX, AI_CY, AI_R, 0, 2 * Math.PI);
  ctx.clip();

  const pitchPx = pitch * 4.5;   // pixels per degree

  ctx.save();
  ctx.translate(AI_CX, AI_CY);
  ctx.rotate(-roll * Math.PI / 180);

  // Sky
  ctx.fillStyle = '#1a3a6e';
  ctx.fillRect(-AI_R * 2, -AI_R * 2 - pitchPx, AI_R * 4, AI_R * 2 + AI_R * 2);

  // Earth
  ctx.fillStyle = '#5c3d1a';
  ctx.fillRect(-AI_R * 2, -pitchPx, AI_R * 4, AI_R * 2);

  // Horizon line
  ctx.strokeStyle = '#f5d060';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-AI_R * 2, -pitchPx);
  ctx.lineTo(AI_R * 2, -pitchPx);
  ctx.stroke();

  // Pitch ladder (every 5 degrees)
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  for (let p = -45; p <= 45; p += 5) {
    if (p === 0) continue;
    const y = -p * 4.5 - pitchPx;
    const len = p % 10 === 0 ? 48 : 28;
    ctx.lineWidth = p % 10 === 0 ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(-len / 2, y);
    ctx.lineTo(len / 2, y);
    ctx.stroke();
    if (p % 10 === 0) {
      ctx.fillText(Math.abs(p), -len / 2 - 14, y + 4);
      ctx.fillText(Math.abs(p), len / 2 + 14, y + 4);
    }
  }
  ctx.restore();
  ctx.restore();
}

function drawBankArc(ctx, roll) {
  // Bank angle arc + pointer
  const arcR = AI_R + 8;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const deg of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const rad = (deg - 90) * Math.PI / 180;
    const tickLen = deg % 30 === 0 ? 12 : 8;
    ctx.moveTo(AI_CX + arcR * Math.cos(rad), AI_CY + arcR * Math.sin(rad));
    ctx.lineTo(AI_CX + (arcR + tickLen) * Math.cos(rad), AI_CY + (arcR + tickLen) * Math.sin(rad));
  }
  ctx.stroke();

  // Bank pointer (triangle) — rotates with bank
  const ptrR = arcR + 2;
  const ptrRad = (-roll - 90) * Math.PI / 180;
  const px = AI_CX + ptrR * Math.cos(ptrRad);
  const py = AI_CY + ptrR * Math.sin(ptrRad);
  ctx.fillStyle = '#f5d060';
  ctx.beginPath();
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(ptrRad + Math.PI / 2);
  ctx.moveTo(0, -8);
  ctx.lineTo(-5, 5);
  ctx.lineTo(5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlightDirector(ctx, roll, pitch) {
  // Magenta crosshair — commands (simplified: show at 0/0 in this demo)
  const fdRoll = 0, fdPitch = 0;
  const dRoll  = (fdRoll  - roll)  * 2.5;
  const dPitch = (fdPitch - pitch) * 4.5;

  ctx.save();
  ctx.translate(AI_CX, AI_CY);
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 3;

  // Horizontal bar
  ctx.beginPath();
  ctx.moveTo(-50, dPitch);
  ctx.lineTo(50, dPitch);
  ctx.stroke();

  // Vertical bar
  ctx.beginPath();
  ctx.moveTo(dRoll, -50);
  ctx.lineTo(dRoll, 50);
  ctx.stroke();
  ctx.restore();
}

function drawAircraftSymbol(ctx) {
  // Fixed yellow aircraft symbol in center
  ctx.strokeStyle = '#f5d060';
  ctx.lineWidth = 3;
  ctx.beginPath();
  // Left wing
  ctx.moveTo(AI_CX - 55, AI_CY);
  ctx.lineTo(AI_CX - 20, AI_CY);
  // Fuselage notch
  ctx.moveTo(AI_CX - 8, AI_CY);
  ctx.lineTo(AI_CX + 8, AI_CY);
  // Right wing
  ctx.moveTo(AI_CX + 20, AI_CY);
  ctx.lineTo(AI_CX + 55, AI_CY);
  // Center dot
  ctx.arc(AI_CX, AI_CY, 4, 0, 2 * Math.PI);
  ctx.stroke();
}

function drawAIBezel(ctx) {
  ctx.strokeStyle = '#444466';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(AI_CX, AI_CY, AI_R + 2, 0, 2 * Math.PI);
  ctx.stroke();
}

function drawAirspeedTape(ctx, ias, ias_sp) {
  const x = 10, y = 100, w = 68, h = 280;
  // Tape background
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#3344aa';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const cx = x + w / 2;
  const pxPerKt = 3.5;
  const centerY = y + h / 2;

  // Speed ticks (every 5 kts)
  ctx.fillStyle = '#ccccdd';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  for (let spd = Math.floor((ias - 40) / 5) * 5; spd <= ias + 40; spd += 5) {
    if (spd < 0) continue;
    const ty = centerY - (spd - ias) * pxPerKt;
    if (ty < y || ty > y + h) continue;
    ctx.strokeStyle = '#7788aa';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + w - 12, ty);
    ctx.lineTo(x + w, ty);
    ctx.stroke();
    if (spd % 10 === 0) {
      ctx.fillStyle = '#ccccdd';
      ctx.fillText(spd, x + w - 14, ty + 4);
    }
  }

  // Vne redline (165 kts)
  const vneY = centerY - (165 - ias) * pxPerKt;
  if (vneY > y && vneY < y + h) {
    ctx.strokeStyle = '#ff2222';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, vneY); ctx.lineTo(x + w, vneY);
    ctx.stroke();
  }

  // Stall speed (58 kts) amber
  const stallY = centerY - (58 - ias) * pxPerKt;
  if (stallY > y && stallY < y + h) {
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, stallY); ctx.lineTo(x + w, stallY);
    ctx.stroke();
  }

  // Airspeed bug (setpoint)
  const spY = centerY - (ias_sp - ias) * pxPerKt;
  if (spY > y && spY < y + h) {
    ctx.strokeStyle = '#00ffcc';
    ctx.fillStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, spY); ctx.lineTo(x + 12, spY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 12, spY - 5);
    ctx.lineTo(x, spY);
    ctx.lineTo(x + 12, spY + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Current IAS box
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, centerY - 14, w, 28);
  ctx.strokeStyle = '#f5d060';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, centerY - 14, w, 28);
  ctx.fillStyle = '#f5d060';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(ias), cx, centerY + 6);

  // Label & bug readout
  ctx.fillStyle = '#8899bb';
  ctx.font = '9px monospace';
  ctx.fillText('IAS KTS', cx, y - 14);
  ctx.fillStyle = '#00ffcc';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(`SEL ${Math.round(ias_sp)}`, cx, y - 3);
}

function drawAltitudeTape(ctx, alt_ft, alt_sp, vsi_fpm) {
  const x = PFD_W - 78, y = 100, w = 68, h = 280;
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#3344aa';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const cx = x + w / 2;
  const pxPerFt = 0.07;
  const centerY = y + h / 2;

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ccccdd';
  ctx.font = '10px monospace';
  for (let a = Math.floor((alt_ft - 2000) / 500) * 500; a <= alt_ft + 2000; a += 500) {
    const ty = centerY - (a - alt_ft) * pxPerFt;
    if (ty < y || ty > y + h) continue;
    ctx.strokeStyle = '#7788aa'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x + 12, ty); ctx.stroke();
    ctx.fillStyle = '#ccccdd';
    const label = a >= 10000 ? (a / 1000).toFixed(1) + 'K' : a;
    ctx.fillText(label, x + 14, ty + 4);
  }

  // Altitude bug
  const spY = centerY - (alt_sp - alt_ft) * pxPerFt;
  if (spY > y && spY < y + h) {
    ctx.strokeStyle = '#00ffcc';
    ctx.fillStyle = '#00ffcc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w - 12, spY); ctx.lineTo(x + w, spY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + w - 12, spY - 5);
    ctx.lineTo(x + w, spY);
    ctx.lineTo(x + w - 12, spY + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Current altitude box
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, centerY - 14, w, 28);
  ctx.strokeStyle = '#f5d060'; ctx.lineWidth = 1.5;
  ctx.strokeRect(x, centerY - 14, w, 28);
  ctx.fillStyle = '#f5d060';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(Math.round(alt_ft / 10) * 10, cx, centerY + 6);

  // VSI (vertical speed) mini tape on far right
  const vsiX = x + w + 4, vsiW = 14, vsiH = h;
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(vsiX, y, vsiW, vsiH);
  const vsiPx = Math.min(Math.abs(vsi_fpm) * 0.025, vsiH / 2 - 4);
  ctx.fillStyle = vsi_fpm > 0 ? '#00ff88' : '#ff6622';
  const vsiY = vsi_fpm > 0 ? centerY - vsiPx : centerY;
  ctx.fillRect(vsiX + 2, vsiY, vsiW - 4, vsiPx);

  ctx.fillStyle = '#8899bb';
  ctx.font = '8px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(vsi_fpm > 0 ? '+' + Math.round(vsi_fpm / 10) * 10 : Math.round(vsi_fpm / 10) * 10, vsiX + vsiW / 2, vsi_fpm > 0 ? centerY - vsiPx - 3 : centerY + vsiPx + 10);

  // Label & bug readout
  ctx.fillStyle = '#8899bb';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('ALT FT', cx, y - 14);
  ctx.fillStyle = '#00ffcc';
  ctx.font = 'bold 10px monospace';
  ctx.fillText(`SEL ${Math.round(alt_sp)}`, cx, y - 3);
}

function drawHeadingTape(ctx, hdg, hdgSp) {
  const x = 90, y = PFD_H - 60, w = 240, h = 40;
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#3344aa'; ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);

  const cx = x + w / 2;
  const pxPerDeg = 2.8;

  ctx.font = '10px monospace';
  ctx.fillStyle = '#ccccdd';
  for (let d = -40; d <= 40; d += 5) {
    const hdgD = ((hdg + d) % 360 + 360) % 360;
    const tx = cx + d * pxPerDeg;
    if (tx < x || tx > x + w) continue;
    ctx.strokeStyle = '#7788aa'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(tx, y); ctx.lineTo(tx, y + 8); ctx.stroke();
    if (d % 10 === 0) {
      const label = hdgD === 0 ? 'N' : hdgD === 90 ? 'E' : hdgD === 180 ? 'S' : hdgD === 270 ? 'W' : hdgD;
      ctx.fillStyle = '#ccccdd';
      ctx.textAlign = 'center';
      ctx.fillText(label, tx, y + 22);
    }
  }

  // Heading setpoint bug (standard aviation cyan chevron bug)
  if (hdgSp !== undefined && hdgSp !== null) {
    let dHdg = ((hdgSp - hdg + 540) % 360) - 180;
    const bugX = cx + dHdg * pxPerDeg;
    if (bugX >= x && bugX <= x + w) {
      ctx.fillStyle = '#00ffcc';
      ctx.beginPath();
      ctx.moveTo(bugX - 6, y);
      ctx.lineTo(bugX + 6, y);
      ctx.lineTo(bugX, y + 9);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Center tick
  ctx.strokeStyle = '#f5d060'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + h); ctx.stroke();

  // Heading box
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - 24, y - 2, 48, 20);
  ctx.strokeStyle = '#f5d060'; ctx.lineWidth = 1;
  ctx.strokeRect(cx - 24, y - 2, 48, 20);
  ctx.fillStyle = '#f5d060';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(Math.round(hdg)).padStart(3, '0') + '°', cx, y + 13);

  // Commanded Heading readout (left side of tape)
  if (hdgSp !== undefined && hdgSp !== null) {
    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`BUG ${String(Math.round(hdgSp)).padStart(3, '0')}°`, x + 6, y + 34);
  }
}

function drawFMA(ctx, mode, armed) {
  // Flight Mode Annunciator (top bar)
  const modeColors = {
    ALT_HOLD: '#00ff88', AUTO_MISSION: '#00aaff',
    LOITER: '#ffaa00', EMERGENCY_GLIDE: '#ff2222',
    MANUAL_FBW: '#ffffff',
  };
  const col = modeColors[mode] || '#ffffff';
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(90, 8, 240, 36);
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.strokeRect(90, 8, 240, 36);
  ctx.fillStyle = col;
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(mode.replace('_', ' '), 210, 24);
  ctx.font = '9px monospace';
  ctx.fillStyle = armed ? '#00ff88' : '#ff6622';
  ctx.fillText(armed ? '▲ ARMED' : '▼ DISARMED', 210, 38);
}

function drawAnnunciators(ctx, anns) {
  const items = [
    { key: 'engine_out',     label: 'ENG OUT',  color: '#ff2222' },
    { key: 'stall_warn',     label: 'STALL',    color: '#ffaa00' },
    { key: 'overspeed_warn', label: 'OVSPD',    color: '#ff2222' },
    { key: 'g_limit_active', label: 'G LIM',    color: '#ffaa00' },
    { key: 'fuel_bingo',     label: 'BINGO',    color: '#ffaa00' },
  ];
  let activeX = 10;
  const baseY = PFD_H - 18;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  items.forEach(it => {
    if (!anns[it.key]) return;
    ctx.fillStyle = it.color;
    ctx.fillRect(activeX, baseY - 14, 52, 16);
    ctx.fillStyle = '#000000';
    ctx.fillText(it.label, activeX + 26, baseY - 2);
    activeX += 56;
  });
}

function drawDataBox(ctx, label, val, unit, x, y, warn) {
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(x, y, 80, 32);
  ctx.strokeStyle = warn ? '#ff6622' : '#3344aa';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, 80, 32);
  ctx.fillStyle = '#8899bb';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 4, y + 11);
  ctx.fillStyle = warn ? '#ff6622' : '#e8e8ff';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(val + (unit ? ' ' + unit : ''), x + 4, y + 26);
}

// ─────────────────────────────────────────────────────────────
//  Main PFD component
// ─────────────────────────────────────────────────────────────
export default function PrimaryFlightDisplay({ fcs = {}, altSp = 14500, iasSp = 110, hdgSp = 0 }) {
  const canvasRef = useRef(null);

  const {
    roll_deg    = 0,
    pitch_deg   = 2.87,
    heading_deg = 0,
    ias_kts     = 110,
    alt_ft      = 14500,
    vsi_fpm     = 0,
    mach        = 0.167,
    alpha_deg   = 2.87,
    Nz          = 1.0,
    ap_mode     = 'ALT_HOLD',
    ap_armed    = true,
    engine_out  = false,
    stall_warn  = false,
    overspeed_warn = false,
    g_limit_active = false,
    fuel_bingo  = false,
    engine_derate = 'NOMINAL',
    glide_range_m = 0,
  } = fcs;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, PFD_W, PFD_H);

    // Background
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, PFD_W, PFD_H);

    // Attitude Indicator
    drawHorizon(ctx, roll_deg, pitch_deg);
    drawBankArc(ctx, roll_deg);
    drawFlightDirector(ctx, roll_deg, pitch_deg);
    drawAircraftSymbol(ctx);
    drawAIBezel(ctx);

    // Tapes
    drawAirspeedTape(ctx, ias_kts, iasSp);
    drawAltitudeTape(ctx, alt_ft, altSp, vsi_fpm);
    drawHeadingTape(ctx, heading_deg, hdgSp);

    // Flight mode annunciator
    drawFMA(ctx, ap_mode, ap_armed);

    // Data boxes (below AI, above heading tape)
    const dboxY = AI_CY + AI_R + 14;
    drawDataBox(ctx, 'MACH', mach.toFixed(3), '', 90, dboxY, false);
    drawDataBox(ctx, 'AoA°', alpha_deg.toFixed(1), '°', 185, dboxY, Math.abs(alpha_deg) > 12);
    drawDataBox(ctx, 'Nz', Nz.toFixed(2), 'g', 280, dboxY, Math.abs(Nz) > 2.5);

    // Derate label
    if (engine_derate !== 'NOMINAL') {
      ctx.fillStyle = engine_derate === 'CRITICAL' || engine_derate === 'FLAMEOUT' ? '#ff2222' : '#ffaa00';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('DERATE: ' + engine_derate, PFD_W - 10, 96);
    }

    // Glide range
    if (glide_range_m > 0 && ap_mode === 'EMERGENCY_GLIDE') {
      ctx.fillStyle = '#ff2222';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`GLIDE RANGE: ${(glide_range_m / 1000).toFixed(1)} km`, PFD_W / 2, PFD_H - 30);
    }

    // Annunciators
    drawAnnunciators(ctx, { engine_out, stall_warn, overspeed_warn, g_limit_active, fuel_bingo });

  }, [roll_deg, pitch_deg, heading_deg, ias_kts, alt_ft, vsi_fpm, mach, alpha_deg, Nz, ap_mode, ap_armed, engine_out, stall_warn, overspeed_warn, g_limit_active, fuel_bingo, altSp, iasSp, engine_derate, glide_range_m]);

  return (
    <canvas
      ref={canvasRef}
      width={PFD_W}
      height={PFD_H}
      style={{
        background: '#050510',
        borderRadius: '8px',
        border: '1.5px solid #1a2a5e',
        display: 'block',
      }}
    />
  );
}
