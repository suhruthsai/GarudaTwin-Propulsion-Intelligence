/**
 * Fleet of escort UAVs (Vahak-2..5). Each airborne vehicle runs its own engine simulator
 * (independent noise), golden twin, L1 threshold monitor and AI session (uav_id = its id), so its
 * health, RUL and diagnosis are computed exactly like Vahak-1's — nothing is hard-coded.
 *
 * Station data (position, altitude, airspeed) are assigned orbit parameters: only Vahak-1 has a
 * 6-DOF flight model. Operating points lie inside the range the AI was trained on
 * (3000-5800 rpm, 30-100 % throttle). Vahak-5 is on the ground: engine off, no engine data.
 */
import { EngineSimulator, GoldenTwin, thresholdHealth } from '../src/engine/EngineSimulator.js';
import { frameFromEngineState, aiPayloadFromFrame } from './engineFrame.js';

// Flight hours drive the AI's scheduled-TBO remaining life when no fault is diagnosed
export const FLEET_SPEC = [
  { id: 'Vahak-2', callsign: 'Vahak-2 (ESCORT LEAD)', engine: 'Rotax 915 iS', serial: 'RTX-0819', flightHours: 415.0,
    role: 'Escort lead, sector south', station: { lat: 25.95, lon: 70.85, altitudeFt: 15200, airspeedKts: 118 },
    op: { rpm: 4950, throttle: 80.0 }, initialFault: null },
  { id: 'Vahak-3', callsign: 'Vahak-3 (RELAY ORBIT)', engine: 'Rotax 916 iS', serial: 'RTX-0902', flightHours: 80.0,
    role: 'Communications relay orbit', station: { lat: 26.70, lon: 71.30, altitudeFt: 18000, airspeedKts: 125 },
    op: { rpm: 5100, throttle: 82.5 }, initialFault: null },
  { id: 'Vahak-4', callsign: 'Vahak-4 (PERIMETER PATROL)', engine: 'Rotax 915 iS', serial: 'RTX-0754', flightHours: 780.0,
    role: 'Perimeter patrol, desert corridor', station: { lat: 26.35, lon: 70.90, altitudeFt: 12000, airspeedKts: 98 },
    op: { rpm: 4600, throttle: 72.0 },
    // Demonstration scenario so the fleet starts with one degraded engine; it is shown as the
    // injected scenario (ground truth) and the AI has to find it like any other fault.
    initialFault: { activeFault: 'PRGB_DEGRADATION', severity: 0.25 } },
  { id: 'Vahak-5', callsign: 'Vahak-5 (HANGAR RESERVE)', engine: 'Rotax 915 iS', serial: 'RTX-0699', flightHours: 1080.0,
    role: 'Hangar reserve, AFS Uttarlai', station: { lat: 25.8117, lon: 71.4883, altitudeFt: 500, airspeedKts: 0 },
    grounded: true },
];

// Engine subsystem affected by each diagnosis (fixed engineering mapping, used for the
// subsystem view; not a separate model)
export const FAULT_SUBSYSTEM = {
  CYL3_INJECTOR: 'combustion', MISFIRE: 'combustion', COMBUSTION_INSTABILITY: 'combustion', INJECTOR_COKING: 'combustion',
  BLOW_BY: 'combustion', OIL_PUMP_CAVITATION: 'lubrication', TURBO_WASTEGATE_STUCK: 'induction',
  COOLING_DEGRADATION: 'cooling', PRGB_DEGRADATION: 'gearbox', GENERATOR_FAILURE: 'electrical',
  SENSOR_DRIFT: 'sensors', SENSOR_FAILURE: 'sensors',
};
export const SUBSYSTEMS = ['combustion', 'lubrication', 'induction', 'cooling', 'gearbox', 'electrical', 'sensors'];

/** Subsystem view from an AI result: the diagnosed subsystem is flagged, the rest show no diagnosed fault. */
export function subsystemsFromAi(ai) {
  const dx = ai?.health?.diagnosed_fault;
  const flagged = FAULT_SUBSYSTEM[dx] ?? null;
  return Object.fromEntries(SUBSYSTEMS.map(s => [s, s === flagged
    ? { status: s === 'sensors' ? 'INSPECT' : 'FAULT', diagnosis: dx, health: ai.rul?.healthIndexScore ?? null }
    : { status: ai ? 'OK' : 'UNKNOWN' }]));
}

/** Summary of one AI result for the fleet table. */
export function aiSummary(ai) {
  if (!ai) return null;
  return {
    diagnosis: ai.health?.diagnosed_fault ?? 'NONE',
    severityLevel: ai.health?.severity_level ?? 'NOMINAL',
    health: ai.rul?.healthIndexScore ?? null,
    rulHours: ai.rul?.rulHours ?? null,
    rulLower95: ai.rul?.rulHoursLower95 ?? null,
    rulUpper95: ai.rul?.rulHoursUpper95 ?? null,
    topCause: ai.feature_attributions?.[0]?.description ?? null,
    suspectSensor: ai.health?.suspect_sensor ?? null,
    action: ai.maintenance?.action ?? null,
  };
}

class FleetMember {
  constructor(spec) {
    this.spec = spec;
    this.fault = { activeFault: 'NONE', severity: 0, ...(spec.initialFault || {}) };
    this.ai = null;
    this.aiError = null;
    this.resetPending = true;
    this.twinState = null;
    if (spec.grounded) return;
    this.sim = new EngineSimulator({ fault: this.fault });
    this.sim.time = Math.random() * 600;
    this.sim.manual.rpm = spec.op.rpm;
    this.sim.manual.throttle = spec.op.throttle;
    this.sim.ambient = { altitudeFt: spec.station.altitudeFt, isaDevC: 0 };   // engine at its orbit altitude
    this.sim.settleThermal();
    this.twin = new GoldenTwin();
    this.lastTwinT = this.sim.time;
  }

  get airborne() { return !this.spec.grounded; }

  /** Golden-twin residuals + L1 threshold monitor at the current instant (called by the broadcast loop). */
  updateTwin() {
    if (!this.airborne) return;
    const dt = Math.max(0, this.sim.time - this.lastTwinT);
    this.lastTwinT = this.sim.time;
    const r = this.twin.update(this.sim.engine, dt).residuals;
    const th = thresholdHealth(this.sim.engine, r);
    this.twinState = { r, th };
  }

  snapshot() {
    const s = this.spec;
    const base = {
      id: s.id, callsign: s.callsign, engine: `${s.engine} (S/N: ${s.serial})`, serial: s.serial, role: s.role,
      airborne: this.airborne, flightHours: s.flightHours, station: s.station,
      injectedFault: this.airborne ? this.fault.activeFault : null,
      injectedSeverity: this.airborne ? this.fault.severity : null,
    };
    if (!this.airborne) {
      return { ...base, status: 'GROUNDED', engineState: null, residuals: null, l1: null, ai: null,
        subsystems: null, note: 'On the ground, engine not running: no live engine data.' };
    }
    const e = this.sim.engine;
    const r = this.twinState?.r;
    const round = (v, d) => Number(v.toFixed(d));
    const summary = aiSummary(this.ai);
    return {
      ...base,
      status: !summary ? 'NO AI DATA' : summary.severityLevel === 'CRITICAL' ? 'CRITICAL'
        : summary.severityLevel === 'ELEVATED' ? 'CAUTION' : 'ON STATION',
      engineState: { ...e, egt: [...e.egt], cht: [...e.cht] },
      residuals: r ? {
        egtResiduals: r.egt.map(v => round(v, 1)), chtResiduals: r.cht.map(v => round(v, 1)),
        mapResidual: round(r.map, 3), oilPressResidual: round(r.oilPress, 2), oilTempResidual: round(r.oilTemp, 1),
        vibrationResidual: round(r.vib, 3), genVoltageResidual: round(r.genV, 1), coolantTempResidual: round(r.coolant, 1),
        batteryCurrentResidual: round(r.batteryA, 1), injectionTimeResidualPct: round(r.injPct, 1), fuelTrimPct: round(r.fuelTrimPct, 1),
      } : null,
      l1: this.twinState ? { index: Number(this.twinState.th.index.toFixed(1)), status: this.twinState.th.status,
        exceedances: this.twinState.th.exceedances } : null,
      ai: summary,
      aiError: this.aiError,
      subsystems: subsystemsFromAi(this.ai),
    };
  }
}

export class Fleet {
  constructor() {
    this.members = FLEET_SPEC.map(s => new FleetMember(s));
    this.busy = false;
  }

  get(id) { return this.members.find(m => m.spec.id === id) ?? null; }
  step(dt) { for (const m of this.members) if (m.airborne) m.sim.step(dt); }
  updateTwins() { for (const m of this.members) m.updateTwin(); }
  snapshots() { return this.members.map(m => m.snapshot()); }

  /** Score every airborne vehicle once (sequentially). aiCall(path, body) is the gateway's AI client. */
  async scoreAll(aiCall) {
    if (this.busy) return null;
    this.busy = true;
    const results = {};
    try {
      for (const m of this.members) {
        if (!m.airborne) continue;
        try {
          if (m.resetPending) { await aiCall('/api/health-rul/reset', { uav_id: m.spec.id }); m.resetPending = false; }
          const payload = aiPayloadFromFrame(frameFromEngineState(m.sim.engine),
            { uavId: m.spec.id, timeS: m.sim.time, flightHours: m.spec.flightHours });
          m.ai = await aiCall('/api/health-rul/predict', payload);
          m.aiError = null;
          results[m.spec.id] = m.ai;
        } catch (err) {
          m.ai = null;
          m.aiError = err.message;
          m.resetPending = true;     // session state unknown after a failed call
        }
      }
    } finally {
      this.busy = false;
    }
    return results;
  }
}
