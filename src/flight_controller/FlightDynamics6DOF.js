/**
 * FlightDynamics6DOF.js  (ESM)
 * Full 6-DOF RK4 Flight Dynamics for GarudaTwin MALE UAV
 *
 * Physics: Stevens & Lewis "Aircraft Simulation & Control" 2003
 *          Etkin & Reid "Dynamics of Flight" 1996
 *
 * GarudaTwin MALE UAV Constants:
 *   b=16.6m, S=12.5m², c̄=0.753m, AR=22, m=950kg
 *   Ixx=948, Iyy=1420, Izz=2150, Ixz=85  kg·m²
 *   T_max=1800N, Cruise=110kts, Vbg=82kts, L/D_max=14.5, Vs=58kts
 */

const G_MSL   = 9.80665;
const RHO_SL  = 1.225;
const R_AIR   = 287.05;
const T_SL    = 288.15;
const L_RATE  = 0.0065;
const GAMMA   = 1.4;

export const PARAMS = {
  m: 950, b: 16.6, S: 12.5, c: 0.753, AR: 22,
  Ixx: 948, Iyy: 1420, Izz: 2150, Ixz: 85,
  T_max: 1800, T_min: 0,
};

export const AERO = {
  CL0: 0.28,  CLa: 5.70, CLq: 6.60, CLde: 0.45, CLdf: 1.10,
  CL_max: 1.70, CL_stall: 1.50, alpha_stall: 0.262,
  CD0: 0.020, k: 0.0182, CDde: 0.0012, CDdf: 0.030, CDsb: 0.065,
  CYb: -0.62, CYdr: 0.12,
  Cm0: 0.010, Cma: -1.10, Cmq: -18.0, Cmad: -4.0, Cmde: -1.30, Cmdf: -0.22,
  Clb: -0.090, Clp: -0.485, Clr: 0.072, Clda: 0.195, Cldr: 0.015,
  Cnb: 0.072, Cnp: -0.016, Cnr: -0.095, Cnda: -0.010, Cndr: -0.055,
};

export const LIMITS = {
  elevator: { min: -0.436, max: 0.436 },
  aileron:  { min: -0.349, max: 0.349 },
  rudder:   { min: -0.436, max: 0.436 },
  flap:     { min: 0.0,   max: 0.698  },
  throttle: { min: 0.0,   max: 1.0    },
};

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
export function deg2rad(d) { return d * Math.PI / 180; }
export function rad2deg(r) { return r * 180 / Math.PI; }

export function atmosphere(h) {
  h = Math.max(0, Math.min(h, 11000));
  const T   = T_SL - L_RATE * h;
  const P   = 101325 * Math.pow(T / T_SL, G_MSL / (R_AIR * L_RATE));
  const rho = P / (R_AIR * T);
  const a   = Math.sqrt(GAMMA * R_AIR * T);
  return { rho, T, P, a };
}

function eulerRates(phi, theta, p, q, r) {
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const ct = Math.cos(theta), tt = Math.tan(theta);
  return {
    dphi:   p + (q * sp + r * cp) * tt,
    dtheta: q * cp - r * sp,
    dpsi:   (q * sp + r * cp) / (Math.abs(ct) > 1e-6 ? ct : 1e-6),
  };
}

function bodyToNED(phi, theta, psi, u, v, w) {
  const sp = Math.sin(phi), cp = Math.cos(phi);
  const st = Math.sin(theta), ct = Math.cos(theta);
  const ss = Math.sin(psi), cs = Math.cos(psi);
  return {
    Vn:  ct*cs*u + (sp*st*cs - cp*ss)*v + (cp*st*cs + sp*ss)*w,
    Ve:  ct*ss*u + (sp*st*ss + cp*cs)*v + (cp*st*ss - sp*cs)*w,
    Vd: -st*u   +  sp*ct*v             +  cp*ct*w,
  };
}

function aerodynamics(state, controls, atm) {
  const { u, v, w, p, q, r } = state;
  const { de, da, dr, df, sb } = controls;
  const V2 = u*u + v*v + w*w, V = Math.sqrt(V2) + 1e-6;
  const qbar = 0.5 * atm.rho * V2;
  const alpha = Math.atan2(w, u);
  const beta  = Math.asin(clamp(v / V, -1, 1));
  const pb2V = p * PARAMS.b / (2*V);
  const qc2V = q * PARAMS.c / (2*V);
  const rb2V = r * PARAMS.b / (2*V);

  let CL = AERO.CL0 + AERO.CLa*alpha + AERO.CLq*qc2V + AERO.CLde*de + AERO.CLdf*df;
  if (Math.abs(alpha) > AERO.alpha_stall) {
    const ex = Math.abs(alpha) - AERO.alpha_stall;
    const sf = Math.cos(Math.min(ex*3, Math.PI/2));
    CL = Math.sign(CL) * AERO.CL_max * sf * sf;
  }
  CL = clamp(CL, -AERO.CL_max, AERO.CL_max);

  const CD = AERO.CD0 + AERO.k*CL*CL + AERO.CDde*Math.abs(de) + AERO.CDdf*df + (sb ? AERO.CDsb : 0);
  const CY = AERO.CYb*beta + AERO.CYdr*dr;
  const Cm = AERO.Cm0 + AERO.Cma*alpha + AERO.Cmq*qc2V + AERO.Cmde*de + AERO.Cmdf*df;
  const Cl = AERO.Clb*beta + AERO.Clp*pb2V + AERO.Clr*rb2V + AERO.Clda*da + AERO.Cldr*dr;
  const Cn = AERO.Cnb*beta + AERO.Cnp*pb2V + AERO.Cnr*rb2V + AERO.Cnda*da + AERO.Cndr*dr;

  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const S = PARAMS.S;
  return {
    Fx: qbar*S*(-CD*ca + CL*sa), Fy: qbar*S*CY, Fz: qbar*S*(-CL*ca - CD*sa),
    Lm: qbar*S*PARAMS.b*Cl, Mm: qbar*S*PARAMS.c*Cm, Nm: qbar*S*PARAMS.b*Cn,
    alpha, beta, V, CL, CD, qbar,
    thrustN: 0,   // filled by stateDerivative
  };
}

function stateDerivative(state, controls, engineHealth) {
  const { u, v, w, p, q, r, phi, theta } = state;
  const { throttle } = controls;
  const alt = -state.x_d;
  const atm = atmosphere(Math.max(0, alt));
  const hf = 0.5 + 0.5 * clamp(engineHealth / 100, 0, 1);
  const thrustN = clamp(throttle, 0, 1) * PARAMS.T_max * hf;

  const aero = aerodynamics(state, controls, atm);
  aero.thrustN = thrustN;

  const st = Math.sin(theta), ct = Math.cos(theta);
  const sp = Math.sin(phi),   cp = Math.cos(phi);
  const Gx = -G_MSL*st; const Gy = G_MSL*ct*sp; const Gz = G_MSL*ct*cp;
  const m = PARAMS.m;

  const u_dot = aero.Fx/m + thrustN/m + Gx - (q*w - r*v);
  const v_dot = aero.Fy/m            + Gy - (r*u - p*w);
  const w_dot = aero.Fz/m            + Gz - (p*v - q*u);

  const { Ixx, Iyy, Izz, Ixz } = PARAMS;
  const Gamma = Ixx*Izz - Ixz*Ixz;
  const p_dot = (Izz*aero.Lm + Ixz*aero.Nm - (Izz*(Izz-Iyy)+Ixz*Ixz)*r*q + Ixz*(Ixx-Iyy+Izz)*p*q) / Gamma;
  const q_dot = (aero.Mm - (Ixx-Izz)*p*r - Ixz*(p*p - r*r)) / Iyy;
  const r_dot = (Ixx*aero.Nm + Ixz*aero.Lm + (Ixx*(Ixx-Iyy)+Ixz*Ixz)*p*q - Ixz*(Ixx-Iyy+Izz)*r*q) / Gamma;

  const er = eulerRates(phi, theta, p, q, r);
  const ned = bodyToNED(phi, theta, state.psi, u, v, w);

  return {
    u_dot, v_dot, w_dot, p_dot, q_dot, r_dot,
    phi_dot: er.dphi, theta_dot: er.dtheta, psi_dot: er.dpsi,
    x_n_dot: ned.Vn, x_e_dot: ned.Ve, x_d_dot: ned.Vd,
    alpha: aero.alpha, beta: aero.beta, V: aero.V,
    CL: aero.CL, CD: aero.CD, qbar: aero.qbar, thrustN, atm,
  };
}

const STATE_KEYS = ['u','v','w','p','q','r','phi','theta','psi','x_n','x_e','x_d'];
const DOT_KEYS   = ['u_dot','v_dot','w_dot','p_dot','q_dot','r_dot','phi_dot','theta_dot','psi_dot','x_n_dot','x_e_dot','x_d_dot'];

function addDeriv(s, d, h) {
  const ns = { ...s };
  STATE_KEYS.forEach((k, i) => { ns[k] = s[k] + h * d[DOT_KEYS[i]]; });
  return ns;
}

function rk4Step(state, controls, engineHealth, dt) {
  const k1 = stateDerivative(state,               controls, engineHealth);
  const k2 = stateDerivative(addDeriv(state,k1,dt/2), controls, engineHealth);
  const k3 = stateDerivative(addDeriv(state,k2,dt/2), controls, engineHealth);
  const k4 = stateDerivative(addDeriv(state,k3,dt),   controls, engineHealth);

  const ns = { ...state };
  STATE_KEYS.forEach((k, i) => {
    ns[k] = state[k] + (dt/6)*(k1[DOT_KEYS[i]] + 2*k2[DOT_KEYS[i]] + 2*k3[DOT_KEYS[i]] + k4[DOT_KEYS[i]]);
  });
  ns.psi   = ((ns.psi % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
  ns.phi   = clamp(ns.phi,   -Math.PI/2, Math.PI/2);
  ns.theta = clamp(ns.theta, -Math.PI/2, Math.PI/2);
  if (ns.x_d > 0) { ns.x_d = 0; if (ns.w > 0) ns.w = 0; }
  return { state: ns, deriv: k1 };
}

export class FlightDynamics6DOF {
  constructor() {
    this.dt = 0.02;
    this.time = 0;
    const V = 70.71, at = 0.0175; // Trimmed at 14,500 ft (4419.6 m MSL) at 110 kts IAS
    this.state = {
      u: V*Math.cos(at), v: 0, w: V*Math.sin(at),
      p: 0, q: 0, r: 0,
      phi: 0, theta: at, psi: 0,
      x_n: 0, x_e: 0, x_d: -4419.6,
    };
    this.controls = { throttle: 0.31, de: -0.0071, da: 0, dr: 0, df: 0, sb: false };
    this.engineHealth = 100;
    this.derived = {};
  }

  step(controls, engineHealth) {
    this.engineHealth = clamp(engineHealth ?? this.engineHealth, 0, 100);
    const ctrl = {
      throttle: clamp(controls.throttle ?? this.controls.throttle, 0, 1),
      de:  clamp(controls.de  ?? this.controls.de,  LIMITS.elevator.min, LIMITS.elevator.max),
      da:  clamp(controls.da  ?? this.controls.da,  LIMITS.aileron.min,  LIMITS.aileron.max),
      dr:  clamp(controls.dr  ?? this.controls.dr,  LIMITS.rudder.min,   LIMITS.rudder.max),
      df:  clamp(controls.df  ?? this.controls.df,  LIMITS.flap.min,     LIMITS.flap.max),
      sb:  controls.sb ?? this.controls.sb,
    };
    this.controls = ctrl;
    const result = rk4Step(this.state, ctrl, this.engineHealth, this.dt);
    this.state = result.state;
    this.time += this.dt;
    const d = result.deriv;
    const { state } = this;
    const V   = d.V || Math.sqrt(state.u**2+state.v**2+state.w**2);
    const alt = -state.x_d;
    const atm = atmosphere(Math.max(0, alt));
    const IAS = V * Math.sqrt(atm.rho / RHO_SL);
    const VSI_ms = d.x_d_dot ?? 0;

    const Nz = ((d.qbar||0) * PARAMS.S * (d.CL||0) + (d.thrustN||0) * Math.sin(d.alpha||0)) / (PARAMS.m * G_MSL);

    this.derived = {
      tas_ms: V, ias_ms: IAS,
      ias_kts: IAS * 1.94384, tas_kts: V * 1.94384,
      mach: V / (atm.a + 1e-6),
      alt_m: alt, alt_ft: alt * 3.28084,
      vsi_ms: -VSI_ms,
      vsi_fpm: -VSI_ms * 196.85,
      roll_deg: rad2deg(state.phi),
      pitch_deg: rad2deg(state.theta),
      heading_deg: rad2deg(state.psi),
      alpha_deg: rad2deg(d.alpha||0),
      beta_deg:  rad2deg(d.beta||0),
      p_dps: rad2deg(state.p), q_dps: rad2deg(state.q), r_dps: rad2deg(state.r),
      CL: d.CL||0, CD: d.CD||0,
      LD: (d.CL||0) / ((d.CD||0) + 1e-6),
      Nz,
      north_m: state.x_n, east_m: state.x_e,
      rho: atm.rho, temp_k: atm.T, qbar: d.qbar||0,
      elevator_deg: rad2deg(ctrl.de), aileron_deg: rad2deg(ctrl.da),
      rudder_deg: rad2deg(ctrl.dr),   flap_deg: rad2deg(ctrl.df),
      throttle_pct: ctrl.throttle * 100,
      speed_brake: ctrl.sb,
      thrust_N: d.thrustN||0,
      time_s: this.time,
    };
    return this.derived;
  }

  reset() {
    const V = 70.71, at = 0.0175;
    this.state = { u: V*Math.cos(at), v:0, w: V*Math.sin(at), p:0, q:0, r:0, phi:0, theta:at, psi:0, x_n:0, x_e:0, x_d:-4419.6 };
    this.controls = { throttle:0.31, de:-0.0071, da:0, dr:0, df:0, sb:false };
    this.time = 0; this.engineHealth = 100;
  }

  getState()    { return { ...this.state }; }
  getControls() { return { ...this.controls }; }

  static computeTrim(alt_m, ias_kts) {
    const V_ias = ias_kts / 1.94384;
    const atm = atmosphere(alt_m);
    const V_tas = V_ias / Math.sqrt(atm.rho / RHO_SL);
    const W = PARAMS.m * G_MSL;
    const qbar = 0.5 * atm.rho * V_tas * V_tas;
    const CL_req = W / (qbar * PARAMS.S);
    const alpha_trim = (CL_req - AERO.CL0) / AERO.CLa;
    const de_trim = -(AERO.Cm0 + AERO.Cma * alpha_trim) / AERO.Cmde;
    const CD_trim = AERO.CD0 + AERO.k * CL_req * CL_req;
    return {
      alpha_trim: rad2deg(alpha_trim), de_trim: rad2deg(de_trim),
      throttle_trim: clamp((qbar * PARAMS.S * CD_trim) / PARAMS.T_max, 0, 1),
      CL: CL_req, CD: CD_trim, LD: CL_req / CD_trim,
    };
  }
}
