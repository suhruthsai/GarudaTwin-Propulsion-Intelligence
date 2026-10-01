/**
 * Rotax 915 iS engine simulator + golden-twin nominal model.
 *
 * Shared by the live gateway (server.js) and the ML data generator
 * (training/generate_dataset.mjs) so the models are trained on exactly the
 * physics that drives the live digital twin.
 *
 * The GoldenTwin equations are mirrored in
 * ai_health_rul/preprocessing/feature_engineering.py (GoldenTwin) — keep them in sync.
 */

export const FAULT_TYPES = [
  'NONE', 'CYL3_INJECTOR', 'BLOW_BY', 'OIL_PUMP_CAVITATION', 'TURBO_WASTEGATE_STUCK',
  'COOLING_DEGRADATION', 'GENERATOR_FAILURE', 'PRGB_DEGRADATION',
  'MISFIRE', 'COMBUSTION_INSTABILITY', 'INJECTOR_COKING', 'SENSOR_DRIFT', 'SENSOR_FAILURE',
];

// Faults of the measurement chain, not the engine: they change readings only, never engine physics.
export const SENSOR_FAULTS = ['SENSOR_DRIFT', 'SENSOR_FAILURE'];
export const SENSOR_CHANNELS = ['egt1', 'egt2', 'egt3', 'egt4', 'cht1', 'cht2', 'cht3', 'cht4', 'oil_temp', 'oil_pressure', 'coolant'];
// Sensor-drift bias at severity 1 (reached after SENSOR_DRIFT_RAMP_S seconds)
const SENSOR_DRIFT_FULL_SCALE = { egt: 90, cht: 30, oil_temp: 25, oil_pressure: 1.2, coolant: 25 };
const SENSOR_DRIFT_RAMP_S = 20;

// Channel accessors on the engine reading object
function readChannel(e, ch) {
  if (ch.startsWith('egt')) return e.egt[Number(ch[3]) - 1];
  if (ch.startsWith('cht')) return e.cht[Number(ch[3]) - 1];
  return { oil_temp: e.oilTempC, oil_pressure: e.oilPressBar, coolant: e.coolantTempC }[ch];
}
function writeChannel(e, ch, v) {
  if (ch.startsWith('egt')) e.egt[Number(ch[3]) - 1] = parseFloat(v.toFixed(1));
  else if (ch.startsWith('cht')) e.cht[Number(ch[3]) - 1] = parseFloat(v.toFixed(1));
  else if (ch === 'oil_temp') e.oilTempC = parseFloat(v.toFixed(1));
  else if (ch === 'oil_pressure') e.oilPressBar = parseFloat(v.toFixed(2));
  else if (ch === 'coolant') e.coolantTempC = parseFloat(v.toFixed(1));
}

// ───────────────────────────────────────────────────────────────────────────
// Shared physics (simulator AND golden twin). Mirrored in
// ai_health_rul/preprocessing/feature_engineering.py — keep in sync (parity-tested).
// All constants below are engineering assumptions for this prototype, not Rotax data.
// ───────────────────────────────────────────────────────────────────────────
export const PHYS = {
  P0_BAR: 1.01325, T0_K: 288.15, LAPSE_K_PER_FT: 0.0019812,
  REF_ALT_FT: 14500,           // calibration point of the original model (mission loiter altitude, ISA)
  PR_MAX: 3.0,                 // turbo + wastegate: max manifold/ambient pressure ratio
  COOLING_EXP: 0.8,            // forced-convection heat transfer ~ (rho V)^0.8, airspeed held constant
  EGT_PER_OAT: 0.6,            // °C EGT per °C intake/ambient temperature change
  EGT_PER_POWER_LOSS: 40,      // °C EGT drop per unit power fraction lost above critical altitude
  LAMBDA_TARGET: 0.94,         // ECU closed-loop lambda target (cruise)
  TRIM_KI: 1.0,                // 1/s, short-term closed-loop fuel trim (~1 s time constant)
  TRIM_MAX: 0.15,              // ±15 % trim authority
  EGT_PER_LAMBDA: 380,         // °C EGT per unit lambda on the rich side (richer -> cooler)
  INJ_FLOW_MM3_PER_MS: 3.33,   // injector static flow (200 cc/min)
  INJ_DEAD_MS: 0.8,            // injector opening (dead) time
  ALT_MAX_A: 70,               // alternator capacity at >= 3000 rpm
  BATT_AH: 17, BATT_R_OHM: 0.05, BUS_SET_V: 28.4,
  BASE_LOAD_A: 38,             // avionics + payload electrical load
  HEATER_A_PER_C: 0.2,         // de-ice / payload heaters below 0 °C OAT
};

export function isaPressureBar(altFt) {
  return PHYS.P0_BAR * Math.pow(1 - 6.8756e-6 * altFt, 5.2559);
}
export const isaTempC = (altFt) => 15 - PHYS.LAPSE_K_PER_FT * altFt;
const REF_P = isaPressureBar(PHYS.REF_ALT_FT);
export const REF_OAT_C = isaTempC(PHYS.REF_ALT_FT);
const densityRatio = (pBar, oatC) => (pBar / PHYS.P0_BAR) * (PHYS.T0_K / (oatC + 273.15));
const REF_SIGMA = densityRatio(REF_P, REF_OAT_C);
export const REF_AMBIENT = { pBar: REF_P, oatC: REF_OAT_C };

/** Turbo limit, power fraction and cooling factor for an operating point and ambient condition. */
export function ambientFactors(throttlePct, pBar, oatC) {
  const mapTarget = 1.42 + (throttlePct - 78.5) * 0.015;
  const mapAvail = pBar * PHYS.PR_MAX;
  const map = Math.min(mapTarget, mapAvail);
  const pf = map / mapTarget;                                        // power fraction delivered
  const cf = Math.pow(REF_SIGMA / densityRatio(pBar, oatC), PHYS.COOLING_EXP); // cooling penalty
  const wastegatePct = Math.max(0, Math.min(100, 100 * (mapTarget / pBar - 1) / (PHYS.PR_MAX - 1)));
  return { mapTarget, map, pf, cf, dOat: oatC - REF_OAT_C, wastegatePct };
}

/** Steady-state thermal targets (°C) at the operating point and ambient condition. */
export function thermalTargets(throttlePct, rpm, pBar, oatC) {
  const a = ambientFactors(throttlePct, pBar, oatC);
  // The original calibration (reference ambient) scaled for cooling-air density and delivered power
  const scale = (calC) => oatC + (calC - REF_OAT_C) * a.cf * a.pf;
  return {
    egt: 840 + (throttlePct - 78.5) * 1.8 + (rpm - 4800) * 0.03 + PHYS.EGT_PER_OAT * a.dOat - PHYS.EGT_PER_POWER_LOSS * (1 - a.pf),
    cht: scale(106 + (throttlePct - 78.5) * 0.6),
    oilTemp: scale(98.0 + (throttlePct - 78.5) * 0.25),
    coolant: scale(88.5),
    ...a,
  };
}

export const nominalFuelLph = (throttlePct, pf) => (26.0 + (throttlePct - 78.5) * 0.4) * pf;

/** Commanded injection time (ms) for a commanded fuel flow (L/h, 4 cylinders, 4-stroke). */
export function injPulseMs(fuelLph, rpm) {
  const mm3PerInjection = (fuelLph / 4) / (Math.max(rpm, 500) / 2 * 60) * 1e6;
  return mm3PerInjection / PHYS.INJ_FLOW_MM3_PER_MS + PHYS.INJ_DEAD_MS;
}

export const chargeRequestA = (soc) => Math.max(0.3, Math.min(8, 0.3 + 40 * (1 - soc)));

/** Alternator / battery / bus for a given rpm, electrical load and battery state of charge (0-1). */
export function electricalState(rpm, loadA, soc, capFactor = 1, regDroopV = 0) {
  const cap = PHYS.ALT_MAX_A * Math.max(0, Math.min(1, (rpm - 1500) / 1500)) * capFactor;
  const req = chargeRequestA(soc);
  const ocv = 23.6 + 1.8 * soc;
  if (cap >= loadA + req) return { iAlt: loadA + req, iBat: req, vBus: PHYS.BUS_SET_V - regDroopV, cap };
  if (cap >= loadA) {   // load carried, battery charging at reduced current
    const iBat = cap - loadA;
    return { iAlt: cap, iBat, vBus: ocv + (PHYS.BUS_SET_V - regDroopV - ocv) * (iBat / req), cap };
  }
  const iBat = cap - loadA;   // alternator cannot carry the load: battery discharges, bus falls to battery
  return { iAlt: cap, iBat, vBus: ocv + iBat * PHYS.BATT_R_OHM, cap };
}

/** Box-Muller Gaussian noise using the supplied uniform RNG */
function gaussian(rng, mean = 0, stdDev = 1) {
  const u1 = 1 - rng();
  const u2 = 1 - rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * stdDev + mean;
}

/** Deterministic PRNG (mulberry32) for reproducible dataset generation */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initialEngineState() {
  return {
    rpm: 4800,
    throttlePct: 78.5,
    egt: [842.0, 839.5, 844.0, 841.2],
    cht: [106.2, 107.5, 105.8, 108.1],
    mapBar: 1.42,
    oilPressBar: 3.85,
    oilTempC: 98.4,
    vibrationGrms: 0.28,
    fuelFlowLph: 26.4,
    fuelPressureBar: 3.12,
    lambda: 0.94,
    wastegateDutyPct: 72.0,
    genVoltageV: 28.4,
    genCurrentA: 39.0,
    coolantTempC: 88.5,
    injPulseMs: 14.3,
    fuelTrimPct: 0.0,
    batteryCurrentA: 1.0,
    batterySocPct: 98.0,
    ambientPressureBar: REF_P,
    oatC: REF_OAT_C,
  };
}

export class EngineSimulator {
  /**
   * @param {object} opts
   * @param {() => number} [opts.rng] uniform [0,1) generator (Math.random for live use)
   * @param {object} [opts.fault] shared fault object { activeFault, severity, params? }
   *   params (optional, defaults used by the live gateway):
   *     MISFIRE { cylinder: 0-3 }  INJECTOR_COKING { pattern: [4 multipliers] }
   *     SENSOR_DRIFT { channel, sign: ±1 }  SENSOR_FAILURE { channel }
   */
  constructor({ rng = Math.random, fault = { activeFault: 'NONE', severity: 0 } } = {}) {
    this.rng = rng;
    this.fault = fault;
    this.engine = initialEngineState();
    this.reset();
  }

  reset() {
    this.time = 0;
    // Judge-sandbox operating-point override; null = scripted loiter profile
    this.manual = { rpm: null, throttle: null };
    // Flight condition (set by the gateway from the 6-DOF model, or by the dataset generator)
    this.ambient = { altitudeFt: PHYS.REF_ALT_FT, isaDevC: 0 };
    this.thermal = { egt: 840.0, cht: 106.0, oilTemp: 98.0, coolant: 88.5 };
    this.trim = 0;                                   // ECU closed-loop fuel trim (fraction)
    this.electrical = { soc: 0.98, baseLoadA: PHYS.BASE_LOAD_A, payloadA: 0 };
    Object.assign(this.engine, initialEngineState());
  }

  _ambientNow() {
    const altitudeFt = Math.max(0, Math.min(25000, this.ambient.altitudeFt));
    return { altitudeFt, pBar: isaPressureBar(altitudeFt), oatC: isaTempC(altitudeFt) + this.ambient.isaDevC };
  }

  _targets(time) {
    const targetRpm = this.manual.rpm ?? (4800 + Math.sin(time * 0.1) * 60);
    const targetThrottle = this.manual.throttle ?? (78.5 + Math.sin(time * 0.1) * 1.5);
    const amb = this._ambientNow();
    const t = thermalTargets(targetThrottle, targetRpm, amb.pBar, amb.oatC);
    return {
      targetRpm,
      targetThrottle,
      targetEgt: t.egt,
      targetCht: t.cht,
      targetOilTemp: t.oilTemp,
      targetCoolant: t.coolant,
      amb,
      af: t,
    };
  }

  /** Jump thermal state to steady state for the current operating point (dataset warm start) */
  settleThermal() {
    const t = this._targets(this.time);
    this.thermal = { egt: t.targetEgt, cht: t.targetCht, oilTemp: t.targetOilTemp, coolant: t.targetCoolant };
  }

  /** 100 Hz physics step: dynamic baseline + Gaussian sensor noise + fault signatures */
  step(dt = 0.01) {
    const g = (m, s) => gaussian(this.rng, m, s);
    const e = this.engine;
    this.time += dt;
    const time = this.time;

    const rpmNoise = g(0, 4.0);
    const mapNoise = g(0, 0.005);
    const vibNoise = g(0, 0.008);

    let { targetRpm, targetThrottle, targetEgt, targetCht, targetOilTemp, targetCoolant, amb, af } = this._targets(time);
    const targetMap = af.map;   // turbo-limited above the critical altitude

    // Thermal inertia: dT/dt = k (T_target - T)
    this.thermal.egt += 0.8 * (targetEgt - this.thermal.egt) * dt;
    this.thermal.cht += 0.05 * (targetCht - this.thermal.cht) * dt;
    this.thermal.oilTemp += 0.02 * (targetOilTemp - this.thermal.oilTemp) * dt;
    this.thermal.coolant += 0.05 * (targetCoolant - this.thermal.coolant) * dt;

    const baseEgt = this.thermal.egt;
    const baseCht = this.thermal.cht;
    const baseOilTemp = this.thermal.oilTemp;
    const baseOilPress = 3.85 - (baseOilTemp - 98.0) * 0.015;
    const baseVib = 0.28 + ((targetRpm - 4800) / 5800) * 0.12;

    let egtOffsets = [0, 0, 0, 0];
    let chtOffsets = [0, 0, 0, 0];
    let mapOffset = 0, oilPressOffset = 0, oilTempOffset = 0, vibOffset = 0;
    let injFlowFactor = 1, lambdaOffset = 0, altCapFactor = 1, regDroopV = 0, coolantOffset = 0;

    // Per-fault internal state (filters, onset time), reset whenever the active fault changes
    if (!this._fs || this._fs.key !== this.fault.activeFault) {
      this._fs = { key: this.fault.activeFault, t0: time, mf: 0, mfSlow: 0, rd: 0,
                   inst: { egt: [0, 0, 0, 0], rpm: 0, map: 0, lam: 0 }, stuck: null };
    }
    const fs = this._fs;
    const params = this.fault.params || {};
    // First-order low-pass (time constant 1/k) — sensor/thermal lag
    const lag = (x, target, k) => x + (1 - Math.exp(-k * dt)) * (target - x);
    // Band-limited Gaussian process whose sampled std is sigmaOut (AR(1) with rate k)
    const bandNoise = (x, k, sigmaOut) => {
      const a = 1 - Math.exp(-k * dt);
      return x + a * (g(0, sigmaOut / Math.sqrt(a / (2 - a))) - x);
    };

    if (this.fault.activeFault !== 'NONE') {
      const sev = this.fault.severity;
      switch (this.fault.activeFault) {
        case 'CYL3_INJECTOR':
          // Cylinder 3 partial clog -> lean burn EGT spike, CHT rise, torsional vibration
          egtOffsets[2] = 135.0 * sev + Math.sin(time * 8.0) * 12 * sev;
          chtOffsets[2] = 28.0 * sev;
          egtOffsets[0] = -10.0 * sev;
          egtOffsets[1] = -8.0 * sev;
          egtOffsets[3] = -9.0 * sev;
          vibOffset = 0.95 * sev + g(0, 0.1 * sev);
          lambdaOffset = 0.18 * sev;
          break;
        case 'BLOW_BY':
          // Ring blow-by -> hot gases bake oil, oil pressure decay
          oilTempOffset = 32.0 * sev + Math.sin(time * 0.5) * 4 * sev;
          oilPressOffset = -1.65 * sev;
          chtOffsets[1] = 18.0 * sev;
          chtOffsets[2] = 22.0 * sev;
          vibOffset = 0.65 * sev;
          break;
        case 'OIL_PUMP_CAVITATION':
          // Oil aeration / relief valve chatter -> pressure oscillation, bearing distress
          oilPressOffset = -2.3 * sev + (Math.sin(time * 15.0) * 0.75 * sev);
          oilTempOffset = 25.0 * sev;
          vibOffset = 1.35 * sev + g(0, 0.2 * sev);
          break;
        case 'TURBO_WASTEGATE_STUCK':
          // Wastegate stuck closed -> overboost
          mapOffset = 0.58 * sev + Math.sin(time * 3.0) * 0.08 * sev;
          egtOffsets = [45 * sev, 42 * sev, 48 * sev, 44 * sev];
          targetRpm += 350 * sev;
          vibOffset = 0.5 * sev;
          break;
        case 'COOLING_DEGRADATION':
          chtOffsets = [32 * sev, 35 * sev, 34 * sev, 36 * sev];
          oilTempOffset = 18.0 * sev;
          coolantOffset = 35.0 * sev;
          break;
        case 'GENERATOR_FAILURE':
          // Failing alternator (diodes / winding): reduced output capacity and weaker regulation.
          // Below the load the battery discharges and the bus falls to battery voltage.
          altCapFactor = 1 - sev;
          regDroopV = 3.5 * sev + Math.abs(g(0, 0.15 * sev));   // weaker regulation as the alternator fails
          break;
        case 'PRGB_DEGRADATION':
          // Gear tooth wear / clutch slip -> severe vibration
          vibOffset = 2.15 * sev + g(0, 0.15);
          break;
        case 'MISFIRE': {
          // Intermittent loss of combustion in one cylinder (fouled plug / ignition fault).
          // r = fraction of that cylinder's cycles that do not fire.
          const c = params.cylinder ?? 1;
          const r = 0.6 * sev;
          const m = this.rng() < r ? 1 : 0;
          fs.mf = lag(fs.mf, m, 2.0);          // thermocouple lag (~0.5 s)
          fs.mfSlow = lag(fs.mfSlow, m, 0.05); // cylinder-head thermal mass (~20 s)
          fs.rd = lag(fs.rd, m, 15.0);         // crankshaft torque dips
          egtOffsets[c] = -380 * fs.mf;        // unburned charge: port EGT falls toward ~460 °C at full misfire
          chtOffsets[c] = -35 * fs.mfSlow;     // less combustion heat into that head
          targetRpm += -40 * r - 250 * (fs.rd - r); // small mean loss + crank-speed jitter
          vibOffset = 0.9 * r + g(0, 0.1 * r); // uneven firing
          lambdaOffset = 0.30 * r;             // unburned O2 reaches the exhaust lambda sensor (reads lean)
          break;
        }
        case 'COMBUSTION_INSTABILITY': {
          // Cycle-to-cycle combustion variation on all cylinders (erratic ignition / fuelling).
          for (let i = 0; i < 4; i++) {
            fs.inst.egt[i] = bandNoise(fs.inst.egt[i], 2.0, 22 * sev);
            egtOffsets[i] = 12 * sev + fs.inst.egt[i]; // late burning raises mean EGT, plus fluctuation
            chtOffsets[i] = 5 * sev;
          }
          fs.inst.rpm = bandNoise(fs.inst.rpm, 10.0, 30 * sev);
          fs.inst.map = bandNoise(fs.inst.map, 5.0, 0.025 * sev);
          fs.inst.lam = bandNoise(fs.inst.lam, 5.0, 0.035 * sev);
          targetRpm += fs.inst.rpm;
          mapOffset = fs.inst.map;
          lambdaOffset = fs.inst.lam;
          vibOffset = 0.35 * sev + g(0, 0.08 * sev);
          break;
        }
        case 'INJECTOR_COKING': {
          // Carbon deposits on all injector nozzles (uneven): restricted fuel delivery -> lean shift.
          const pattern = params.pattern ?? [0.9, 1.3, 0.6, 1.1];
          for (let i = 0; i < 4; i++) {
            egtOffsets[i] = 32 * sev * pattern[i];
            chtOffsets[i] = 7 * sev * pattern[i];
          }
          injFlowFactor = 1 - 0.085 * sev;         // restricted nozzles deliver ~8.5 % less fuel per ms
          lambdaOffset = PHYS.LAMBDA_TARGET * (1 / injFlowFactor - 1);   // lean before ECU correction
          vibOffset = 0.10 * sev + g(0, 0.03 * sev); // uneven cylinder torque
          break;
        }
        // SENSOR_DRIFT / SENSOR_FAILURE: engine physics unchanged; readings altered below
      }
    }

    // ECU closed-loop fuelling: the trim integrator drives the measured lambda back to its target
    // (within ±15 % authority). Richer-than-planned cylinders run cooler (EGT_PER_LAMBDA).
    const lambdaRaw = PHYS.LAMBDA_TARGET + lambdaOffset;           // what the sensor would read untrimmed
    let lambdaTrue = lambdaRaw / (1 + this.trim);
    this.trim = Math.max(-PHYS.TRIM_MAX, Math.min(PHYS.TRIM_MAX,
      this.trim + PHYS.TRIM_KI * dt * (lambdaTrue / PHYS.LAMBDA_TARGET - 1)));
    lambdaTrue = lambdaRaw / (1 + this.trim);
    const trimEgt = -PHYS.EGT_PER_LAMBDA * (lambdaRaw - lambdaTrue);

    e.rpm = Math.max(2000, Math.min(5800, targetRpm + rpmNoise));
    e.throttlePct = Math.max(0, Math.min(100, targetThrottle + g(0, 0.1)));
    e.mapBar = parseFloat(Math.max(0.6, Math.min(2.4, targetMap + mapOffset + mapNoise)).toFixed(3));
    e.egt = [
      parseFloat((baseEgt + egtOffsets[0] + trimEgt + g(0, 1.2)).toFixed(1)),
      parseFloat((baseEgt + egtOffsets[1] + trimEgt + g(0, 1.2)).toFixed(1)),
      parseFloat((baseEgt + egtOffsets[2] + trimEgt + g(0, 1.5)).toFixed(1)),
      parseFloat((baseEgt + egtOffsets[3] + trimEgt + g(0, 1.2)).toFixed(1)),
    ];
    e.cht = [0, 1, 2, 3].map(i => parseFloat((baseCht + chtOffsets[i] + g(0, 0.3)).toFixed(1)));
    e.oilPressBar = parseFloat(Math.max(0.5, Math.min(6.0, baseOilPress + oilPressOffset + g(0, 0.02))).toFixed(2));
    e.oilTempC = parseFloat(Math.max(50, Math.min(150, baseOilTemp + oilTempOffset + g(0, 0.1))).toFixed(1));
    e.vibrationGrms = parseFloat(Math.max(0.08, Math.min(3.5, baseVib + vibOffset + vibNoise)).toFixed(3));
    // Fuel: the ECU commands nominal fuel x (1 + trim); restricted (coked) nozzles deliver less of it
    const commandedFuel = nominalFuelLph(e.throttlePct, af.pf) * (1 + this.trim);
    e.fuelFlowLph = parseFloat((commandedFuel * injFlowFactor + g(0, 0.05)).toFixed(1));
    e.injPulseMs = parseFloat(injPulseMs(commandedFuel, e.rpm).toFixed(2));
    e.fuelTrimPct = parseFloat((this.trim * 100).toFixed(1));
    e.lambda = parseFloat((lambdaTrue + g(0, 0.003)).toFixed(3));
    e.wastegateDutyPct = parseFloat(af.wastegatePct.toFixed(1));
    e.coolantTempC = parseFloat((this.thermal.coolant + coolantOffset + g(0, 0.2)).toFixed(1));

    // Electrical: payload load wanders slowly; heaters switch in below 0 °C OAT
    const el = this.electrical;
    el.payloadA = bandNoise(el.payloadA, 1 / 30, 3.0);
    const loadA = Math.max(5, el.baseLoadA + el.payloadA + PHYS.HEATER_A_PER_C * Math.max(0, -amb.oatC));
    const es = electricalState(e.rpm, loadA, el.soc, altCapFactor, regDroopV);
    el.soc = Math.max(0, Math.min(1, el.soc + es.iBat * dt / (3600 * PHYS.BATT_AH)));
    e.genVoltageV = parseFloat((es.vBus + g(0, 0.05)).toFixed(1));
    e.genCurrentA = parseFloat((es.iAlt + g(0, 0.4)).toFixed(1));
    e.batteryCurrentA = parseFloat((es.iBat + g(0, 0.15)).toFixed(1));
    e.batterySocPct = parseFloat(Math.max(0, Math.min(100, el.soc * 100 + g(0, 0.05))).toFixed(1));   // a SOC reading cannot exceed 0-100 %

    // Air data
    e.ambientPressureBar = parseFloat((amb.pBar + g(0, 0.0005)).toFixed(4));
    e.oatC = parseFloat((amb.oatC + g(0, 0.1)).toFixed(1));
    e.altitudeFt = Math.round(amb.altitudeFt);

    // Measurement-chain faults: applied to the reading only, after the engine physics
    if (this.fault.activeFault === 'SENSOR_DRIFT') {
      const ch = params.channel ?? 'cht2';
      const full = SENSOR_DRIFT_FULL_SCALE[ch.replace(/[0-9]/g, '')];
      const ramp = Math.min(1, (time - fs.t0) / SENSOR_DRIFT_RAMP_S); // bias builds up after onset
      writeChannel(e, ch, readChannel(e, ch) + (params.sign ?? 1) * full * this.fault.severity * ramp);
    } else if (this.fault.activeFault === 'SENSOR_FAILURE') {
      const ch = params.channel ?? 'oil_pressure';
      if (fs.stuck === null) fs.stuck = readChannel(e, ch); // sensor freezes at its last value
      writeChannel(e, ch, fs.stuck);
    }
  }
}

/**
 * Golden twin: expected (nominal) sensor values computed only from measured quantities —
 * operating point (throttle, RPM), air data (ambient pressure, OAT) and the measured electrical
 * load and battery state — with first-order thermal lag so transients are not mistaken for
 * faults. Never reads fault state.
 */
export class GoldenTwin {
  static K = { egt: 0.8, cht: 0.05, oilTemp: 0.02, coolant: 0.05 };

  constructor() { this.state = null; }

  reset() { this.state = null; }

  static targets(throttlePct, rpm, pBar = REF_P, oatC = REF_OAT_C) {
    return thermalTargets(throttlePct, rpm, pBar, oatC);
  }

  /** Advance the twin by dt seconds and return nominal values + residuals for engine frame e */
  update(e, dt) {
    const pBar = e.ambientPressureBar ?? REF_P;
    const oatC = e.oatC ?? REF_OAT_C;
    const tgt = GoldenTwin.targets(e.throttlePct, e.rpm, pBar, oatC);
    if (!this.state) this.state = { egt: tgt.egt, cht: tgt.cht, oilTemp: tgt.oilTemp, coolant: tgt.coolant };
    else {
      for (const k of ['egt', 'cht', 'oilTemp', 'coolant']) {
        this.state[k] += (1 - Math.exp(-GoldenTwin.K[k] * dt)) * (tgt[k] - this.state[k]);
      }
    }
    // Electrical: the load is observable as alternator current minus battery current
    const soc = (e.batterySocPct ?? 98) / 100;
    const loadA = (e.genCurrentA ?? 0) - (e.batteryCurrentA ?? 0);
    const es = electricalState(e.rpm, loadA, soc);
    const fuel = nominalFuelLph(e.throttlePct, tgt.pf);
    const nominal = {
      egt: this.state.egt,
      cht: this.state.cht,
      oilTemp: this.state.oilTemp,
      oilPress: 3.85 - (this.state.oilTemp - 98.0) * 0.015,
      map: tgt.map,
      vib: 0.28 + ((e.rpm - 4800) / 5800) * 0.12,
      fuelFlow: fuel,
      injPulseMs: injPulseMs(fuel, e.rpm),
      fuelTrimPct: 0,
      lambda: PHYS.LAMBDA_TARGET,
      genV: es.vBus,
      batteryA: es.iBat,
      coolant: this.state.coolant,
    };
    const residuals = {
      egt: e.egt.map(v => v - nominal.egt),
      cht: e.cht.map(v => v - nominal.cht),
      map: e.mapBar - nominal.map,
      oilPress: e.oilPressBar - nominal.oilPress,
      oilTemp: e.oilTempC - nominal.oilTemp,
      vib: e.vibrationGrms - nominal.vib,
      genV: e.genVoltageV - nominal.genV,
      batteryA: (e.batteryCurrentA ?? nominal.batteryA) - nominal.batteryA,
      injPct: e.injPulseMs != null ? 100 * (e.injPulseMs - nominal.injPulseMs) / nominal.injPulseMs : 0,
      fuelTrimPct: e.fuelTrimPct ?? 0,
      coolant: e.coolantTempC - nominal.coolant,
    };
    return { nominal, residuals };
  }
}

/**
 * Layer-1 threshold health monitor (conventional exceedance logic).
 * Uses sensor values and golden-twin residuals only — never the injected fault label.
 * Returns { index 0-100, status, exceedances[] }.
 */
export function thresholdHealth(e, r) {
  // [name, normalised exceedance (0 = at caution limit, 1 = at critical limit), critical?]
  const checks = [
    ['EGT', Math.max(...r.egt), 40, 110],
    ['EGT_ABS', Math.max(...e.egt), 930, 950],  // nominal at 100% / 5800 rpm is ~908 °C
    ['CHT', Math.max(...r.cht), 12, 28],
    ['CHT_ABS', Math.max(...e.cht), 125, 135],
    ['OIL_PRESS', -r.oilPress, 0.5, 1.5],
    ['OIL_PRESS_ABS', -e.oilPressBar, -2.5, -1.8],
    ['OIL_TEMP', r.oilTemp, 10, 25],
    ['VIBRATION', r.vib, 0.25, 0.9],
    ['MAP', r.map, 0.15, 0.4],
    ['GEN_VOLTS', -r.genV, 1.2, 3.5],
    ['BUS_VOLTS_ABS', -e.genVoltageV, -26.5, -25.0],
    ['BATTERY_DISCHARGE', -(r.batteryA ?? 0), 5, 20],
    ['BATTERY_SOC_ABS', -(e.batterySocPct ?? 100), -40, -20],
    ['FUEL_TRIM', Math.abs(r.fuelTrimPct ?? 0), 10, 14.5],
    ['COOLANT', r.coolant, 10, 25],
  ];
  // Electrical checks say nothing about engine thrust: the engine's own generator powers its ECU and
  // fuel pumps, so an aircraft-bus alternator failure drains the avionics battery but does not derate
  // the engine. The flight model therefore uses propulsionIndex; index covers everything.
  const ELECTRICAL = new Set(['GEN_VOLTS', 'BUS_VOLTS_ABS', 'BATTERY_DISCHARGE', 'BATTERY_SOC_ABS']);
  let penalty = 0, propulsionPenalty = 0;
  let status = 'NOMINAL';
  const exceedances = [];
  for (const [name, v, caution, critical] of checks) {
    if (v <= caution) continue;
    const x = (v - caution) / (critical - caution);
    exceedances.push(name.replace('_ABS', ''));
    const p = 12 + 70 * Math.min(1.2, x);
    penalty = Math.max(penalty, p);
    if (!ELECTRICAL.has(name)) propulsionPenalty = Math.max(propulsionPenalty, p);
    if (x >= 1) status = 'CRITICAL';
    else if (status !== 'CRITICAL') status = 'DEGRADED';
  }
  return {
    index: Math.max(10, Math.min(98, 98 - penalty)),
    propulsionIndex: Math.max(10, Math.min(98, 98 - propulsionPenalty)),
    status,
    exceedances: [...new Set(exceedances)],
  };
}
