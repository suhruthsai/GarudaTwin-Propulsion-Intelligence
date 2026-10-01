/**
 * GarudaTwin MALE UAV - CAN Bus Telemetry Engine & Socket.io Server
 * Simulates high-frequency CAN Bus frames (100 Hz binary / structured packets)
 * for Rotax 915/916 iS Turbocharged Aero Piston Engines.
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// FCS modules (ESM)
import { FlightDynamics6DOF, atmosphere, rad2deg } from './src/flight_controller/FlightDynamics6DOF.js';
import { CascadedAutopilot, FLIGHT_MODE }           from './src/flight_controller/CascadedAutopilot.js';
import { FadecFlightInterlock }                      from './src/flight_controller/FadecFlightInterlock.js';
import { TotalEnergyControlSystem }                  from './src/flight_controller/TotalEnergyControlSystem.js';
import { EngineSimulator, GoldenTwin, thresholdHealth, FAULT_TYPES } from './src/engine/EngineSimulator.js';
import { loadServiceConfig } from './server/serviceConfig.js';
import { Recorder } from './server/recorder.js';
import { Fleet, aiSummary, subsystemsFromAi } from './server/fleet.js';
import { classifyVehicle, rtbAction, RTB_PROFILES } from './src/planner/rtbRules.js';
import { STATION, GEOFENCE_RULES, geofenceCheck, validateRoute } from './src/planner/geofence.js';
import { ReplayPlayer, SPEEDS } from './server/replayPlayer.js';
import { normalizeFrame, applyFrameToEngineState, frameFromEngineState, aiPayloadFromFrame } from './server/engineFrame.js';
import crypto from 'crypto';

// SQLite (CommonJS via createRequire)
const _require = createRequire(import.meta.url);
const Database  = _require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Database initialisation ───────────────────────────────────
const DB_DIR = process.env.GCS_DATA_DIR ? path.resolve(process.env.GCS_DATA_DIR) : path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'garudatwin.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sorties (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uav_id       TEXT    NOT NULL DEFAULT 'Vahak-1',
    start_time   INTEGER NOT NULL,
    end_time     INTEGER,
    initial_alt  REAL,
    final_alt    REAL,
    distance_km  REAL    DEFAULT 0,
    notes        TEXT
  );

  CREATE TABLE IF NOT EXISTS fcs_telemetry (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sortie_id    INTEGER REFERENCES sorties(id),
    ts           INTEGER NOT NULL,
    roll_deg     REAL, pitch_deg REAL, heading_deg REAL,
    ias_kts      REAL,  tas_kts   REAL,
    alt_ft       REAL,  vsi_fpm   REAL,
    alpha_deg    REAL,  beta_deg  REAL,
    north_m      REAL,  east_m    REAL,
    nz           REAL,  mach      REAL,
    ap_mode      TEXT,  throttle_pct REAL
  );

  CREATE TABLE IF NOT EXISTS control_surfaces (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sortie_id    INTEGER REFERENCES sorties(id),
    ts           INTEGER NOT NULL,
    elevator_deg REAL, aileron_deg REAL,
    rudder_deg   REAL, flap_deg    REAL,
    throttle_pct REAL, speed_brake INTEGER,
    thrust_n     REAL
  );

  CREATE TABLE IF NOT EXISTS autopilot_guidance (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sortie_id    INTEGER REFERENCES sorties(id),
    ts           INTEGER NOT NULL,
    mode         TEXT,  armed INTEGER,
    alt_sp       REAL,  ias_sp REAL, heading_sp REAL,
    tecs_iE      REAL,  tecs_iB REAL,
    glide_range  REAL
  );

  CREATE TABLE IF NOT EXISTS emergency_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sortie_id    INTEGER REFERENCES sorties(id),
    ts           INTEGER NOT NULL,
    event_type   TEXT,
    health_pct   REAL, ias_kts REAL, alt_ft REAL,
    north_m      REAL, east_m  REAL,
    annunciators TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_fcs_ts       ON fcs_telemetry(ts);
  CREATE INDEX IF NOT EXISTS idx_surfaces_ts  ON control_surfaces(ts);
  CREATE INDEX IF NOT EXISTS idx_autopilot_ts ON autopilot_guidance(ts);
  CREATE INDEX IF NOT EXISTS idx_emergency_ts ON emergency_events(ts);
  CREATE INDEX IF NOT EXISTS idx_fcs_sortie   ON fcs_telemetry(sortie_id, ts);
  CREATE INDEX IF NOT EXISTS idx_surf_sortie  ON control_surfaces(sortie_id, ts);
  CREATE INDEX IF NOT EXISTS idx_guide_sortie ON autopilot_guidance(sortie_id, ts);
`);

// Create opening sortie record
const _stmtOpenSortie = db.prepare(`INSERT INTO sorties (uav_id, start_time, initial_alt) VALUES (?,?,?)`);
let activeSortieId    = _stmtOpenSortie.run('Vahak-1', Date.now(), 4419.6).lastInsertRowid;

// Engine flight recorder (every flight, 10 Hz + the exact frames the AI scored)
const recorder = new Recorder(db);

// Prepared insert statements
const _insFcs = db.prepare(`
  INSERT INTO fcs_telemetry
  (sortie_id,ts,roll_deg,pitch_deg,heading_deg,ias_kts,tas_kts,alt_ft,vsi_fpm,alpha_deg,beta_deg,north_m,east_m,nz,mach,ap_mode,throttle_pct)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);
const _insSurf = db.prepare(`
  INSERT INTO control_surfaces
  (sortie_id,ts,elevator_deg,aileron_deg,rudder_deg,flap_deg,throttle_pct,speed_brake,thrust_n)
  VALUES (?,?,?,?,?,?,?,?,?)
`);
const _insGuide = db.prepare(`
  INSERT INTO autopilot_guidance
  (sortie_id,ts,mode,armed,alt_sp,ias_sp,heading_sp,tecs_iE,tecs_iB,glide_range)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`);
const _insEvent = db.prepare(`
  INSERT INTO emergency_events (sortie_id,ts,event_type,health_pct,ias_kts,alt_ft,north_m,east_m,annunciators)
  VALUES (?,?,?,?,?,?,?,?,?)
`);

const _batchWrite = db.transaction((rows) => {
  for (const r of rows) {
    _insFcs.run(...r.fcs);
    _insSurf.run(...r.surf);
    _insGuide.run(...r.guide);
    if (r.event) _insEvent.run(...r.event);
  }
});

let _dbBuf = [];
function _bufferRow(fd, ctrl, apd, ilk, ts) {
  _dbBuf.push({
    fcs: [
      activeSortieId, ts,
      fd.roll_deg, fd.pitch_deg, fd.heading_deg,
      fd.ias_kts,  fd.tas_kts,
      fd.alt_ft,   fd.vsi_fpm,
      fd.alpha_deg, fd.beta_deg,
      fd.north_m, fd.east_m,
      fd.Nz, fd.mach, ctrl.mode || 'ALT_HOLD', fd.throttle_pct,
    ],
    surf: [
      activeSortieId, ts,
      fd.elevator_deg, fd.aileron_deg,
      fd.rudder_deg,   fd.flap_deg,
      fd.throttle_pct, fd.speed_brake ? 1 : 0,
      fd.thrust_N,
    ],
    guide: [
      activeSortieId, ts,
      apd.mode, apd.armed ? 1 : 0,
      apd.sp?.alt_m ?? 4419.6,
      apd.sp?.ias_ms ?? 56.6,
      apd.sp?.heading_rad ?? 0,
      apd.tecs?.int_total ?? 0,
      apd.tecs?.int_balance ?? 0,
      ilk?.glideRange ?? 0,
    ],
    event: null,
  });
}
function _flushDb() {
  if (!_dbBuf.length) return;
  try { _batchWrite(_dbBuf); } catch (_) { /* ignore */ }
  _dbBuf = [];
}

// ── FCS Instances ─────────────────────────────────────────────
const fcs6dof   = new FlightDynamics6DOF();
const autopilot = new CascadedAutopilot();
const fadec     = new FadecFlightInterlock(autopilot);

// Vahak-1 patrols an orbit around its station (previously it held heading 000 with no orbit and
// flew straight north until it crossed the border).
function patrolStation() {
  autopilot.setAltitude(4419.6);    // 14500 ft in metres
  autopilot.setAirspeed(56.6);      // 110 kts in m/s
  autopilot.setLoiter(0, 0, STATION.radiusM, true);   // local frame origin = station
  autopilot.arm();
  autopilot.setMode(FLIGHT_MODE.LOITER);
}
patrolStation();

// Geofence guard state (see src/planner/geofence.js)
const geofence = { status: 'OK', borderNm: null, aheadBorderNm: null, inside: true, reasons: [], interventions: 0, lastEvent: null };
let _geoTick = 0;

// Shared FCS state (written by FCS tick, read by broadcast)
let fcsState    = {};
let fcsControls = { throttle:0.38, de:-0.045, da:0, dr:0, df:0, sb:false, mode:'ALT_HOLD' };
let interlockOut = {};
let _fcsTick    = 0;
let _dbFlushTick = 0;

// ── Service configuration: CORS allowlist + gateway->AI internal key ──
const SERVICE = loadServiceConfig({ dataDir: DB_DIR });
const originAllowed = (origin) => !origin || SERVICE.allowedOrigins.has(origin); // no Origin = non-browser client

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Requests from a browser page on a non-allowlisted origin are refused outright
// (CORS alone only stops the page reading the response, not the request executing).
app.use((req, res, next) => originAllowed(req.headers.origin)
  ? next()
  : res.status(403).json({ error: 'origin not allowed' }));
app.use(cors({
  origin: (origin, cb) => cb(null, originAllowed(origin)),
  credentials: false,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 600,
}));
app.use(express.json({ limit: '64kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: false, methods: ['GET', 'POST'] },
  // WebSocket upgrades are not covered by CORS, so check Origin explicitly
  allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
});
const PORT = process.env.PORT || 5002;
const HOST = process.env.HOST || '127.0.0.1';
const AI_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';
const AI_HEADERS = { 'Content-Type': 'application/json', 'X-Internal-Key': SERVICE.internalKey };

// System Global State
// ── Input validation (rejects NaN/strings that would poison the 6-DOF integrator) ──
const VALID_FAULTS = new Set(FAULT_TYPES);
const LIMITS = {
  alt_m:   [0, 7010],      // Rotax 915 iS service ceiling ~23,000 ft
  ias_ms:  [60 / 1.94384, 240 / 1.94384],  // 60 kt stall-buffer .. Vne 240 kt
  heading: [-4 * Math.PI, 4 * Math.PI],
};
function finiteIn(v, [lo, hi]) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return (typeof n === 'number' && Number.isFinite(n)) ? Math.min(hi, Math.max(lo, n)) : null;
}
function validWaypoints(wps) {
  return Array.isArray(wps) && wps.length > 0 && wps.length <= 200 && wps.every(w =>
    Number.isFinite(w?.north) && Number.isFinite(w?.east) &&
    (w.alt_m === undefined || (Number.isFinite(w.alt_m) && w.alt_m >= LIMITS.alt_m[0] && w.alt_m <= LIMITS.alt_m[1])));
}
function parseFault(data) {
  const uavId = data?.uavId ?? 'Vahak-1';
  if (uavId !== 'Vahak-1') {
    const m = fleet.get(uavId);
    if (!m) return { error: `unknown uavId '${uavId}'` };
    if (!m.airborne) return { error: `${uavId} is on the ground (engine not running)` };
  }
  const faultType = data?.faultType ?? 'NONE';
  if (!VALID_FAULTS.has(faultType)) return { error: `unknown faultType '${faultType}'` };
  const sev = data?.severity === undefined ? 0.85 : finiteIn(data.severity, [0, 1]);
  if (sev === null) return { error: 'severity must be a number in [0,1]' };
  return { faultType, severity: sev, uavId };
}

/** Apply a parsed fault to Vahak-1 (faultState) or a fleet vehicle; returns the fault object. */
function applyFault(f) {
  const target = f.uavId === 'Vahak-1' ? faultState : fleet.get(f.uavId).fault;
  target.activeFault = f.faultType;
  target.severity = f.faultType === 'NONE' ? 0 : f.severity;
  if (f.uavId === 'Vahak-1') target.injectedAt = f.faultType === 'NONE' ? null : Date.now();
  return target;
}

let faultState = {
  activeFault: 'NONE', // 'NONE' | 'CYL3_INJECTOR' | 'BLOW_BY' | 'OIL_PUMP_CAVITATION' | 'TURBO_WASTEGATE_STUCK' | 'COOLING_DEGRADATION'
  severity: 0.85,      // 0.0 to 1.0
  injectedAt: null,
  durationSeconds: 0
};

let missionState = {
  missionTime: 0,
  altitudeFt: 14500,
  airspeedKts: 110,
  ambientTempC: -13.7,      // updated from the engine's air data every broadcast
  baroPressureBar: 0.583,
  isaDevC: 0,               // ISA temperature deviation of the day (°C)
  uavId: 'Vahak-1',
  missionPhase: 'LOITER' // 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'LOITER' | 'RTB' | 'DESCENT'
};

// Escort fleet (Vahak-2..5): own simulators, golden twins and AI sessions (server/fleet.js)
const fleet = new Fleet();
const VAHAK1_FLIGHT_HOURS = 1248.6;   // engine hours of the live vehicle (scheduled-TBO remaining life)
const VAHAK1_SPEC = { callsign: 'Vahak-1 (ACTIVE TESTBED)', engine: 'Rotax 915 iS', serial: 'ENG-882-X',
  role: 'Lead testbed, Thar border orbit' };

// Engine simulator (shared with the ML dataset generator) + golden-twin nominal model
const sim = new EngineSimulator({ fault: faultState });
const engineState = sim.engine;
const goldenTwin = new GoldenTwin();
let _lastTwinSimTime = 0;

// ── Engine data source ────────────────────────────────────────
//   SIM     built-in physics simulator (default; the only mode with fault injection)
//   REPLAY  a recorded flight or imported CSV, played through the same twin + AI
//   LIVE    frames pushed by a test rig / CAN bridge (POST /api/ingest/frames)
// Everything downstream (golden twin, L1 monitor, AI, UI) reads engineState and dataTime(),
// so it cannot tell — and does not need to know — where the numbers came from.
const LIVE_TIMEOUT_MS = 2000;
const SEGMENT_GAP_S = 5.0;          // longer data gaps restart the AI session (same rule as CSV import)
const REPLAY_UAV = 'REPLAY';        // replay has its own AI session; the live vehicle's is untouched
const source = { mode: 'SIM', replay: null, live: null };
let _aiResetPending = true;         // the live AI session starts fresh with every recording
let _twinResetPending = false;      // gateway golden twin restarts after a seek / segment / mode change
let _recTick = 0;

function dataTime() {
  if (source.mode === 'REPLAY') return source.replay.player.cursor;
  if (source.mode === 'LIVE') return source.live.lastT ?? 0;
  return sim.time;
}

/** Injected scenario / CSV label: ground truth for display and evaluation, never an AI input. */
function scenarioTruth() {
  if (source.mode === 'SIM') return { label: faultState.activeFault, severity: faultState.severity };
  if (source.mode === 'REPLAY') {
    const f = source.replay.player.current();
    return { label: f.truth_label ?? null, severity: f.truth_severity ?? null };
  }
  return { label: null, severity: null };
}

function startRecording(kind) {
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const name = kind === 'SIM' ? `Sortie #${activeSortieId} simulator ${stamp}` : `Live ingest ${stamp}`;
  recorder.start({ source: kind, name, uavId: missionState.uavId });
  _aiResetPending = true;
}

const newReplayStats = () => ({ scored: 0, truthN: 0, truthAgree: 0, liveN: 0, liveAgree: 0, firstLiveMismatch: null,
  confusion: {}, sessionRestarts: 0 });

function setSourceMode(mode, opts = {}) {
  if (source.mode !== 'REPLAY') recorder.stop();
  source.replay = null;
  source.live = null;
  source.mode = mode;
  _twinResetPending = true;
  lastAiResult = null;
  if (mode === 'SIM') startRecording('SIM');
  else if (mode === 'LIVE') {
    source.live = { startWall: Date.now(), lastFrameWall: null, lastT: null, lastScoredT: null, fresh: false,
      frames: 0, rejected: 0, lastError: null };
    startRecording('LIVE');
  } else if (mode === 'REPLAY') {
    // first AI frame of each recorded segment: where the live session was (re)started
    const segStarts = new Set();
    let seg;
    for (const f of opts.player.frames) if (f.ai_input && f.segment !== seg) { segStarts.add(f.seq); seg = f.segment; }
    source.replay = { id: opts.id, name: opts.name, player: opts.player, hasTruth: opts.hasTruth, segStarts,
      hasLive: opts.player.frames.some(f => f.live_diagnosis),
      exact: false, aiQueue: [], epoch: 0, resetPending: true, stats: newReplayStats(), lastError: null };
  }
  io.emit('source_changed', sourceStatus());
}

function replaySeek(r, t) {
  r.player.seek(t);
  r.aiQueue = [];
  r.epoch++;
  r.resetPending = true;
  r.exact = false;            // exact reproduction resumes at the next recorded segment start
  r.lastError = null;
  _twinResetPending = true;
}

function replayStep(dt) {
  const r = source.replay;
  const { frame, aiDue } = r.player.tick(dt, { hold: r.aiQueue.length >= 20 });  // AI back-pressure
  applyFrameToEngineState(frame, engineState);
  for (const a of aiDue) r.aiQueue.push(a);
  if (aiDue.some(a => a.newSegment)) _twinResetPending = true;
}

function sourceStatus() {
  const s = { mode: source.mode, recordingId: recorder.active?.id ?? null };
  if (source.mode === 'REPLAY') {
    const r = source.replay, p = r.player;
    s.replay = { id: r.id, name: r.name, t_s: p.cursor, duration_s: p.endT, playing: p.playing, speed: p.speed,
      ended: p.ended, aiQueue: r.aiQueue.length, hasTruth: r.hasTruth, hasLive: r.hasLive, truth: p.current().truth_label ?? null,
      exact: r.exact, stats: r.stats, error: r.lastError };
  } else if (source.mode === 'LIVE') {
    const l = source.live;
    const age = l.lastFrameWall ? Date.now() - l.lastFrameWall : null;
    s.live = { frames: l.frames, rejected: l.rejected, lastError: l.lastError, lastFrameAgeMs: age,
      connected: age !== null && age <= LIVE_TIMEOUT_MS };
  }
  return s;
}

/**
 * Packs sensor values into CAN 2.0 frames (big-endian 16-bit fields). The authoritative layout is
 * tools/can/garudatwin_engine.dbc; the CAN bridge decodes real or virtual bus traffic with it.
 * CAN ID 0x100: RPM (u16, 1 rpm), Throttle (u16, 0.01 %), FuelFlow (u16, 0.01 L/h), Lambda (u16, 0.001)
 * CAN ID 0x200: EGT1..EGT4 (u16, 0.1 °C)
 * CAN ID 0x210: CHT1..CHT4 (u16, 0.1 °C)
 * CAN ID 0x300: MAP (u16, 0.001 bar), OilPress (u16, 0.001 bar), OilTemp (u16, 0.01 °C, offset -50), Vibration (u16, 0.001 g)
 * CAN ID 0x310: GenVoltage (u16, 0.01 V), GenCurrent (s16, 0.01 A), CoolantTemp (u16, 0.01 °C, offset -50)
 * CAN ID 0x320: InjectionTime (u16, 0.001 ms), FuelTrim (s16, 0.01 %), BatteryCurrent (s16, 0.01 A), BatterySOC (u16, 0.01 %)
 * CAN ID 0x330: AmbientPressure (u16, 0.0001 bar), OAT (s16, 0.01 °C)
 */
function generateBinaryCanFrames() {
  const buf0x100 = Buffer.alloc(8);
  buf0x100.writeUInt16BE(Math.round(engineState.rpm), 0);
  buf0x100.writeUInt16BE(Math.round(engineState.throttlePct * 100), 2);
  buf0x100.writeUInt16BE(Math.round(engineState.fuelFlowLph * 100), 4);
  buf0x100.writeUInt16BE(Math.round(engineState.lambda * 1000), 6);

  const buf0x200 = Buffer.alloc(8);
  buf0x200.writeUInt16BE(Math.round(engineState.egt[0] * 10), 0);
  buf0x200.writeUInt16BE(Math.round(engineState.egt[1] * 10), 2);
  buf0x200.writeUInt16BE(Math.round(engineState.egt[2] * 10), 4);
  buf0x200.writeUInt16BE(Math.round(engineState.egt[3] * 10), 6);

  const buf0x210 = Buffer.alloc(8);
  buf0x210.writeUInt16BE(Math.round(engineState.cht[0] * 10), 0);
  buf0x210.writeUInt16BE(Math.round(engineState.cht[1] * 10), 2);
  buf0x210.writeUInt16BE(Math.round(engineState.cht[2] * 10), 4);
  buf0x210.writeUInt16BE(Math.round(engineState.cht[3] * 10), 6);

  const buf0x300 = Buffer.alloc(8);
  buf0x300.writeUInt16BE(Math.round(engineState.mapBar * 1000), 0);
  buf0x300.writeUInt16BE(Math.round(engineState.oilPressBar * 1000), 2);
  buf0x300.writeUInt16BE(Math.round((engineState.oilTempC + 50) * 100), 4);
  buf0x300.writeUInt16BE(Math.round(engineState.vibrationGrms * 1000), 6);

  const buf0x310 = Buffer.alloc(8);
  buf0x310.writeUInt16BE(Math.round(engineState.genVoltageV * 100), 0);
  buf0x310.writeInt16BE(Math.round(engineState.genCurrentA * 100), 2);
  buf0x310.writeUInt16BE(Math.round((engineState.coolantTempC + 50) * 100), 4);

  const buf0x320 = Buffer.alloc(8);
  buf0x320.writeUInt16BE(Math.round(engineState.injPulseMs * 1000), 0);
  buf0x320.writeInt16BE(Math.round(engineState.fuelTrimPct * 100), 2);
  buf0x320.writeInt16BE(Math.round(engineState.batteryCurrentA * 100), 4);
  buf0x320.writeUInt16BE(Math.round(engineState.batterySocPct * 100), 6);

  const buf0x330 = Buffer.alloc(8);
  buf0x330.writeUInt16BE(Math.round(engineState.ambientPressureBar * 10000), 0);
  buf0x330.writeInt16BE(Math.round(engineState.oatC * 100), 2);

  return [
    { canId: '0x100', dlc: 8, rawHex: buf0x100.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x200', dlc: 8, rawHex: buf0x200.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x210', dlc: 8, rawHex: buf0x210.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x300', dlc: 8, rawHex: buf0x300.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x310', dlc: 8, rawHex: buf0x310.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x320', dlc: 8, rawHex: buf0x320.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x330', dlc: 8, rawHex: buf0x330.toString('hex').toUpperCase(), timestamp: Date.now() }
  ];
}

function resetSimulationState() {
  fcs6dof.reset();
  if (typeof autopilot.reset === 'function') autopilot.reset();
  patrolStation();
  Object.assign(geofence, { status: 'OK', reasons: [], interventions: 0, lastEvent: null });
  fadec.resetFlameout();
  fcsState = {};
  fcsControls = { throttle: 0.38, de: -0.045, da: 0, dr: 0, df: 0, sb: false, mode: 'ALT_HOLD' };
  interlockOut = {};

  missionState.missionTime = 0;
  missionState.altitudeFt = 14500;
  missionState.airspeedKts = 110;
  missionState.headingDeg = 0;
  missionState.missionPhase = 'LOITER';
  missionState.lat = 26.4500;
  missionState.lon = 70.5200;
  missionState.north_m = 0;
  missionState.east_m = 0;

  faultState.activeFault = 'NONE';
  faultState.severity = 0.0;
  faultState.injectedAt = null;
  sim.reset();
  goldenTwin.reset();
  _lastTwinSimTime = 0;

  try {
    const res = _stmtOpenSortie.run('Vahak-1', Date.now(), 4419.6);
    activeSortieId = res.lastInsertRowid;
    console.log(`[FCS] Full simulation reset -> Started Sortie #${activeSortieId}`);
  } catch (err) {
    console.error('[FCS] Error starting new sortie on reset:', err.message);
  }
  // Each sortie is a new flight recording with a fresh live AI session
  if (source.mode === 'SIM') startRecording('SIM'); else setSourceMode('SIM');

  io.emit('fault_updated', faultState);
  io.emit('fcs_mode_changed', { mode: 'LOITER', armed: true });
}

// 100 Hz engine physics (fixed 10 ms sim step), FCS every 2nd step (50 Hz).
// Steps are driven by elapsed wall-clock time so sim time tracks real time even when the
// OS timer fires slower than 10 ms (Windows timer resolution is ~15.6 ms).
const PHYSICS_DT = 0.01;
let _lastTickMs = performance.now();
let _simAccumulator = 0;
setInterval(() => {
  const now = performance.now();
  _simAccumulator = Math.min(0.25, _simAccumulator + (now - _lastTickMs) / 1000);
  _lastTickMs = now;
  while (_simAccumulator >= PHYSICS_DT) {
    _simAccumulator -= PHYSICS_DT;
    physicsTick();
  }
}, 10);

function physicsTick() {
  if (source.mode === 'SIM') {
    sim.ambient.altitudeFt = fcsState.alt_ft ?? missionState.altitudeFt;   // engine follows the 6-DOF aircraft
    sim.ambient.isaDevC = missionState.isaDevC;
    sim.step(PHYSICS_DT);
    if (++_recTick % 10 === 0) {   // 10 Hz flight recording
      recorder.record(sim.time, frameFromEngineState(engineState),
        { truthLabel: faultState.activeFault, truthSeverity: faultState.severity });
    }
  } else if (source.mode === 'REPLAY') {
    replayStep(PHYSICS_DT);
  }
  missionState.missionTime = dataTime();
  fleet.step(PHYSICS_DT);

  _fcsTick++;
  if (_fcsTick % 2 === 0) {
    // ── FADEC interlock: compute derate from current engine health ──
    const engineTelemetry = {
      health:        (typeof fcsState.health_from_engine === 'number') ? fcsState.health_from_engine : 98,
      rpm:           engineState.rpm,
      egt_c:         engineState.egt[0],
      fuelFlow_kgh:  engineState.fuelFlowLph * 0.72,  // lph → kg/h (avgas density ~0.72)
      fuel_kg:       Math.max(0, 200 - missionState.missionTime * 0.0072),  // approximate fuel burn
      combustionEff: engineState.lambda > 0 ? Math.min(1, engineState.lambda) : 0.95,
      thrustN:       engineState.throttlePct * 18.0,  // approximate
    };
    const fcsDerived = Object.keys(fcsState).length ? fcsState : {
      ias_kts: missionState.airspeedKts,
      tas_ms:  missionState.airspeedKts / 1.94384,
      alt_m:   missionState.altitudeFt * 0.3048,
      Nz: 1.0, phi_rad: 0, rho: 1.225, north_m: 0, east_m: 0,
    };

    interlockOut = fadec.update(engineTelemetry, fcsDerived);

    // Apply interlock overrides to autopilot
    if (interlockOut.V_cmd_override) autopilot.setAirspeed(interlockOut.V_cmd_override);

    // Compute autopilot control commands
    const fcsInput = {
      phi_rad:   (fcsState.roll_deg    ?? 0) * Math.PI / 180,
      theta_rad: (fcsState.pitch_deg   ?? 2.87) * Math.PI / 180,
      psi_rad:   (fcsState.heading_deg ?? 0) * Math.PI / 180,
      p_rads:    (fcsState.p_dps       ?? 0) * Math.PI / 180,
      q_rads:    (fcsState.q_dps       ?? 0) * Math.PI / 180,
      r_rads:    (fcsState.r_dps       ?? 0) * Math.PI / 180,
      tas_ms:    fcsState.tas_ms       ?? 56.6,
      ias_ms:    fcsState.ias_ms       ?? 56.6,
      alt_m:     fcsState.alt_m        ?? 4419.6,
      vsi_ms:    fcsState.vsi_ms       ?? 0,
      alpha_rad: (fcsState.alpha_deg   ?? 2.87) * Math.PI / 180,
      beta_rad:  (fcsState.beta_deg    ?? 0) * Math.PI / 180,
      north_m:   fcsState.north_m      ?? 0,
      east_m:    fcsState.east_m       ?? 0,
    };

    const ctrlCmd = autopilot.update(fcsInput, engineTelemetry.health);
    fcsControls = ctrlCmd;

    // Run 6-DOF dynamics step with new control commands
    const derived = fcs6dof.step(ctrlCmd, engineTelemetry.health);
    fcsState = { ...derived };
    fcsState.health_from_engine = engineTelemetry.health;

    if (++_geoTick % 25 === 0) geofenceGuard(derived);

    // Buffer to DB every 10 FCS ticks (~5 Hz)
    _dbFlushTick++;
    if (_dbFlushTick % 10 === 0) {
      const apDiag = autopilot.getDiagnostics();
      const glideRange = derived.alt_m > 0
        ? autopilot.getGlideRange(derived.alt_m, derived.rho)
        : 0;
      _bufferRow(derived, ctrlCmd, apDiag, { ...interlockOut, glideRange }, Date.now());
    }
    if (_dbFlushTick % 50 === 0) _flushDb();  // flush every ~1 s
  }
}

/** Thrust fraction the 6-DOF model actually applies for the current propulsion health. */
function appliedThrustFactor() {
  const h = typeof fcsState.health_from_engine === 'number' ? fcsState.health_from_engine : 98;
  return 0.5 + 0.5 * Math.max(0, Math.min(1, h / 100));
}

/** Keep Vahak-1 inside the operating area and clear of the border; return to the station orbit if not. */
function geofenceGuard(st) {
  if (st.north_m === undefined) return;
  const c = geofenceCheck({ north_m: st.north_m, east_m: st.east_m, headingDeg: st.heading_deg ?? 0, speedMs: st.tas_ms ?? 56.6 });
  Object.assign(geofence, { borderNm: Number(c.borderNm.toFixed(2)), aheadBorderNm: Number(c.aheadBorderNm.toFixed(2)), inside: c.inside, reasons: c.reasons });
  const emergency = autopilot.emergencyActive || autopilot.mode === 'EMERGENCY_GLIDE';
  const returning = autopilot.mode === FLIGHT_MODE.LOITER && autopilot.sp.loiter_north === 0 && autopilot.sp.loiter_east === 0;
  if (!c.breach) { if (geofence.status !== 'OK' && returning) geofence.status = 'OK'; return; }
  if (emergency) { geofence.status = 'BREACH_EMERGENCY_GLIDE'; return; }   // engine out: the glide to a runway has priority
  if (returning && geofence.status === 'RETURNING') return;               // already heading home
  patrolStation();
  geofence.status = 'RETURNING';
  geofence.interventions++;
  const ev = { ts: Date.now(), reasons: c.reasons, lat: Number(c.lat.toFixed(4)), lon: Number(c.lon.toFixed(4)), borderNm: geofence.borderNm };
  geofence.lastEvent = ev;
  try {
    _insEvent.run(activeSortieId, ev.ts, 'GEOFENCE_RETURN', fcsState.health_from_engine ?? null, st.ias_kts ?? null, st.alt_ft ?? null,
      st.north_m, st.east_m, JSON.stringify({ reasons: c.reasons, lat: ev.lat, lon: ev.lon, borderNm: ev.borderNm }));
  } catch (err) { console.error('[GEOFENCE] event log failed:', err.message); }
  console.warn(`[GEOFENCE] ${c.reasons.join('; ')} -> returning to station orbit`);
  io.emit('geofence_alert', ev);
  io.emit('fcs_mode_changed', { mode: 'LOITER', armed: true });
}

// Broadcast full telemetry packet to connected clients at 20 Hz (50ms) for high-framerate rendering
setInterval(() => {
  const binaryCanFrames = generateBinaryCanFrames();
  
  // Golden-twin nominal model (thermal-lag aware) -> residuals. Uses measured sensors only.
  const nowT = dataTime();
  if (_twinResetPending) { goldenTwin.reset(); _lastTwinSimTime = nowT; _twinResetPending = false; }
  const twinDt = Math.max(0, nowT - _lastTwinSimTime);
  _lastTwinSimTime = nowT;
  const twin = goldenTwin.update(engineState, twinDt);
  const r = twin.residuals;
  const round = (v, d) => parseFloat(v.toFixed(d));

  const residuals = {
    egtResiduals: r.egt.map(v => round(v, 1)),
    chtResiduals: r.cht.map(v => round(v, 1)),
    mapResidual: round(r.map, 3),
    oilPressResidual: round(r.oilPress, 2),
    oilTempResidual: round(r.oilTemp, 1),
    vibrationResidual: round(r.vib, 3),
    genVoltageResidual: round(r.genV, 1),
    batteryCurrentResidual: round(r.batteryA, 1),
    injectionTimeResidualPct: round(r.injPct, 1),
    fuelTrimPct: round(r.fuelTrimPct, 1),
    coolantTempResidual: round(r.coolant, 1),
    maxResidualAbs: Math.max(
      ...r.egt.map(Math.abs),
      ...r.cht.map(v => Math.abs(v) * 2.5),
      Math.abs(r.oilPress) * 40,
      Math.abs(r.vib) * 80
    )
  };

  // Layer-1 threshold health monitor: sensor exceedances only (never reads the injected fault)
  const th = thresholdHealth(engineState, r);
  const healthIndex = th.index;
  let status = th.status; // 'NOMINAL' | 'DEGRADED' | 'CRITICAL' | 'NO_DATA'
  let alertMessage = 'All Rotax 915 iS engine subsystems operating within flight envelope.';
  if (status === 'CRITICAL') {
    alertMessage = `CRITICAL ALERT: Redline exceedance on [${th.exceedances.join(', ')}]. Autonomous RTB protocol recommended.`;
  } else if (status === 'DEGRADED') {
    alertMessage = `CAUTION: Residual exceedance on [${th.exceedances.join(', ')}]. Engine derating recommended.`;
  }
  const srcStatus = sourceStatus();
  if (source.mode === 'LIVE' && !srcStatus.live.connected) {
    // Silence must never look like a healthy engine
    status = 'NO_DATA';
    alertMessage = srcStatus.live.lastFrameAgeMs === null
      ? 'LIVE source selected: waiting for the first engine frame from the test rig / CAN bridge.'
      : `ENGINE DATA LOST: no frame for ${(srcStatus.live.lastFrameAgeMs / 1000).toFixed(1)} s. Values shown are stale.`;
  }
  const truth = scenarioTruth();
  fleet.updateTwins();
  const vahak1 = {
    id: 'Vahak-1', ...VAHAK1_SPEC, engine: `${VAHAK1_SPEC.engine} (S/N: ${VAHAK1_SPEC.serial})`, airborne: true,
    flightHours: VAHAK1_FLIGHT_HOURS, dataSource: source.mode,
    station: { lat: missionState.lat, lon: missionState.lon, altitudeFt: missionState.altitudeFt, airspeedKts: missionState.airspeedKts },
    injectedFault: truth.label, injectedSeverity: truth.severity,
    l1: { index: Number(healthIndex.toFixed(1)), status, exceedances: th.exceedances },
    ai: aiSummary(lastAiResult), subsystems: subsystemsFromAi(lastAiResult),
    status: !lastAiResult ? 'NO AI DATA' : lastAiResult.health?.severity_level === 'CRITICAL' ? 'CRITICAL'
      : lastAiResult.health?.severity_level === 'ELEVATED' ? 'CAUTION' : 'ON STATION',
  };

  missionState.ambientTempC = engineState.oatC;
  missionState.baroPressureBar = engineState.ambientPressureBar;

  // Feed current engine health to FCS health tracker (FADEC derate)
  // Flight model / FADEC derate use propulsion health only (electrical faults do not reduce thrust)
  fcsState.health_from_engine = parseFloat(th.propulsionIndex.toFixed(1));

  // Synchronize missionState with 6-DOF dynamic kinematics
  if (fcsState.alt_ft !== undefined) {
    missionState.altitudeFt = Math.round(fcsState.alt_ft);
    missionState.airspeedKts = parseFloat((fcsState.ias_kts ?? 110).toFixed(1));
    missionState.headingDeg = parseFloat((fcsState.heading_deg ?? 0).toFixed(1));
    missionState.missionPhase = fcsControls.mode ?? missionState.missionPhase;
    missionState.lat = 26.4500 + (fcsState.north_m ?? 0) / 111320;
    missionState.lon = 70.5200 + (fcsState.east_m ?? 0) / (111320 * Math.cos(26.45 * Math.PI / 180));
    missionState.north_m = fcsState.north_m ?? 0;
    missionState.east_m = fcsState.east_m ?? 0;
    missionState.fuel_kg = parseFloat(Math.max(0, 200 - missionState.missionTime * 0.0072).toFixed(1));
    missionState.fuel_remaining_liters = parseFloat((missionState.fuel_kg / 0.72).toFixed(1));
  }

  const payload = {
    timestamp: Date.now(),
    mission: missionState,
    engine: engineState,
    residuals: residuals,
    health: {
      index: parseFloat(healthIndex.toFixed(1)),
      status: status,
      alertMessage: alertMessage,
      exceedances: th.exceedances,
      // Injected simulator scenario / recording label (ground truth for visualisation and
      // evaluation only). Health status above and the AI diagnosis never read these fields.
      activeFault: truth.label,
      severity: truth.severity
    },
    source: srcStatus,
    fleetState: [vahak1, ...fleet.snapshots()],
    canBusFrames: binaryCanFrames,
    // ── FCS data appended to every telemetry frame ──────────
    fcs: {
      // Attitude & kinematics
      roll_deg:     fcsState.roll_deg    ?? 0,
      pitch_deg:    fcsState.pitch_deg   ?? 2.87,
      heading_deg:  fcsState.heading_deg ?? 0,
      ias_kts:      fcsState.ias_kts     ?? 110,
      tas_kts:      fcsState.tas_kts     ?? 110,
      alt_ft:       fcsState.alt_ft      ?? 14500,
      vsi_fpm:      fcsState.vsi_fpm     ?? 0,
      mach:         fcsState.mach        ?? 0.167,
      alpha_deg:    fcsState.alpha_deg   ?? 2.87,
      beta_deg:     fcsState.beta_deg    ?? 0,
      Nz:           fcsState.Nz          ?? 1.0,
      north_m:      fcsState.north_m     ?? 0,
      east_m:       fcsState.east_m      ?? 0,
      // Angular rates
      p_dps:        fcsState.p_dps       ?? 0,
      q_dps:        fcsState.q_dps       ?? 0,
      r_dps:        fcsState.r_dps       ?? 0,
      // Aero
      CL:           fcsState.CL          ?? 0.28,
      CD:           fcsState.CD          ?? 0.02,
      LD:           fcsState.LD          ?? 14.0,
      // Control surfaces
      elevator_deg: fcsState.elevator_deg ?? -2.58,
      aileron_deg:  fcsState.aileron_deg  ?? 0,
      rudder_deg:   fcsState.rudder_deg   ?? 0,
      flap_deg:     fcsState.flap_deg     ?? 0,
      throttle_pct: fcsState.throttle_pct ?? 38,
      speed_brake:  fcsState.speed_brake  ?? false,
      thrust_N:     fcsState.thrust_N     ?? 684,
      // Autopilot
      ap_mode:          fcsControls.mode      ?? 'ALT_HOLD',
      ap_armed:         autopilot.armed,
      alt_sp_ft:        Math.round(autopilot.sp.alt_m * 3.28084),
      ias_sp_kts:       Math.round(autopilot.sp.ias_ms * 1.94384),
      heading_sp_deg:   Math.round(((autopilot.sp.heading_rad * 180 / Math.PI) % 360 + 360) % 360),
      // What is actually APPLIED: the 6-DOF model scales thrust by 0.5 + 0.5 x propulsion health
      // (FlightDynamics6DOF.js). The interlock's own derate table / authority factor are not applied.
      thrust_factor:    appliedThrustFactor(),
      authority_factor: 1.0,
      propulsion_health: typeof fcsState.health_from_engine === 'number' ? fcsState.health_from_engine : null,
      // FADEC interlock
      engine_derate:    interlockOut.annunciators?.ENGINE_OUT ? 'ENGINE OUT'
        : appliedThrustFactor() >= 0.95 ? 'NOMINAL' : `${Math.round(appliedThrustFactor() * 100)}% THRUST`,
      stall_warn:       interlockOut.annunciators?.STALL_WARN     ?? false,
      overspeed_warn:   interlockOut.annunciators?.OVERSPEED      ?? false,
      engine_out:       interlockOut.annunciators?.ENGINE_OUT     ?? false,
      g_limit_active:   interlockOut.annunciators?.G_LIMIT        ?? false,
      fuel_bingo:       interlockOut.annunciators?.FUEL_BINGO     ?? false,
      // TECS diagnostics
      tecs_E:           0,
      tecs_E_sp:        0,
      // Glide range
      glide_range_m: (fcsState.alt_m && fcsState.alt_m > 0)
        ? autopilot.getGlideRange(fcsState.alt_m, fcsState.rho ?? 1.225)
        : 0,
      // Waypoint tracking
      wp_idx:       autopilot.sp?.wp_idx ?? 0,
      total_wps:    autopilot.sp?.waypoints?.length ?? 0,
      target_wp:    autopilot.sp?.waypoints?.[autopilot.sp?.wp_idx] ?? null,
      waypoints:    autopilot.sp?.waypoints ?? [],
      // FCS time
      fcs_time_s:   fcsState.time_s ?? 0,
      // Geofence guard: distance to the border (NM, + = Indian side), operating-area status, interventions
      geofence: { ...geofence, bufferNm: GEOFENCE_RULES.BORDER_BUFFER_NM, lookaheadS: GEOFENCE_RULES.LOOKAHEAD_S },
    },
  };

  io.emit('telemetry_frame', payload);
  // Dedicated FCS channel for lightweight subscribers (PFD, etc.)
  io.emit('fcs_frame', payload.fcs);
}, 50);

// ── Server-side live AI inference (1 Hz) ───────────────────────
// The gateway is the only writer to the live vehicle's AI session, so the model sees one
// 1 Hz stream regardless of how many consoles are open, and clients cannot inject frames.
let lastAiResult = null;
let _aiBusy = false;
// Typical AI latency is ~75 ms (max ~300 ms measured over 1,500 calls); 5 s only catches a hung service.
const AI_TIMEOUT_MS = 5000;
async function aiCall(pathName, body) {
  const t0 = performance.now();
  try {
    const r = await fetch(`${AI_URL}${pathName}`, {
      method: 'POST', headers: AI_HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`AI service HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    console.warn(`[AI] ${pathName} failed after ${Math.round(performance.now() - t0)} ms: ${err.message}`);
    throw err;
  }
}

// SIM / LIVE: score the current engine frame once per second, and record exactly what was scored.
async function scoreLiveFrame() {
  const mode = source.mode, recId = recorder.active?.id;
  const uavId = missionState.uavId;
  if (mode === 'LIVE') {
    const l = source.live;
    if (!l.fresh) return;                 // never re-score the same frame (it would look like a stuck sensor)
    l.fresh = false;
    if (l.lastScoredT !== null && l.lastT - l.lastScoredT > SEGMENT_GAP_S) { _aiResetPending = true; recorder.newSegment(); }
    l.lastScoredT = l.lastT;
  }
  const t = dataTime();
  const frame = frameFromEngineState(engineState);
  const truth = scenarioTruth();
  try {
    if (_aiResetPending) { await aiCall('/api/health-rul/reset', { uav_id: uavId }); _aiResetPending = false; }
    const result = await aiCall('/api/health-rul/predict', aiPayloadFromFrame(frame, { uavId, timeS: t, flightHours: VAHAK1_FLIGHT_HOURS }));
    if (source.mode !== mode || recorder.active?.id !== recId) return;   // source changed while waiting
    const seq = recorder.record(t, frame, { aiInput: true, truthLabel: truth.label, truthSeverity: truth.severity });
    recorder.setLiveResult(seq, result);
    lastAiResult = { ...result, source: { mode } };
    io.emit('ai_prognostics', lastAiResult);
  } catch (err) {
    // The AI session may or may not have consumed this frame: restart it, and mark the recording so
    // a replay restarts its session at the same point.
    _aiResetPending = true;
    recorder.newSegment();
    lastAiResult = null;
    io.emit('ai_status', { available: false, error: err.message });
  }
}

function scoreReplay(r, frame, result) {
  const d = result.health?.diagnosed_fault ?? 'NONE';
  const st = r.stats;
  st.scored++;
  if (frame.truth_label) {
    st.truthN++;
    if (d === frame.truth_label) st.truthAgree++;
    const k = `${frame.truth_label}->${d}`;
    st.confusion[k] = (st.confusion[k] || 0) + 1;
  }
  // Exact-reproduction check: only valid from a recorded session start (not after a mid-segment seek)
  if (r.exact && frame.live_diagnosis) {
    st.liveN++;
    if (d === frame.live_diagnosis) st.liveAgree++;
    else if (!st.firstLiveMismatch) st.firstLiveMismatch = { t_s: frame.t_s, live: frame.live_diagnosis, replay: d };
  }
}

// REPLAY: every recorded AI frame, in order, at its recorded time base, in the REPLAY session.
async function drainReplayAi() {
  const r = source.replay;
  while (source.mode === 'REPLAY' && source.replay === r && r.aiQueue.length) {
    const { frame, newSegment } = r.aiQueue[0];
    const epoch = r.epoch;
    try {
      if (newSegment || r.resetPending) {
        await aiCall('/api/health-rul/reset', { uav_id: REPLAY_UAV });
        r.resetPending = false;
        r.exact = r.segStarts.has(frame.seq);
      }
      const result = await aiCall('/api/health-rul/predict',
        aiPayloadFromFrame(frame, { uavId: REPLAY_UAV, timeS: frame.ai_time_s ?? frame.t_s, flightHours: VAHAK1_FLIGHT_HOURS }));
      if (source.replay !== r || r.epoch !== epoch) return;   // seek / stop while waiting
      r.aiQueue.shift();
      scoreReplay(r, frame, result);
      lastAiResult = { ...result, source: { mode: 'REPLAY', recording_id: r.id, t_s: frame.t_s,
        truth_label: frame.truth_label ?? null, live_diagnosis: frame.live_diagnosis ?? null } };
      io.emit('ai_prognostics', lastAiResult);
    } catch (err) {
      if (source.replay !== r) return;
      r.player.pause();
      r.aiQueue = [];
      r.epoch++;
      r.resetPending = true;
      r.exact = false;
      r.stats.sessionRestarts++;
      r.lastError = `AI service unavailable (${err.message}); replay paused. Resuming restarts the AI session.`;
      io.emit('ai_status', { available: false, error: err.message });
      return;
    }
  }
}

let _aiLastWall = 0;
setInterval(async () => {
  if (_aiBusy) return;
  _aiBusy = true;
  try {
    if (source.mode === 'REPLAY') await drainReplayAi();
    else if (performance.now() - _aiLastWall >= 1000) { _aiLastWall = performance.now(); await scoreLiveFrame(); }
  } finally {
    _aiBusy = false;
  }
}, 50);
setInterval(() => recorder.flush(), 1000);
setInterval(async () => {
  const results = await fleet.scoreAll(aiCall);
  if (results && Object.keys(results).length) io.emit('fleet_ai', results);
}, 1000);

// Socket.io Event Handling
io.on('connection', (socket) => {
  console.log(`[Socket.io] Tactical Client Connected: ${socket.id}`);

  // Send initial state immediately
  socket.emit('initial_state', {
    faultState,
    missionState,
    engineState,
    source: sourceStatus(),
  });
  if (lastAiResult) socket.emit('ai_prognostics', lastAiResult);

  // Inject Fault Handler from Frontend/Judge UI
  socket.on('inject_fault', (data) => {
    const f = parseFault(data);
    if (f.error) { socket.emit('command_rejected', { event: 'inject_fault', error: f.error }); return; }
    if (f.uavId === 'Vahak-1' && source.mode !== 'SIM') { socket.emit('command_rejected', { event: 'inject_fault', error: `fault injection needs the SIM data source (current: ${source.mode})` }); return; }
    console.log(`[Fault Injection] ${f.uavId} -> Fault: ${f.faultType}, Severity: ${f.severity}`);
    applyFault(f);
    if (f.uavId === 'Vahak-1') io.emit('fault_updated', faultState);
  });

  // Clear Fault Handler
  socket.on('clear_fault', (data) => {
    const f = parseFault({ uavId: data?.uavId, faultType: 'NONE' });
    if (f.error || (f.uavId === 'Vahak-1' && source.mode !== 'SIM')) return;
    console.log(`[Fault Injection] ${f.uavId} -> cleared`);
    applyFault(f);
    if (f.uavId === 'Vahak-1') io.emit('fault_updated', faultState);
  });

  // Manual Throttle / Condition Control from Judge Sandbox
  socket.on('update_manual_conditions', (data) => {
    if (source.mode !== 'SIM') return;
    // altitude/airspeed are owned by the 6-DOF model and resynced every broadcast
    if (data?.targetRpm !== undefined) sim.manual.rpm = finiteIn(data.targetRpm, [2000, 5800]);
    if (data?.throttlePct !== undefined) sim.manual.throttle = finiteIn(data.throttlePct, [0, 100]);
  });

  // ── FCS / Autopilot control events ──────────────────────────
  socket.on('fcs_set_mode', (data) => {
    const mode = data?.mode;
    if (Object.values(FLIGHT_MODE).includes(mode)) { autopilot.setMode(mode); console.log(`[FCS] Mode set to: ${mode}`); }
    io.emit('fcs_mode_changed', { mode: autopilot.mode, armed: autopilot.armed });
  });

  socket.on('fcs_arm', () => {
    autopilot.arm();
    io.emit('fcs_mode_changed', { mode: autopilot.mode, armed: true });
  });

  socket.on('fcs_disarm', () => {
    autopilot.disarm();
    io.emit('fcs_mode_changed', { mode: 'MANUAL_FBW', armed: false });
  });

  socket.on('fcs_set_altitude', (data) => {
    const alt_m = finiteIn(data?.alt_ft !== undefined ? Number(data.alt_ft) * 0.3048 : data?.alt_m, LIMITS.alt_m);
    if (alt_m === null) return;
    autopilot.setAltitude(alt_m);
    autopilot.arm();
    if (autopilot.mode === 'MANUAL_FBW') autopilot.setMode('ALT_HOLD');
  });

  socket.on('fcs_set_airspeed', (data) => {
    const ias_ms = finiteIn(data?.ias_kts !== undefined ? Number(data.ias_kts) / 1.94384 : data?.ias_ms, LIMITS.ias_ms);
    if (ias_ms === null) return;
    autopilot.setAirspeed(ias_ms);
    autopilot.arm();
  });

  socket.on('fcs_set_heading', (data) => {
    const hdg = finiteIn(data?.heading_deg !== undefined ? Number(data.heading_deg) * Math.PI / 180 : data?.heading_rad, LIMITS.heading);
    if (hdg === null) return;
    autopilot.setHeading(hdg);
    autopilot.arm();
    if (autopilot.mode === 'AUTO_MISSION' || autopilot.mode === 'MANUAL_FBW') {
      autopilot.setMode('ALT_HOLD');
      io.emit('fcs_mode_changed', { mode: 'ALT_HOLD', armed: true });
    }
  });

  socket.on('fcs_load_waypoints', (data) => {
    if (validWaypoints(data?.waypoints)) {
      const route = validateRoute(fcsState.north_m ?? 0, fcsState.east_m ?? 0, data.waypoints);
      if (!route.ok) { socket.emit('command_rejected', { event: 'fcs_load_waypoints', error: `geofence: ${route.reason}` }); return; }
      autopilot.loadWaypoints(data.waypoints);
      autopilot.arm();
      autopilot.setMode('AUTO_MISSION');
      console.log(`[FCS] Loaded ${data.waypoints.length} waypoints and activated AUTO_MISSION`);
      io.emit('fcs_mode_changed', { mode: 'AUTO_MISSION', armed: true });
    }
  });

  socket.on('fcs_set_loiter', (data) => {
    const n = finiteIn(data?.north ?? 0, [-1e6, 1e6]), e = finiteIn(data?.east ?? 0, [-1e6, 1e6]);
    const r = finiteIn(data?.radius_m ?? 2000, [200, 50000]);
    if (n === null || e === null || r === null) return;
    autopilot.setLoiter(n, e, r, data?.cw ?? true);
  });

  socket.on('fcs_fbw_input', (data) => {
    const v = [data?.roll ?? 0, data?.pitch ?? 0, data?.yaw ?? 0, data?.throttle ?? 0.38].map(x => finiteIn(x, [-1, 1]));
    if (v.includes(null)) return;
    autopilot.setFBW(...v);
  });

  socket.on('fcs_reset', () => {
    resetSimulationState();
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client Disconnected: ${socket.id}`);
  });
});

// ── Service info ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ONLINE', service: 'GarudaTwin Telemetry & CAN Bus Gateway Server' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ONLINE', uptimeSeconds: Math.round(process.uptime()) });
});

// ── Fault injection ───────────────────────────────────────────
// Vahak-1 faults need the SIM data source; fleet vehicles always run their own simulators
const requireSim = (req, res, next) => (req.body?.uavId ?? 'Vahak-1') !== 'Vahak-1' || source.mode === 'SIM' ? next()
  : res.status(409).json({ error: `fault injection needs the SIM data source (current: ${source.mode})` });
app.post('/api/faults/inject', requireSim, (req, res) => {
  const f = parseFault(req.body);
  if (f.error) { res.status(400).json({ error: f.error }); return; }
  const target = applyFault(f);
  if (f.uavId === 'Vahak-1') io.emit('fault_updated', faultState);
  res.json({ success: true, uavId: f.uavId, faultState: target });
});

app.post('/api/faults/clear', requireSim, (req, res) => {
  const f = parseFault({ uavId: req.body?.uavId, faultType: 'NONE' });
  if (f.error) { res.status(400).json({ error: f.error }); return; }
  const target = applyFault(f);
  if (f.uavId === 'Vahak-1') io.emit('fault_updated', faultState);
  res.json({ success: true, uavId: f.uavId, faultState: target });
});

// ── Engine data source, flight recordings, replay, live ingest ──
app.get('/api/source', (req, res) => res.json(sourceStatus()));
app.post('/api/source', (req, res) => {
  const mode = req.body?.mode;
  if (mode !== 'SIM' && mode !== 'LIVE') {
    res.status(400).json({ error: "mode must be 'SIM' or 'LIVE' (load a recording with /api/replay/load for REPLAY)" });
    return;
  }
  setSourceMode(mode);
  res.json(sourceStatus());
});

app.get('/api/recordings', (req, res) => { recorder.flush(); res.json(recorder.list()); });
app.get('/api/recordings/:id/export.csv', (req, res) => {
  const id = Number(req.params.id);
  if (!recorder.meta(id)) { res.status(404).json({ error: 'recording not found' }); return; }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="garudatwin_recording_${id}.csv"`);
  res.send(recorder.exportCsv(id));
});
app.post('/api/recordings/import', express.text({ type: ['text/csv', 'text/plain'], limit: '25mb' }), (req, res) => {
  if (typeof req.body !== 'string' || !req.body.length) {
    res.status(400).json({ error: 'send the CSV file as the request body with Content-Type: text/csv' });
    return;
  }
  const out = recorder.importCsv(req.body, String(req.query.name || 'Imported CSV').slice(0, 120));
  res.status(out.error ? 400 : 200).json(out);
});
app.post('/api/recordings/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (!recorder.meta(id)) { res.status(404).json({ error: 'recording not found' }); return; }
  if (recorder.active?.id === id) { res.status(409).json({ error: 'recording in progress' }); return; }
  if (source.replay?.id === id) { res.status(409).json({ error: 'recording is being replayed' }); return; }
  recorder.delete(id);
  res.json({ success: true });
});

app.post('/api/replay/load', (req, res) => {
  const id = Number(req.body?.id);
  if (!recorder.meta(id)) { res.status(404).json({ error: 'recording not found' }); return; }
  if (source.mode !== 'REPLAY') recorder.stop();         // finish the current recording first
  const meta = recorder.meta(id);
  if (meta && (meta.schema_version ?? 1) < 2) {
    res.status(409).json({ error: 'recorded before the engine model gained injection, battery and air-data channels; not replayable with the current models (export it as CSV for reference)' });
    return;
  }
  const frames = meta ? recorder.frames(id) : [];
  if (frames.filter(f => f.ai_input).length < 2) { res.status(400).json({ error: 'recording has fewer than 2 AI frames' }); return; }
  setSourceMode('REPLAY', { id, name: meta.name, player: new ReplayPlayer(frames), hasTruth: !!meta.has_truth });
  res.json(sourceStatus());
});
app.post('/api/replay/control', (req, res) => {
  if (source.mode !== 'REPLAY') { res.status(409).json({ error: 'no replay loaded' }); return; }
  const r = source.replay;
  const { action, value } = req.body || {};
  if (action === 'play') {
    if (r.player.ended) { replaySeek(r, 0); r.stats = newReplayStats(); }
    r.lastError = null;
    r.player.play();
  } else if (action === 'pause') {
    r.player.pause();
  } else if (action === 'speed') {
    if (!SPEEDS.includes(Number(value))) { res.status(400).json({ error: `speed must be one of ${SPEEDS.join(', ')}` }); return; }
    r.player.setSpeed(Number(value));
  } else if (action === 'seek') {
    const t = finiteIn(value, [0, r.player.endT]);
    if (t === null) { res.status(400).json({ error: 'seek value must be a number of seconds' }); return; }
    replaySeek(r, t);
  } else {
    res.status(400).json({ error: "action must be 'play', 'pause', 'speed' or 'seek'" });
    return;
  }
  res.json(sourceStatus());
});

function ingestKeyOk(given) {
  if (typeof given !== 'string' || !SERVICE.ingestKey) return false;
  const a = Buffer.from(given), b = Buffer.from(SERVICE.ingestKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Live engine data from a test rig or CAN bridge: {"frames": [{t_s?, rpm, throttle, egt1..4, ...}, ...]}
app.post('/api/ingest/frames', (req, res) => {
  if (!ingestKeyOk(req.get('x-ingest-key'))) { res.status(401).json({ error: 'invalid or missing X-Ingest-Key' }); return; }
  if (source.mode !== 'LIVE') { res.status(409).json({ error: 'data source is not LIVE: POST /api/source {"mode":"LIVE"} first' }); return; }
  const list = Array.isArray(req.body?.frames) ? req.body.frames : null;
  if (!list || !list.length) { res.status(400).json({ error: 'body must be {"frames": [ ... ]}' }); return; }
  if (list.length > 50) { res.status(413).json({ error: 'at most 50 frames per request' }); return; }
  const l = source.live;
  let accepted = 0;
  const errors = [];
  for (const raw of list) {
    const { frame, error } = normalizeFrame(raw);
    const t = raw?.t_s === undefined ? (Date.now() - l.startWall) / 1000 : Number(raw.t_s);
    const err = error
      ?? (!Number.isFinite(t) ? 't_s must be a number (seconds)'
        : (l.lastT !== null && t <= l.lastT) ? `t_s ${t} is not after the previous frame (${l.lastT})` : null);
    if (err) { errors.push(err); continue; }
    applyFrameToEngineState(frame, engineState);
    recorder.record(t, frame);
    l.lastT = t;
    l.fresh = true;
    accepted++;
  }
  l.frames += accepted;
  l.rejected += errors.length;
  if (errors.length) l.lastError = errors[errors.length - 1];
  if (accepted) l.lastFrameWall = Date.now();
  res.status(accepted ? 200 : 400).json({ accepted, rejected: errors.length, errors: errors.slice(0, 5) });
});

// ── AI Health & RUL proxy ─────────────────────────────────────
// Client-initiated predictions (e.g. the Judges Sandbox) always run in the sandbox session;
// only the gateway's own 1 Hz loop writes to the live vehicle's session.
async function proxyAi(req, res, aiPath) {
  try {
    // What-if requests are independent single-frame assessments (fresh session, no persistence)
    const body = { ...(req.body || {}), uav_id: 'SANDBOX', one_shot: true };
    const aiRes = await fetch(`${AI_URL}${aiPath}`, {
      method: 'POST', headers: AI_HEADERS, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    res.status(aiRes.status).json(await aiRes.json());
  } catch (error) {
    res.status(503).json({ error: 'AI Health & RUL microservice unavailable' });
  }
}
app.post('/api/health-rul/predict', (req, res) => proxyAi(req, res, '/api/health-rul/predict'));
app.post('/api/health-rul/detect-anomaly', (req, res) => proxyAi(req, res, '/api/health-rul/detect-anomaly'));
app.post('/api/health-rul/predict-rul', (req, res) => proxyAi(req, res, '/api/health-rul/predict-rul'));

app.post('/api/rl-replan', async (req, res) => {
  try {
    const aiRes = await fetch(`${AI_URL}/rl-replan`, {
      method: 'POST',
      headers: AI_HEADERS,
      body: JSON.stringify(req.body || {})
    });
    if (!aiRes.ok) throw new Error(`Python AI returned HTTP ${aiRes.status}`);
    const data = await aiRes.json();
    return res.json(data);
  } catch (error) {
    // AI service unreachable: same rule-based planner, computed here (shared rules: src/planner/rtbRules.js)
    const {
      uav_id = "Vahak-1",
      current_lat = 26.4500,
      current_lng = 70.5200,
      altitude_ft = 14500.0,
      fuel_remaining_liters = null,
      engine_health_index = null,
      rul_hours = null,
      diagnosed_fault = 'NONE',
      ai_online = true,
      l1_status = null,
      current_throttle_pct = null,
      current_rpm = null,
      current_airspeed_kts = null,
      target_field_id = null,
      mode = "AUTO_EVENT"
    } = req.body || {};

    const airfields = [
      { id: "AFS_UTTARLAI", name: "AFS Uttarlai (Barmer)", short_name: "AFS Uttarlai", lat: 25.8117, lng: 71.4883, alt_ft: 500, type: "PRIMARY" },
      { id: "AFS_JAISALMER", name: "AFS Jaisalmer Forward Base", short_name: "AFS Jaisalmer", lat: 26.8897, lng: 70.8653, alt_ft: 825, type: "DIVERT" },
      { id: "POKHRAN_ALG", name: "Pokhran Advanced Landing Ground (Emergency Strip 09)", short_name: "Pokhran ALG", lat: 26.9200, lng: 71.7500, alt_ft: 720, type: "EMERGENCY_GLIDE" }
    ];

    const toRad = deg => (deg * Math.PI) / 180;
    const calcDistNm = (lat1, lon1, lat2, lon2) => {
      const R = 3440.065;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const candidates = airfields.map(f => ({
      ...f,
      dist_nm: Number(calcDistNm(current_lat, current_lng, f.lat, f.lng).toFixed(1))
    })).sort((a, b) => a.dist_nm - b.dist_nm);

    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const { status, reasons } = classifyVehicle({ health: num(engine_health_index), rul: num(rul_hours),
      fault: diagnosed_fault || 'NONE', fuel: num(fuel_remaining_liters), aiOk: ai_online !== false, l1: l1_status });
    const action = rtbAction(status, mode);
    const profile = RTB_PROFILES[action];
    const requiresDivert = action === 'EMERGENCY_DIVERT_RTB';
    const isPreview = action === 'CONTINGENCY_RTB_PREVIEW';

    let targetDest = null;
    if (target_field_id && target_field_id !== "AUTO") {
      targetDest = candidates.find(f => f.id === target_field_id) || candidates[0];
    } else if (profile.field === 'NEAREST') {
      targetDest = candidates[0];
    } else {
      targetDest = candidates.find(f => f.id === "AFS_UTTARLAI") || candidates[0];
    }
    const targetDist = targetDest.dist_nm;
    const recThrottle = profile.throttle ?? num(current_throttle_pct) ?? 78.0;
    const recRpm = profile.rpm ?? num(current_rpm) ?? 4850;
    const recClimbFpm = profile.climbFpm;
    const speedKts = profile.speedKts ?? num(current_airspeed_kts) ?? 115.0;

    const flightTimeMin = Math.max(0.1, (targetDist / speedKts) * 60.0);
    const flightTimeHrs = flightTimeMin / 60.0;
    const safetyMargin = num(rul_hours) == null ? null : Number((Math.max(0, rul_hours) / Math.max(0.01, flightTimeHrs)).toFixed(2));

    const waypoints = [];
    const numWp = 4;
    const wpNames = ["CURRENT_POS", "GLIDE_INTERCEPT", "DESCENT_MID", "APPROACH_GATE", "TOUCHDOWN"];
    for (let i = 0; i <= numWp; i++) {
      const frac = i / numWp;
      waypoints.push({
        wp_id: `RTB-${i + 1}`,
        name: (requiresDivert || isPreview) ? wpNames[i] : `WP-${i + 1}`,
        lat: Number((current_lat + frac * (targetDest.lat - current_lat)).toFixed(4)),
        lng: Number((current_lng + frac * (targetDest.lng - current_lng)).toFixed(4)),
        altitude_ft: Math.round(altitude_ft - frac * (altitude_ft - targetDest.alt_ft)),
        commanded_airspeed_kts: i === numWp ? 72.0 : speedKts,
        dist_remaining_nm: Number((targetDist * (1.0 - frac)).toFixed(1)),
        eta_min: Number((flightTimeMin * frac).toFixed(1))
      });
    }

    return res.json({
      uav_id: uav_id,
      action: action,
      status,
      reasons,
      source: 'gateway-fallback',
      target_recovery_field: targetDest.name,
      target_field_id: targetDest.id,
      distance_to_field_nm: targetDist,
      estimated_flight_time_minutes: Number(flightTimeMin.toFixed(1)),
      rul_safety_margin_factor: safetyMargin,
      rl_control_commands: {
        recommended_throttle_pct: recThrottle,
        recommended_rpm: recRpm,
        recommended_vertical_speed_fpm: recClimbFpm,
        fuel_flow_target_lph: recThrottle < 65 ? 18.5 : (recThrottle < 75 ? 22.0 : 25.0),
        commanded_airspeed_kts: speedKts
      },
      optimized_rtb_flight_plan: waypoints,
      all_candidate_fields: candidates
    });
  }
});

// ══════════════════════════════════════════════════════════════
// DATABASE REST ENDPOINTS
// ══════════════════════════════════════════════════════════════

// GET /api/database/sorties  — list all flight sorties
app.get('/api/database/sorties', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM sorties ORDER BY start_time DESC LIMIT 50').all();
    res.json({ success: true, sorties: rows, active_sortie_id: activeSortieId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/fcs/:sortie_id?limit=200  — FCS telemetry for a sortie
app.get('/api/database/fcs/:sortie_id', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
    const rows = db.prepare(
      'SELECT * FROM fcs_telemetry WHERE sortie_id=? ORDER BY ts DESC LIMIT ?'
    ).all(req.params.sortie_id, limit);
    res.json({ success: true, count: rows.length, data: rows.reverse() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/surfaces/:sortie_id  — control surfaces history
app.get('/api/database/surfaces/:sortie_id', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 2000);
    const rows = db.prepare(
      'SELECT * FROM control_surfaces WHERE sortie_id=? ORDER BY ts DESC LIMIT ?'
    ).all(req.params.sortie_id, limit);
    res.json({ success: true, count: rows.length, data: rows.reverse() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/emergency/:sortie_id  — emergency events
app.get('/api/database/emergency/:sortie_id', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM emergency_events WHERE sortie_id=? ORDER BY ts ASC'
    ).all(req.params.sortie_id);
    res.json({ success: true, count: rows.length, events: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/export/csv/:sortie_id  — export FCS telemetry as CSV
app.get('/api/database/export/csv/:sortie_id', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM fcs_telemetry WHERE sortie_id=? ORDER BY ts ASC'
    ).all(req.params.sortie_id);
    if (!rows.length) { res.status(404).json({ error: 'No data for sortie' }); return; }
    const headers = Object.keys(rows[0]).join(',');
    const lines   = rows.map(r => Object.values(r).join(','));
    const csv     = [headers, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sortie_${req.params.sortie_id}_fcs.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/database/stats  — database statistics
app.get('/api/database/stats', (req, res) => {
  try {
    const stats = {
      sorties:    db.prepare('SELECT COUNT(*) as n FROM sorties').get().n,
      fcs_rows:   db.prepare('SELECT COUNT(*) as n FROM fcs_telemetry').get().n,
      surf_rows:  db.prepare('SELECT COUNT(*) as n FROM control_surfaces').get().n,
      events:     db.prepare('SELECT COUNT(*) as n FROM emergency_events').get().n,
      active_sortie: activeSortieId,
      db_file: path.join(DB_DIR, 'garudatwin.db'),
    };
    res.json({ success: true, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Autopilot REST control (for judge sandbox/external control) ──

// POST /api/fcs/mode  — set autopilot mode
app.post('/api/fcs/mode', (req, res) => {
  const { mode } = req.body;
  if (!Object.values(FLIGHT_MODE).includes(mode)) {
    res.status(400).json({ error: `mode must be one of ${Object.values(FLIGHT_MODE).join(', ')}` }); return;
  }
  autopilot.setMode(mode);
  res.json({ success: true, mode: autopilot.mode });
});

// POST /api/fcs/arm  — arm autopilot
app.post('/api/fcs/arm', (req, res) => {
  autopilot.arm();
  io.emit('fcs_mode_changed', { mode: autopilot.mode, armed: true });
  res.json({ success: true, armed: true, mode: autopilot.mode });
});

// POST /api/fcs/disarm  — disarm autopilot to manual FBW
app.post('/api/fcs/disarm', (req, res) => {
  autopilot.disarm();
  io.emit('fcs_mode_changed', { mode: 'MANUAL_FBW', armed: false });
  res.json({ success: true, armed: false, mode: 'MANUAL_FBW' });
});

// POST /api/fcs/altitude  — set altitude setpoint (ft or m)
app.post('/api/fcs/altitude', (req, res) => {
  const { alt_ft, alt_m } = req.body;
  const target = finiteIn(alt_ft !== undefined ? Number(alt_ft) * 0.3048 : alt_m, LIMITS.alt_m);
  if (target === null) { res.status(400).json({ error: 'numeric alt_ft or alt_m required' }); return; }
  autopilot.setAltitude(target);
  autopilot.arm();
  if (autopilot.mode === 'MANUAL_FBW') autopilot.setMode('ALT_HOLD');
  res.json({ success: true, alt_m: autopilot.sp.alt_m, alt_ft: autopilot.sp.alt_m * 3.28084 });
});

// POST /api/fcs/airspeed  — set airspeed setpoint (kts or m/s)
app.post('/api/fcs/airspeed', (req, res) => {
  const { ias_kts, ias_ms } = req.body;
  const target = finiteIn(ias_kts !== undefined ? Number(ias_kts) / 1.94384 : ias_ms, LIMITS.ias_ms);
  if (target === null) { res.status(400).json({ error: 'numeric ias_kts or ias_ms required' }); return; }
  autopilot.setAirspeed(target);
  autopilot.arm();
  res.json({ success: true, ias_ms: autopilot.sp.ias_ms, ias_kts: autopilot.sp.ias_ms * 1.94384 });
});

// POST /api/fcs/heading  — set heading setpoint (deg or rad)
app.post('/api/fcs/heading', (req, res) => {
  const { heading_deg, heading_rad } = req.body;
  const target = finiteIn(heading_deg !== undefined ? Number(heading_deg) * Math.PI / 180 : heading_rad, LIMITS.heading);
  if (target === null) { res.status(400).json({ error: 'numeric heading_deg or heading_rad required' }); return; }
  autopilot.setHeading(target);
  autopilot.arm();
  if (autopilot.mode === 'AUTO_MISSION' || autopilot.mode === 'MANUAL_FBW') {
    autopilot.setMode('ALT_HOLD');
    io.emit('fcs_mode_changed', { mode: 'ALT_HOLD', armed: true });
  }
  const hdgDeg = Math.round(((autopilot.sp.heading_rad * 180 / Math.PI) % 360 + 360) % 360);
  res.json({ success: true, heading_deg: hdgDeg, heading_rad: autopilot.sp.heading_rad });
});

// POST /api/fcs/waypoints  — load mission waypoints
app.post('/api/fcs/waypoints', (req, res) => {
  const { waypoints } = req.body;
  if (!validWaypoints(waypoints)) { res.status(400).json({ error: 'waypoints must be 1-200 {north, east, alt_m?} numeric objects' }); return; }
  const route = validateRoute(fcsState.north_m ?? 0, fcsState.east_m ?? 0, waypoints);
  if (!route.ok) { res.status(409).json({ error: `geofence: ${route.reason}` }); return; }
  autopilot.loadWaypoints(waypoints);
  autopilot.arm();
  autopilot.setMode('AUTO_MISSION');
  io.emit('fcs_mode_changed', { mode: 'AUTO_MISSION', armed: true });
  res.json({ success: true, count: waypoints.length, mode: 'AUTO_MISSION' });
});

// GET /api/fcs/status  — live autopilot diagnostic snapshot
app.get('/api/fcs/status', (req, res) => {
  res.json({
    success: true,
    autopilot: autopilot.getDiagnostics(),
    fcs_state: fcsState,
    interlock: interlockOut,
    controls: fcsControls,
    sortie_id: activeSortieId,
  });
});

// GET /api/fcs/trim  — compute trim for given conditions
app.get('/api/fcs/trim', (req, res) => {
  const alt_m   = parseFloat(req.query.alt_ft ?? 14500) * 0.3048;
  const ias_kts = parseFloat(req.query.ias_kts ?? 110);
  try {
    const trim = FlightDynamics6DOF.computeTrim(alt_m, ias_kts);
    res.json({ success: true, trim });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fcs/reset  — reset FCS to trimmed level flight cruise
app.post('/api/fcs/reset', (req, res) => {
  try {
    resetSimulationState();
    res.json({ success: true, message: 'FCS reset to nominal cruise', active_sortie_id: activeSortieId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fcs/emergency-glide  — trigger emergency glide protocol
app.post('/api/fcs/emergency-glide', (req, res) => {
  try {
    autopilot.triggerEmergency(fcsState.north_m ?? 0, fcsState.east_m ?? 0, fcsState.alt_m ?? 4419.6, null);
    res.json({ success: true, mode: autopilot.mode });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// JSON errors only (e.g. malformed request body) — never an HTML stack trace
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.type === 'entity.parse.failed' ? 'invalid JSON body' : (status < 500 ? err.message : 'server error') });
});

startRecording('SIM');
const _shutdown = () => { try { recorder.stop(); _flushDb(); } finally { process.exit(0); } };
process.on('SIGINT', _shutdown);
process.on('SIGTERM', _shutdown);

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`🚀 MALE UAV Digital Twin Telemetry Engine Running on ${HOST}:${PORT}`);
  console.log(`🌐 Allowed browser origins: ${[...SERVICE.allowedOrigins].join(', ')}`);
  console.log(`📡 CAN frame encoder active (IDs 0x100-0x330; layout tools/can/garudatwin_engine.dbc)`);
  console.log(`✈️  50 Hz 6-DOF Flight Controller Active (TECS + L1 + Cascaded PID)`);
  console.log(`🗄️  SQLite Database: data/garudatwin.db (Sortie #${activeSortieId})`);
  console.log(`=======================================================`);
});
