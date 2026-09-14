/**
 * FadecFlightInterlock.js  (ESM)
 * FADEC ↔ FCS bidirectional engine-airframe interlock.
 * Handles: health derate, flameout detection, stall/Vne protection, g-limiter, fuel bingo.
 */

import { clamp, PARAMS, AERO } from './FlightDynamics6DOF.js';
import { FLIGHT_MODE } from './CascadedAutopilot.js';

const G = 9.80665;

export const ENVELOPE = {
  Nz_limit_pos: 3.0, Nz_limit_neg: -1.0,
  Nz_warn_pos:  2.5, Nz_warn_neg:  -0.75,
  Vne_kts: 240, Vno_kts: 210, Va_kts: 130, Vfe_kts: 110,
  Vs_kts:  55,  Vs_buf:   8,
  RPM_idle: 900, RPM_min_fly: 1200,
  EGT_limit_k: 1173, fuel_min_kg: 20,
};

const DERATE = [
  { th: 90, tf: 1.00, af: 1.00, lbl: 'NOMINAL'      },
  { th: 75, tf: 0.90, af: 0.95, lbl: 'MINOR_DEG'    },
  { th: 60, tf: 0.78, af: 0.85, lbl: 'MODERATE_DEG' },
  { th: 45, tf: 0.65, af: 0.75, lbl: 'MAJOR_DEG'    },
  { th: 30, tf: 0.45, af: 0.60, lbl: 'CRITICAL'     },
  { th:  0, tf: 0.00, af: 0.40, lbl: 'FLAMEOUT'     },
];

export class FadecFlightInterlock {
  constructor(autopilot) {
    this.ap = autopilot;
    this.dt = 0.02;
    this._flameoutTimer    = 0;
    this._flameoutDetected = false;
    this._prevHealth = 100;
    this.annunciators = {
      ENGINE_OUT: false, ENGINE_DERATE: false,
      STALL_WARN: false, OVERSPEED: false,
      G_LIMIT: false, FUEL_BINGO: false,
      FCS_DEGRADED: false,
    };
  }

  update(eng, fcs) {
    const {
      health=100, rpm=3200, egt_c=650,
      fuelFlow_kgh=50, fuel_kg=200, thrustN=700,
    } = eng;
    const {
      ias_kts=110, tas_ms=56.6, alt_m=3000,
      Nz=1.0, phi_rad=0, rho=1.225, north_m=0, east_m=0,
    } = fcs;

    const d = DERATE.find(r => health >= r.th) ?? DERATE[DERATE.length-1];
    this.annunciators.ENGINE_DERATE = health < 75;
    this.annunciators.FCS_DEGRADED  = health < 45;

    let thrustFactor    = d.tf;
    let authorityFactor = d.af;
    let stallBias = 0, speedBrake = false, throttleCut = false;
    let emergencyGlide = false, V_override = null;

    // Flameout detection
    const engOut = health < 5 || rpm < ENVELOPE.RPM_min_fly;
    if (engOut) {
      this._flameoutTimer += this.dt;
      if (this._flameoutTimer >= 3.0 && !this._flameoutDetected) {
        this._flameoutDetected = true;
        this.annunciators.ENGINE_OUT = true;
        emergencyGlide = true;
        V_override = 82 / 1.94384;
        if (this.ap && !this.ap.emergencyActive)
          this.ap.triggerEmergency(north_m, east_m, alt_m, null);
      }
    } else {
      this._flameoutTimer = Math.max(0, this._flameoutTimer - this.dt*2);
      if (this._flameoutDetected && rpm > ENVELOPE.RPM_idle*1.5) {
        this._flameoutDetected = false; this.annunciators.ENGINE_OUT = false;
      }
    }
    if (engOut) thrustFactor = 0;

    // Stall protection
    const stallBuf = ENVELOPE.Vs_kts + ENVELOPE.Vs_buf;
    this.annunciators.STALL_WARN = ias_kts < stallBuf;
    if (this.annunciators.STALL_WARN) {
      stallBias = clamp((stallBuf-ias_kts)/ENVELOPE.Vs_buf, 0, 1) * 0.0873;
      V_override = V_override ?? ((ENVELOPE.Vs_kts+10)/1.94384);
    }

    // Overspeed
    this.annunciators.OVERSPEED = ias_kts > ENVELOPE.Vne_kts*0.95;
    if (ias_kts > ENVELOPE.Vno_kts) {
      const ov = clamp((ias_kts-ENVELOPE.Vno_kts)/(ENVELOPE.Vne_kts-ENVELOPE.Vno_kts), 0, 1);
      if (ov > 0.5) { throttleCut = true; speedBrake = true; }
    }

    // G-limiter
    const gWarn = Nz > ENVELOPE.Nz_warn_pos || Nz < ENVELOPE.Nz_warn_neg;
    this.annunciators.G_LIMIT = gWarn;
    if (gWarn) {
      const gex = Nz > ENVELOPE.Nz_warn_pos
        ? (Nz-ENVELOPE.Nz_warn_pos)/(ENVELOPE.Nz_limit_pos-ENVELOPE.Nz_warn_pos)
        : (ENVELOPE.Nz_warn_neg-Nz)/(ENVELOPE.Nz_warn_neg-ENVELOPE.Nz_limit_neg);
      authorityFactor *= clamp(1-gex*0.5, 0.3, 1);
    }

    // Fuel bingo
    this.annunciators.FUEL_BINGO = fuel_kg < ENVELOPE.fuel_min_kg;
    if (this.annunciators.FUEL_BINGO) V_override = V_override ?? (82/1.94384);

    // EGT limiting
    if ((egt_c+273.15) > ENVELOPE.EGT_limit_k*0.95)
      thrustFactor *= clamp(1 - ((egt_c+273.15)-ENVELOPE.EGT_limit_k*0.95)/(ENVELOPE.EGT_limit_k*0.05), 0.5, 1);

    return {
      engineHealthFactor: health/100,
      thrustFactor, authorityFactor,
      deRateLabel: d.lbl,
      annunciators: { ...this.annunciators },
      stallBias_rad: stallBias,
      speedBrake, throttleCutDemand: throttleCut,
      emergencyGlide, V_cmd_override: V_override,
    };
  }

  static stallSpeed_ms(rho) {
    return Math.sqrt(2*PARAMS.m*G / (rho*PARAMS.S*AERO.CL_stall));
  }

  getAnnunciators() { return { ...this.annunciators }; }
  isDegraded() { return this._flameoutDetected || this.annunciators.FUEL_BINGO; }
  resetFlameout() { this._flameoutDetected=false; this._flameoutTimer=0; this.annunciators.ENGINE_OUT=false; }
}
