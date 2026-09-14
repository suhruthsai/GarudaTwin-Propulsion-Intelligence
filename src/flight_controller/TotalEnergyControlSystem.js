/**
 * TotalEnergyControlSystem.js  (ESM)
 * Lambregts 1983 TECS — Throttle controls total specific energy,
 * elevator controls energy distribution (altitude vs. airspeed).
 *
 * E_total = ½V² + gh  [J/kg]
 * Throttle ← KP·(Ė_sp − Ė) + KI·∫(Ė_sp − Ė)dt
 * θ_cmd   ← KP·(ΔE_bal) + KI·∫(ΔE_bal)dt + KD·d/dt(ΔE_bal)
 */

import { clamp, PARAMS, AERO, atmosphere } from './FlightDynamics6DOF.js';

const G = 9.80665;
const RHO_SL = 1.225;

const P = {
  Kp_E: 0.005, Ki_E: 0.002,
  Kp_B: 0.004, Ki_B: 0.0015, Kd_B: 0.0,
  theta_max: 0.35, theta_min: -0.25, theta_ff: 0.0175,
  thr_max: 0.95, thr_min: 0.05, thr_trim: 0.31,
  max_climb: 6.0, max_sink: 4.0, max_accel: 3.0,
  int_E_lim: 0.5, int_B_lim: 0.4,
  alpha_lpf: 0.5,
};

export class TotalEnergyControlSystem {
  constructor() {
    this.dt = 0.02;
    this._iE = 0; this._iB = 0;
    this._prevBerr = 0;
    this._Vdot_f = 0; this._hdot_f = 0;
    this._thr = P.thr_trim; this._theta = P.theta_ff;
    this.V_sp = 56.588; this.h_sp = 4419.6; this.hdot_sp = 0;
  }

  setSetpoints(V_ms, h_m, hdot_ms) {
    this.V_sp    = clamp(V_ms, 20, 140);
    this.h_sp    = h_m;
    this.hdot_sp = clamp(hdot_ms ?? 0, -P.max_sink, P.max_climb);
  }

  update(V, h, Vdot, hdot, ehf) {
    ehf = clamp(ehf ?? 1, 0, 1);
    const dt = this.dt;
    this._Vdot_f = P.alpha_lpf*Vdot + (1-P.alpha_lpf)*this._Vdot_f;
    this._hdot_f = P.alpha_lpf*hdot + (1-P.alpha_lpf)*this._hdot_f;

    // Energy state
    const E  = 0.5*V*V + G*h;
    const Esp= 0.5*this.V_sp**2 + G*this.h_sp;

    // Demanded rates
    const hdot_d = clamp((this.h_sp - h)*0.25 + this.hdot_sp, -P.max_sink, P.max_climb);
    const Vdot_d = clamp((this.V_sp - V)*0.15, -P.max_accel, P.max_accel);
    const Er_sp  = V*Vdot_d + G*hdot_d;
    const Er_act = V*this._Vdot_f + G*this._hdot_f;
    const Er_err = Er_sp - Er_act;

    // Throttle channel
    this._iE = clamp(this._iE + Er_err*dt, -P.int_E_lim, P.int_E_lim);
    const thr_max = P.thr_min + (P.thr_max - P.thr_min)*ehf;
    this._thr = clamp(P.thr_trim + P.Kp_E*Er_err + P.Ki_E*this._iE, P.thr_min, thr_max);

    // Elevator channel (energy balance)
    const bal = (G*hdot_d - G*this._hdot_f) - (V*Vdot_d - V*this._Vdot_f);
    this._iB  = clamp(this._iB + bal*dt, -P.int_B_lim, P.int_B_lim);
    this._theta = clamp(P.theta_ff + P.Kp_B*bal + P.Ki_B*this._iB, P.theta_min, P.theta_max);

    return {
      throttle_cmd: this._thr,
      theta_cmd:    this._theta,
      diagnostics: { E, Esp, Er_sp, Er_act, Er_err, bal, hdot_d, Vdot_d, iE: this._iE, iB: this._iB },
    };
  }

  reset(V, h) {
    this._iE = 0; this._iB = 0; this._prevBerr = 0;
    this._Vdot_f = 0; this._hdot_f = 0;
    this._thr = P.thr_trim; this._theta = P.theta_ff;
    if (V !== undefined) this.V_sp = V;
    if (h !== undefined) this.h_sp = h;
  }

  static bestGlideSpeed(rho) {
    const W  = PARAMS.m * G;
    const CL_bg = Math.sqrt(AERO.CD0 / AERO.k);
    const V_bg  = Math.sqrt(2*W / (rho * PARAMS.S * CL_bg));
    return { V_bg, CL_bg, CD_bg: 2*AERO.CD0, LD_max: CL_bg / (2*AERO.CD0) };
  }

  static glideRange(alt_m, rho) {
    return alt_m * TotalEnergyControlSystem.bestGlideSpeed(rho).LD_max;
  }
}
