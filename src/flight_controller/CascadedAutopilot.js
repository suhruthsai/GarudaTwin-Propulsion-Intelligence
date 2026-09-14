/**
 * CascadedAutopilot.js  (ESM)
 * 5-mode cascaded PID flight controller + L1 guidance.
 * Modes: MANUAL_FBW | AUTO_MISSION | ALT_HOLD | LOITER | EMERGENCY_GLIDE
 * Inner loops: p/q/r rate dampers at 50 Hz
 * Outer loops: φ, θ, heading angle controllers
 * L1 guidance: Park, Deyst & How (2004)
 */

import { clamp, deg2rad, rad2deg, atmosphere } from './FlightDynamics6DOF.js';
import { TotalEnergyControlSystem }  from './TotalEnergyControlSystem.js';

export const FLIGHT_MODE = {
  MANUAL_FBW:      'MANUAL_FBW',
  AUTO_MISSION:    'AUTO_MISSION',
  ALT_HOLD:        'ALT_HOLD',
  LOITER:          'LOITER',
  EMERGENCY_GLIDE: 'EMERGENCY_GLIDE',
};

class PID {
  constructor(Kp, Ki, Kd, oMin, oMax, iLim) {
    this.Kp=Kp; this.Ki=Ki; this.Kd=Kd;
    this.oMin=oMin; this.oMax=oMax;
    this.iLim = iLim ?? oMax*0.6;
    this._i=0; this._pe=0;
  }
  update(sp, meas, dt) {
    const e = sp - meas;
    this._i = clamp(this._i + e*dt, -this.iLim, this.iLim);
    const d = (e - this._pe) / dt;
    this._pe = e;
    return clamp(this.Kp*e + this.Ki*this._i + this.Kd*d, this.oMin, this.oMax);
  }
  reset() { this._i=0; this._pe=0; }
}

class L1Guidance {
  constructor() { this.Kl1 = 3.5; }
  computeRoll(n, e, hdg, V, wn, we) {
    const L1 = this.Kl1 * V;
    const dx = we-e, dy = wn-n;
    const bearing = Math.atan2(dx, dy);
    let eta = bearing - hdg;
    while (eta >  Math.PI) eta -= 2*Math.PI;
    while (eta < -Math.PI) eta += 2*Math.PI;
    eta = clamp(eta, -Math.PI/2, Math.PI/2);
    return clamp(Math.atan2(2*V*V*Math.sin(eta)/L1, 9.80665), deg2rad(-45), deg2rad(45));
  }
  computeLoiterRoll(n, e, hdg, V, cn, ce, radius, cw) {
    const dx = e-ce, dy = n-cn;
    const dist = Math.sqrt(dx*dx+dy*dy)+1e-3;
    const ang = Math.atan2(dx, dy);
    const tan_off = (cw ? 1 : -1) * Math.PI/2;
    const wp_n = n + radius * Math.cos(ang+tan_off) * 1.5;
    const wp_e = e + radius * Math.sin(ang+tan_off) * 1.5;
    return this.computeRoll(n, e, hdg, V, wp_n, wp_e) + clamp((dist-radius)*0.01, deg2rad(-10), deg2rad(10));
  }
}

export class CascadedAutopilot {
  constructor() {
    this.dt   = 0.02;
    this.mode = FLIGHT_MODE.ALT_HOLD;
    this.tecs = new TotalEnergyControlSystem();
    this.l1   = new L1Guidance();

    // Inner loops (rate dampers) — Clean PI damping preventing derivative chatter
    this.ir = new PID(0.18, 0.05, 0.0, deg2rad(-20), deg2rad(20), 0.25);
    this.ip = new PID(0.50, 0.15, 0.0, deg2rad(-25), deg2rad(25), 0.35);
    this.iy = new PID(0.30, 0.08, 0.0, deg2rad(-25), deg2rad(25), 0.25);
    this.ib = new PID(0.40, 0.08, 0.0, deg2rad(-20), deg2rad(20), 0.25);

    // Outer loops (attitude)
    this.ophi   = new PID(0.85, 0.05, 0.0, deg2rad(-35), deg2rad(35), 0.35);
    this.otheta = new PID(1.10, 0.08, 0.0, deg2rad(-20), deg2rad(20), 0.35);
    this.ohdg   = new PID(0.60, 0.02, 0.0, deg2rad(-35), deg2rad(35), 0.40);

    this.sp = {
      alt_m: 4419.6, ias_ms: 56.588, heading_rad: 0,
      loiter_north: 0, loiter_east: 0, loiter_radius: 2000, loiter_cw: true,
      waypoints: [], wp_idx: 0, wp_accept: 250,
    };
    this.fbw = { roll:0, pitch:0, yaw:0, throttle:0.31 };
    this._prevV = 70.71; this._prevH = 4419.6;
    this.emergencyActive = false;
    this.glideTarget = null;
    this.armed = false;
    this.lastOutput = {};
  }

  arm()    { this.armed = true; }
  disarm() { this.armed = false; this.mode = FLIGHT_MODE.MANUAL_FBW; }

  setMode(mode) {
    if (!FLIGHT_MODE[mode] || mode === this.mode) return;
    this.mode = mode;
    [this.ir,this.ip,this.iy,this.ib,this.ophi,this.otheta,this.ohdg].forEach(c=>c.reset());
    this.tecs.reset();
  }

  setAltitude(a)  { this.sp.alt_m = a; this.tecs.h_sp = a; }
  setAirspeed(v)  { this.sp.ias_ms = v; }
  setHeading(h)   { this.sp.heading_rad = h; }
  loadWaypoints(w){ this.sp.waypoints = w; this.sp.wp_idx = 0; }
  setLoiter(n,e,r,cw){ this.sp.loiter_north=n; this.sp.loiter_east=e; this.sp.loiter_radius=r; this.sp.loiter_cw=cw??true; }

  triggerEmergency(north, east, alt_m, runway) {
    this.emergencyActive = true;
    this.glideTarget = runway ?? null;
    this.setMode(FLIGHT_MODE.EMERGENCY_GLIDE);
    console.log(`[FCS] ⚠️ EMERGENCY GLIDE — N${north.toFixed(0)} E${east.toFixed(0)} Alt:${alt_m.toFixed(0)}m`);
  }

  setFBW(roll, pitch, yaw, throttle) {
    this.fbw = { roll:clamp(roll,-1,1), pitch:clamp(pitch,-1,1), yaw:clamp(yaw,-1,1), throttle:clamp(throttle,0,1) };
  }

  update(s, engineHealth) {
    const { phi_rad, theta_rad, psi_rad, p_rads, q_rads, r_rads, tas_ms, ias_ms, alt_m, vsi_ms, alpha_rad, beta_rad, north_m, east_m } = s;
    const dt = this.dt;
    const ehf = clamp(engineHealth / 100, 0, 1);
    const Vdot = (tas_ms - this._prevV) / dt;
    const hdot  = vsi_ms ?? ((alt_m - this._prevH) / dt);
    this._prevV = tas_ms; this._prevH = alt_m;

    // ── MANUAL FBW ─────────────────────────────────────────
    if (this.mode === FLIGHT_MODE.MANUAL_FBW) {
      const da = this.ir.update(this.fbw.roll*deg2rad(60),  p_rads, dt);
      const de = -this.ip.update(this.fbw.pitch*deg2rad(20), q_rads, dt);
      const dr = -this.iy.update(this.fbw.yaw*deg2rad(20),   r_rads, dt);
      return (this.lastOutput = { throttle:this.fbw.throttle, de, da, dr, df:0, sb:false, mode:'MANUAL_FBW' });
    }

    // ── EMERGENCY GLIDE ────────────────────────────────────
    if (this.mode === FLIGHT_MODE.EMERGENCY_GLIDE) {
      const atm = atmosphere(alt_m);
      const tas_sp = (82 / 1.94384) / Math.sqrt(Math.max(0.2, atm.rho / 1.225));
      this.tecs.setSetpoints(tas_sp, alt_m - 10, -2.5);
      const t = this.tecs.update(tas_ms, alt_m, Vdot, hdot, 0);
      const q_sp  = this.otheta.update(t.theta_cmd, theta_rad, dt);
      const de    = -this.ip.update(q_sp, q_rads, dt);
      const phi_sp = this.glideTarget
        ? this.l1.computeRoll(north_m, east_m, psi_rad, tas_ms, this.glideTarget.north, this.glideTarget.east)
        : 0;
      const p_sp  = this.ophi.update(phi_sp, phi_rad, dt);
      const da    = this.ir.update(p_sp, p_rads, dt);
      const r_coord = -(9.80665 * Math.tan(phi_rad) / Math.max(tas_ms,20)) * 0.1;
      const dr    = -this.iy.update(r_coord, r_rads, dt) - this.ib.update(0, beta_rad, dt) * 0.5;
      return (this.lastOutput = { throttle:0.02, de, da, dr, df:0, sb:false, mode:'EMERGENCY_GLIDE' });
    }

    let phi_sp, theta_sp, throttle_cmd;
    const atm = atmosphere(alt_m);
    const tas_sp = this.sp.ias_ms / Math.sqrt(Math.max(0.2, atm.rho / 1.225));

    // ── ALT HOLD ───────────────────────────────────────────
    if (this.mode === FLIGHT_MODE.ALT_HOLD) {
      this.tecs.setSetpoints(tas_sp, this.sp.alt_m, 0);
      const t = this.tecs.update(tas_ms, alt_m, Vdot, hdot, ehf);
      throttle_cmd = t.throttle_cmd; theta_sp = t.theta_cmd;
      let he = this.sp.heading_rad - psi_rad;
      while (he >  Math.PI) he -= 2*Math.PI;
      while (he < -Math.PI) he += 2*Math.PI;
      phi_sp = this.ohdg.update(he, 0, dt);
    }
    // ── LOITER ─────────────────────────────────────────────
    else if (this.mode === FLIGHT_MODE.LOITER) {
      this.tecs.setSetpoints(tas_sp, this.sp.alt_m, 0);
      const t = this.tecs.update(tas_ms, alt_m, Vdot, hdot, ehf);
      throttle_cmd = t.throttle_cmd; theta_sp = t.theta_cmd;
      phi_sp = this.l1.computeLoiterRoll(north_m, east_m, psi_rad, tas_ms, this.sp.loiter_north, this.sp.loiter_east, this.sp.loiter_radius, this.sp.loiter_cw);
    }
    // ── AUTO MISSION ───────────────────────────────────────
    else if (this.mode === FLIGHT_MODE.AUTO_MISSION) {
      const wps = this.sp.waypoints;
      if (!wps.length) { this.setMode(FLIGHT_MODE.ALT_HOLD); return this.update(s, engineHealth); }
      const wp = wps[this.sp.wp_idx];
      const dn = wp.north-north_m, de2 = wp.east-east_m;
      if (Math.sqrt(dn*dn+de2*de2) < this.sp.wp_accept) {
        if (this.sp.wp_idx < wps.length-1) this.sp.wp_idx++;
        else { this.setLoiter(wp.north,wp.east,this.sp.loiter_radius,true); this.setMode(FLIGHT_MODE.LOITER); return this.update(s, engineHealth); }
      }
      this.tecs.setSetpoints(tas_sp, wp.alt_m ?? this.sp.alt_m, 0);
      const t = this.tecs.update(tas_ms, alt_m, Vdot, hdot, ehf);
      throttle_cmd = t.throttle_cmd; theta_sp = t.theta_cmd;
      phi_sp = this.l1.computeRoll(north_m, east_m, psi_rad, tas_ms, wp.north, wp.east);
    }

    // ── SHARED INNER LOOPS ─────────────────────────────────
    const p_sp  = this.ophi.update(phi_sp ?? 0, phi_rad, dt);
    const q_sp  = this.otheta.update(theta_sp ?? 0.05, theta_rad, dt);
    const r_sp  = (9.80665 * Math.tan(phi_rad) / Math.max(tas_ms,20)) * 0.7;
    const da    = this.ir.update(p_sp,  p_rads, dt);
    const de    = -this.ip.update(q_sp,  q_rads, dt);
    const dr    = -this.iy.update(r_sp,  r_rads, dt) - this.ib.update(0, beta_rad, dt) * 0.6;
    const df    = (ias_ms * 1.94384 < 70) ? deg2rad(15) : 0;

    return (this.lastOutput = { throttle: throttle_cmd ?? 0.38, de, da, dr, df, sb:false, mode: this.mode });
  }

  getDiagnostics() {
    return { mode: this.mode, armed: this.armed, sp: { ...this.sp }, emergency: this.emergencyActive };
  }

  getGlideRange(alt_m, rho) { return TotalEnergyControlSystem.glideRange(alt_m, rho); }
}
