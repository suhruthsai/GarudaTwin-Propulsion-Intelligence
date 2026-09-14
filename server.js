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

// SQLite (CommonJS via createRequire)
const _require = createRequire(import.meta.url);
const Database  = _require('better-sqlite3');

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Database initialisation ───────────────────────────────────
const DB_DIR = path.join(__dirname, 'data');
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
`);

// Create opening sortie record
const _stmtOpenSortie = db.prepare(`INSERT INTO sorties (uav_id, start_time, initial_alt) VALUES (?,?,?)`);
const activeSortieId  = _stmtOpenSortie.run('Vahak-1', Date.now(), 4419.6).lastInsertRowid;

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

autopilot.arm();
autopilot.setMode(FLIGHT_MODE.ALT_HOLD);
autopilot.setAltitude(4419.6);    // 14500 ft in metres
autopilot.setAirspeed(56.6);      // 110 kts in m/s

// Shared FCS state (written by FCS tick, read by broadcast)
let fcsState    = {};
let fcsControls = { throttle:0.38, de:-0.045, da:0, dr:0, df:0, sb:false, mode:'ALT_HOLD' };
let interlockOut = {};
let _fcsTick    = 0;
let _dbFlushTick = 0;

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5002;

// System Global State
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
  ambientTempC: -12.5,
  baroPressureBar: 0.58,
  uavId: 'Vahak-1',
  missionPhase: 'LOITER' // 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'LOITER' | 'RTB' | 'DESCENT'
};

let fleetState = [
  {
    id: 'Vahak-2',
    callsign: 'Vahak-2 (ESCORT LEAD)',
    engine: 'Rotax 915 iS (S/N: RTX-0819)',
    status: 'ON STATION',
    health: 96.2,
    rulHours: 785.0,
    flightHours: 415.0,
    tboDueHours: 785.0,
    subsystems: { combustion: 98, lubrication: 95, induction: 97, cooling: 96, vibration: 95 }
  },
  {
    id: 'Vahak-3',
    callsign: 'Vahak-3 (RELAY ORBIT)',
    engine: 'Rotax 916 iS (S/N: RTX-0902)',
    status: 'CLIMB TO CRUISE',
    health: 99.1,
    rulHours: 1120.0,
    flightHours: 80.0,
    tboDueHours: 1120.0,
    subsystems: { combustion: 100, lubrication: 99, induction: 98, cooling: 99, vibration: 100 }
  },
  {
    id: 'Vahak-4',
    callsign: 'Vahak-4 (PERIMETER PATROL)',
    engine: 'Rotax 915 iS (S/N: RTX-0754)',
    status: 'DERATED CRUISE',
    health: 84.5,
    rulHours: 420.0,
    flightHours: 780.0,
    tboDueHours: 420.0,
    subsystems: { combustion: 88, lubrication: 82, induction: 85, cooling: 86, vibration: 80 }
  },
  {
    id: 'Vahak-5',
    callsign: 'Vahak-5 (HANGAR RESERVE)',
    engine: 'Rotax 915 iS (S/N: RTX-0699)',
    status: 'GROUND MAINTENANCE',
    health: 72.0,
    rulHours: 120.0,
    flightHours: 1080.0,
    tboDueHours: 120.0,
    subsystems: { combustion: 74, lubrication: 70, induction: 78, cooling: 65, vibration: 68 }
  }
];

// Physics Baseline & Engine State Variables
let engineState = {
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
  wastegateDutyPct: 62.0,
  genVoltageV: 28.4,
  genCurrentA: 45.2,
  coolantTempC: 88.5
};

/**
 * Packs sensor values into simulated CAN 2.0B Binary Frame Buffers
 * CAN ID 0x100 (8 bytes): RPM (uint16), Throttle (uint16 * 100), FuelFlow (uint16 * 100), Lambda (uint16 * 1000)
 * CAN ID 0x200 (8 bytes): EGT1 (uint16), EGT2 (uint16), EGT3 (uint16), EGT4 (uint16)
 * CAN ID 0x210 (8 bytes): CHT1 (uint16), CHT2 (uint16), CHT3 (uint16), CHT4 (uint16)
 * CAN ID 0x300 (8 bytes): MAP (uint16 * 1000), OilPress (uint16 * 1000), OilTemp (uint16 * 10), Vibration (uint16 * 1000)
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

  return [
    { canId: '0x100', dlc: 8, rawHex: buf0x100.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x200', dlc: 8, rawHex: buf0x200.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x210', dlc: 8, rawHex: buf0x210.toString('hex').toUpperCase(), timestamp: Date.now() },
    { canId: '0x300', dlc: 8, rawHex: buf0x300.toString('hex').toUpperCase(), timestamp: Date.now() }
  ];
}

/**
 * Box-Muller transform for explicit Gaussian measurement noise (Physics-Grounded)
 */
function generateGaussianNoise(mean = 0, stdDev = 1) {
  let u1 = 1 - Math.random();
  let u2 = 1 - Math.random();
  let z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

/**
 * 100 Hz Physics Simulation Step
 * Incorporates dynamic physics baseline + stochastic micro-fluctuations + fault dynamics
 */
let thermalState = {
  egt: 840.0,
  cht: 106.0,
  oilTemp: 98.0
};

function updatePhysicsStep(dt = 0.01) {
  missionState.missionTime += dt;

  // Base flight profile micro-drift using Physics-Grounded Gaussian Noise
  const time = missionState.missionTime;
  const rpmNoise = generateGaussianNoise(0, 4.0);
  const mapNoise = generateGaussianNoise(0, 0.005);
  const vibNoise = generateGaussianNoise(0, 0.008);

  // Baseline target RPM & Throttle for LOITER profile
  let targetRpm = 4800 + Math.sin(time * 0.1) * 60;
  let targetThrottle = 78.5 + Math.sin(time * 0.1) * 1.5;
  let targetMap = 1.42 + (targetThrottle - 78.5) * 0.015;

  // Physics-Grounded Thermal Inertia (ODE: dT/dt = k * (T_target - T_current))
  let targetEgt = 840 + (targetThrottle - 78.5) * 1.8 + (targetRpm - 4800) * 0.03;
  let targetCht = 106 + (targetThrottle - 78.5) * 0.6;
  let targetOilTemp = 98.0 + (targetThrottle - 78.5) * 0.25;

  thermalState.egt += 0.8 * (targetEgt - thermalState.egt) * dt; // Fast response (gas)
  thermalState.cht += 0.05 * (targetCht - thermalState.cht) * dt; // Slow response (metal mass)
  thermalState.oilTemp += 0.02 * (targetOilTemp - thermalState.oilTemp) * dt; // Very slow response (fluid mass)

  let baseEgt = thermalState.egt;
  let baseCht = thermalState.cht;
  let baseOilTemp = thermalState.oilTemp;
  let baseOilPress = 3.85 - (baseOilTemp - 98.0) * 0.015;
  let baseVib = 0.28 + ((targetRpm - 4800) / 5800) * 0.12;

  // Apply Fault State Dynamics
  let egtOffsets = [0, 0, 0, 0];
  let chtOffsets = [0, 0, 0, 0];
  let mapOffset = 0;
  let oilPressOffset = 0;
  let oilTempOffset = 0;
  let vibOffset = 0;
  let fuelFlowOffset = 0;
  let lambdaOffset = 0;
  let genVoltsOffset = 0;
  let genAmpsOffset = 0;
  let coolantOffset = 0;

  if (faultState.activeFault !== 'NONE') {
    const sev = faultState.severity;
    
    switch (faultState.activeFault) {
      case 'CYL3_INJECTOR':
        // Cylinder 3 partial clog -> severe lean burn spike in Cyl 3 EGT, moderate CHT rise, torsional vibration
        egtOffsets[2] = 135.0 * sev + Math.sin(time * 8.0) * 12 * sev; // Exceeds 970°C
        chtOffsets[2] = 28.0 * sev;                                    // Exceeds 135°C
        egtOffsets[0] = -10.0 * sev;
        egtOffsets[1] = -8.0 * sev;
        egtOffsets[3] = -9.0 * sev;
        vibOffset = 0.95 * sev + generateGaussianNoise(0, 0.1 * sev); // Jumps to >1.2g
        lambdaOffset = 0.18 * sev; // Lean shift
        break;

      case 'BLOW_BY':
        // Piston ring blow-by -> crankcase pressurization, hot blowby gases bake oil, oil pressure decay
        oilTempOffset = 32.0 * sev + Math.sin(time * 0.5) * 4 * sev; // Exceeds 130°C
        oilPressOffset = -1.65 * sev;                                 // Drops to ~2.2 bar
        chtOffsets[1] = 18.0 * sev;
        chtOffsets[2] = 22.0 * sev;
        vibOffset = 0.65 * sev;
        break;

      case 'OIL_PUMP_CAVITATION':
        // Oil aeration / relief valve chatter -> wild pressure oscillations, sharp loss of hydrodynamic wedge
        oilPressOffset = -2.3 * sev + (Math.sin(time * 15.0) * 0.75 * sev); // Drops to <1.5 bar
        oilTempOffset = 25.0 * sev;
        vibOffset = 1.35 * sev + generateGaussianNoise(0, 0.2 * sev);                // Bearing distress >1.6g
        break;

      case 'TURBO_WASTEGATE_STUCK':
        // Wastegate stuck closed -> overboost surge or stuck open -> manifold pressure drop
        mapOffset = 0.58 * sev + Math.sin(time * 3.0) * 0.08 * sev; // MAP jumps to ~2.0 bar
        egtOffsets = [45 * sev, 42 * sev, 48 * sev, 44 * sev];
        targetRpm += 350 * sev;
        vibOffset = 0.5 * sev;
        break;

      case 'COOLING_DEGRADATION':
        chtOffsets = [32 * sev, 35 * sev, 34 * sev, 36 * sev];
        oilTempOffset = 18.0 * sev;
        coolantOffset = 35.0 * sev; // Radiator boils over
        break;

      case 'GENERATOR_FAILURE':
        genVoltsOffset = -4.9 * sev; // Drops to ~23.5V (battery)
        genAmpsOffset = -33.2 * sev; // Load shed
        break;

      case 'PRGB_DEGRADATION':
        // Gear tooth wear / clutch slip -> severe vibration
        vibOffset = 2.15 * sev + generateGaussianNoise(0, 0.15); 
        break;
    }
  }

  // Smooth State Transition & Integration using Gaussian Noise
  engineState.rpm = Math.max(2000, Math.min(5800, targetRpm + rpmNoise));
  engineState.throttlePct = Math.max(0, Math.min(100, targetThrottle + generateGaussianNoise(0, 0.1)));
  engineState.mapBar = parseFloat(Math.max(0.6, Math.min(2.4, targetMap + mapOffset + mapNoise)).toFixed(3));
  
  engineState.egt = [
    parseFloat((baseEgt + egtOffsets[0] + generateGaussianNoise(0, 1.2)).toFixed(1)),
    parseFloat((baseEgt + egtOffsets[1] + generateGaussianNoise(0, 1.2)).toFixed(1)),
    parseFloat((baseEgt + egtOffsets[2] + generateGaussianNoise(0, 1.5)).toFixed(1)),
    parseFloat((baseEgt + egtOffsets[3] + generateGaussianNoise(0, 1.2)).toFixed(1)),
  ];

  engineState.cht = [
    parseFloat((baseCht + chtOffsets[0] + generateGaussianNoise(0, 0.3)).toFixed(1)),
    parseFloat((baseCht + chtOffsets[1] + generateGaussianNoise(0, 0.3)).toFixed(1)),
    parseFloat((baseCht + chtOffsets[2] + generateGaussianNoise(0, 0.3)).toFixed(1)),
    parseFloat((baseCht + chtOffsets[3] + generateGaussianNoise(0, 0.3)).toFixed(1)),
  ];

  engineState.oilPressBar = parseFloat(Math.max(0.5, Math.min(6.0, baseOilPress + oilPressOffset + generateGaussianNoise(0, 0.02))).toFixed(2));
  engineState.oilTempC = parseFloat(Math.max(50, Math.min(150, baseOilTemp + oilTempOffset + generateGaussianNoise(0, 0.1))).toFixed(1));
  engineState.vibrationGrms = parseFloat(Math.max(0.08, Math.min(3.5, baseVib + vibOffset + vibNoise)).toFixed(3));
  engineState.fuelFlowLph = parseFloat((26.0 + (engineState.throttlePct - 78.5) * 0.4 + fuelFlowOffset).toFixed(1));
  engineState.lambda = parseFloat((0.94 + lambdaOffset + generateGaussianNoise(0, 0.003)).toFixed(3));
  engineState.genVoltageV = parseFloat((28.4 + genVoltsOffset + generateGaussianNoise(0, 0.05)).toFixed(1));
  engineState.genCurrentA = parseFloat((45.2 + genAmpsOffset + Math.sin(time) * 1.5).toFixed(1));
  engineState.coolantTempC = parseFloat((88.5 + coolantOffset + generateGaussianNoise(0, 0.2)).toFixed(1));
}

// 100 Hz engine physics loop (10 ms)
// Every 2nd tick also runs the FCS at 50 Hz
setInterval(() => {
  updatePhysicsStep(0.01);

  _fcsTick++;
  if (_fcsTick % 2 === 0) {
    // ── FADEC interlock: compute derate from current engine health ──
    const engineTelemetry = {
      health:        (typeof fcsState.health_from_engine === 'number') ? fcsState.health_from_engine : 98,
      rpm:           engineState.rpm,
      egt_c:         engineState.egt[0],
      fuelFlow_kgh:  engineState.fuelFlowLph * 0.72,  // lph → kg/h (avgas density ~0.72)
      fuel_kg:       200 - missionState.missionTime * 0.0072,  // approximate fuel burn
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
}, 10);

// Broadcast full telemetry packet to connected clients at 20 Hz (50ms) for high-framerate rendering
setInterval(() => {
  const binaryCanFrames = generateBinaryCanFrames();
  
  // Calculate First-Principles Physics Nominal Baseline for Residuals
  const nominalEgt = 840 + (engineState.throttlePct - 78.5) * 1.8 + (engineState.rpm - 4800) * 0.03;
  const nominalCht = 106 + (engineState.throttlePct - 78.5) * 0.6;
  const nominalMap = 1.42 + (engineState.throttlePct - 78.5) * 0.015;
  const nominalOilTemp = 98.0 + (engineState.throttlePct - 78.5) * 0.25;
  const nominalOilPress = 3.85 - (nominalOilTemp - 98.0) * 0.015;
  const nominalVib = 0.28 + ((engineState.rpm - 4800) / 5800) * 0.12;

  const residuals = {
    egtResiduals: engineState.egt.map(v => parseFloat((v - nominalEgt).toFixed(1))),
    chtResiduals: engineState.cht.map(v => parseFloat((v - nominalCht).toFixed(1))),
    mapResidual: parseFloat((engineState.mapBar - nominalMap).toFixed(3)),
    oilPressResidual: parseFloat((engineState.oilPressBar - nominalOilPress).toFixed(2)),
    oilTempResidual: parseFloat((engineState.oilTempC - nominalOilTemp).toFixed(1)),
    vibrationResidual: parseFloat((engineState.vibrationGrms - nominalVib).toFixed(3)),
    genVoltageResidual: parseFloat((engineState.genVoltageV - 28.4).toFixed(1)),
    coolantTempResidual: parseFloat((engineState.coolantTempC - 88.5).toFixed(1)),
    maxResidualAbs: Math.max(
      ...engineState.egt.map(v => Math.abs(v - nominalEgt)),
      ...engineState.cht.map(v => Math.abs(v - nominalCht) * 2.5),
      Math.abs(engineState.oilPressBar - nominalOilPress) * 40,
      Math.abs(engineState.vibrationGrms - nominalVib) * 80
    )
  };

  // Determine Real-Time Health & Alert Level
  let healthIndex = 98.0;
  let status = 'NOMINAL'; // 'NOMINAL' | 'DEGRADED' | 'CRITICAL'
  let alertMessage = 'All Rotax 915 iS engine subsystems operating within flight envelope.';

  if (faultState.activeFault !== 'NONE') {
    if (residuals.maxResidualAbs > 80 || engineState.vibrationGrms > 1.2 || engineState.egt[2] > 950 || engineState.oilPressBar < 1.8 || engineState.genVoltageV < 24.0) {
      status = 'CRITICAL';
      healthIndex = Math.max(15, 65 - residuals.maxResidualAbs * 0.45);
      alertMessage = `CRITICAL ALERT: Fault [${faultState.activeFault}] detected. Physical parameters exceeding redline thresholds. Autonomous RTB protocol recommended.`;
    } else {
      status = 'DEGRADED';
      healthIndex = Math.max(55, 88 - residuals.maxResidualAbs * 0.35);
      alertMessage = `CAUTION: Micro-residual anomaly detected in [${faultState.activeFault}]. Engine derating recommended.`;
    }
  }

  // Feed current engine health to FCS health tracker
  if (faultState.activeFault !== 'NONE') {
    fcsState.health_from_engine = parseFloat(healthIndex.toFixed(1));
  } else {
    fcsState.health_from_engine = 98.0;
  }

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
      activeFault: faultState.activeFault,
      severity: faultState.severity
    },
    fleetState: fleetState,
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
      thrust_factor:    interlockOut.thrustFactor ?? 1.0,
      authority_factor: interlockOut.authorityFactor ?? 1.0,
      // FADEC interlock
      engine_derate:    interlockOut.deRateLabel     ?? 'NOMINAL',
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
    },
  };

  io.emit('telemetry_frame', payload);
  // Dedicated FCS channel for lightweight subscribers (PFD, etc.)
  io.emit('fcs_frame', payload.fcs);
}, 50);

// Socket.io Event Handling
io.on('connection', (socket) => {
  console.log(`[Socket.io] Tactical Client Connected: ${socket.id}`);

  // Send initial state immediately
  socket.emit('initial_state', {
    faultState,
    missionState,
    engineState,
    fleetState
  });

  // Inject Fault Handler from Frontend/Judge UI
  socket.on('inject_fault', (data) => {
    const { faultType, severity } = data;
    console.log(`[Fault Injection] Triggered -> Fault: ${faultType}, Severity: ${severity || 0.85}`);
    faultState.activeFault = faultType || 'NONE';
    faultState.severity = severity !== undefined ? severity : 0.85;
    faultState.injectedAt = Date.now();

    io.emit('fault_updated', faultState);
  });

  // Clear Fault Handler
  socket.on('clear_fault', () => {
    console.log('[Fault Injection] Cleared all faults -> Resumed Nominal State');
    faultState.activeFault = 'NONE';
    faultState.severity = 0.0;
    faultState.injectedAt = null;

    io.emit('fault_updated', faultState);
  });

  // Manual Throttle / Condition Control from Judge Sandbox
  socket.on('update_manual_conditions', (data) => {
    if (data.altitudeFt !== undefined) missionState.altitudeFt = data.altitudeFt;
    if (data.airspeedKts !== undefined) missionState.airspeedKts = data.airspeedKts;
    if (data.targetRpm !== undefined) engineState.rpm = data.targetRpm;
    if (data.throttlePct !== undefined) engineState.throttlePct = data.throttlePct;
  });

  // ── FCS / Autopilot control events ──────────────────────────
  socket.on('fcs_set_mode', (data) => {
    const { mode } = data;
    if (mode) { autopilot.setMode(mode); console.log(`[FCS] Mode set to: ${mode}`); }
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
    if (data.alt_ft !== undefined) autopilot.setAltitude(data.alt_ft * 0.3048);
    else if (data.alt_m !== undefined) autopilot.setAltitude(data.alt_m);
    autopilot.arm();
    if (autopilot.mode === 'MANUAL_FBW') autopilot.setMode('ALT_HOLD');
  });

  socket.on('fcs_set_airspeed', (data) => {
    if (data.ias_kts !== undefined) autopilot.setAirspeed(data.ias_kts / 1.94384);
    else if (data.ias_ms !== undefined) autopilot.setAirspeed(data.ias_ms);
    autopilot.arm();
  });

  socket.on('fcs_set_heading', (data) => {
    if (data.heading_deg !== undefined) autopilot.setHeading(data.heading_deg * Math.PI / 180);
    else if (data.heading_rad !== undefined) autopilot.setHeading(data.heading_rad);
    autopilot.arm();
    if (autopilot.mode === 'AUTO_MISSION' || autopilot.mode === 'MANUAL_FBW') {
      autopilot.setMode('ALT_HOLD');
      io.emit('fcs_mode_changed', { mode: 'ALT_HOLD', armed: true });
    }
  });

  socket.on('fcs_load_waypoints', (data) => {
    if (Array.isArray(data.waypoints)) {
      autopilot.loadWaypoints(data.waypoints);
      autopilot.arm();
      autopilot.setMode('AUTO_MISSION');
      console.log(`[FCS] Loaded ${data.waypoints.length} waypoints and activated AUTO_MISSION`);
      io.emit('fcs_mode_changed', { mode: 'AUTO_MISSION', armed: true });
    }
  });

  socket.on('fcs_set_loiter', (data) => {
    autopilot.setLoiter(data.north ?? 0, data.east ?? 0, data.radius_m ?? 2000, data.cw ?? true);
  });

  socket.on('fcs_fbw_input', (data) => {
    autopilot.setFBW(data.roll ?? 0, data.pitch ?? 0, data.yaw ?? 0, data.throttle ?? 0.38);
  });

  socket.on('fcs_reset', () => {
    fcs6dof.reset();
    fadec.resetFlameout();
    autopilot.arm();
    autopilot.setMode(FLIGHT_MODE.ALT_HOLD);
    fcsState = {};
    console.log('[FCS] Full reset performed');
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client Disconnected: ${socket.id}`);
  });
});

// REST API Endpoints for Diagnostics & Sandbox
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    system: 'MALE UAV Digital Twin CAN Bus Engine',
    uptimeSeconds: Math.round(process.uptime()),
    engineModel: 'Rotax 915 iS Turbocharged Piston',
    activeFault: faultState.activeFault
  });
});

app.post('/api/faults/inject', (req, res) => {
  const { faultType, severity } = req.body;
  faultState.activeFault = faultType || 'NONE';
  faultState.severity = severity || 0.85;
  faultState.injectedAt = Date.now();
  io.emit('fault_updated', faultState);
  res.json({ success: true, faultState });
});

app.post('/api/faults/clear', (req, res) => {
  faultState.activeFault = 'NONE';
  faultState.severity = 0.0;
  faultState.injectedAt = null;
  io.emit('fault_updated', faultState);
  res.json({ success: true, faultState });
});

// AI Health & RUL Microservice Proxy Endpoints
app.post('/api/health-rul/predict', async (req, res) => {
  try {
    const aiRes = await fetch('http://127.0.0.1:8001/api/health-rul/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    const data = await aiRes.json();
    res.json(data);
  } catch (error) {
    res.status(503).json({
      error: 'AI Health & RUL microservice unavailable',
      details: error.message
    });
  }
});

app.post('/api/health-rul/detect-anomaly', async (req, res) => {
  try {
    const aiRes = await fetch('http://127.0.0.1:8001/api/health-rul/detect-anomaly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    const data = await aiRes.json();
    res.json(data);
  } catch (error) {
    res.status(503).json({ error: 'AI microservice unavailable' });
  }
});

app.post('/api/health-rul/predict-rul', async (req, res) => {
  try {
    const aiRes = await fetch('http://127.0.0.1:8001/api/health-rul/predict-rul', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    const data = await aiRes.json();
    res.json(data);
  } catch (error) {
    res.status(503).json({ error: 'AI microservice unavailable' });
  }
});

app.post('/api/rl-replan', async (req, res) => {
  try {
    const aiRes = await fetch('http://127.0.0.1:8001/rl-replan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {})
    });
    if (!aiRes.ok) throw new Error(`Python AI returned HTTP ${aiRes.status}`);
    const data = await aiRes.json();
    return res.json(data);
  } catch (error) {
    // Local first-principles analytical RL policy fallback
    const {
      current_lat = 26.4500,
      current_lng = 70.5200,
      altitude_ft = 14500.0,
      engine_health_index = 98.5,
      rul_hours = 842.0,
      target_field_id = null,
      mode = "AUTO"
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

    const isSim = mode === "FORCE_SIMULATION";
    const isPreview = mode === "CONTINGENCY_PREVIEW";
    const isCrit = rul_hours < 2.0 || engine_health_index < 40.0;
    const requiresDivert = isCrit || isSim;
    const isDegraded = !requiresDivert && (engine_health_index < 75.0 || rul_hours < 50.0 || isPreview);

    let targetDest = null;
    if (target_field_id && target_field_id !== "AUTO") {
      targetDest = candidates.find(f => f.id === target_field_id) || candidates[0];
    } else if (requiresDivert || isDegraded) {
      targetDest = candidates[0];
    } else {
      targetDest = candidates.find(f => f.id === "AFS_UTTARLAI") || candidates[0];
    }

    const targetDist = targetDest.dist_nm;

    let recThrottle = 78.0;
    let recRpm = 4850;
    let recClimbFpm = 0;
    let speedKts = 115.0;

    if (requiresDivert) {
      recThrottle = 58.0;
      recRpm = 4200;
      recClimbFpm = -350;
      speedKts = 95.0;
    } else if (isDegraded) {
      recThrottle = 68.0;
      recRpm = 4600;
      recClimbFpm = -200;
      speedKts = 105.0;
    }

    const flightTimeMin = Math.max(0.1, (targetDist / speedKts) * 60.0);
    const flightTimeHrs = flightTimeMin / 60.0;
    const safetyMargin = Number((Math.max(0, rul_hours) / Math.max(0.01, flightTimeHrs)).toFixed(2));

    const waypoints = [];
    const numWp = 4;
    const wpNames = ["CURRENT_POS", "GLIDE_INTERCEPT", "DESCENT_MID", "APPROACH_GATE", "TOUCHDOWN"];
    for (let i = 0; i <= numWp; i++) {
      const frac = i / numWp;
      waypoints.push({
        wp_id: `RTB-${i + 1}`,
        name: requiresDivert ? wpNames[i] : `WP-${i + 1}`,
        lat: Number((current_lat + frac * (targetDest.lat - current_lat)).toFixed(4)),
        lng: Number((current_lng + frac * (targetDest.lng - current_lng)).toFixed(4)),
        altitude_ft: Math.round(altitude_ft - frac * (altitude_ft - targetDest.alt_ft)),
        commanded_airspeed_kts: i === numWp ? 72.0 : speedKts,
        dist_remaining_nm: Number((targetDist * (1.0 - frac)).toFixed(1)),
        eta_min: Number((flightTimeMin * frac).toFixed(1))
      });
    }

    return res.json({
      action: requiresDivert ? "EMERGENCY_DIVERT_RTB" : "DERATE_AND_CONTINUE_MISSION",
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
  if (!mode) { res.status(400).json({ error: 'mode required' }); return; }
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
  if (alt_ft !== undefined) autopilot.setAltitude(alt_ft * 0.3048);
  else if (alt_m !== undefined) autopilot.setAltitude(alt_m);
  else { res.status(400).json({ error: 'alt_ft or alt_m required' }); return; }
  autopilot.arm();
  if (autopilot.mode === 'MANUAL_FBW') autopilot.setMode('ALT_HOLD');
  res.json({ success: true, alt_m: autopilot.sp.alt_m, alt_ft: autopilot.sp.alt_m * 3.28084 });
});

// POST /api/fcs/airspeed  — set airspeed setpoint (kts or m/s)
app.post('/api/fcs/airspeed', (req, res) => {
  const { ias_kts, ias_ms } = req.body;
  if (ias_kts !== undefined) autopilot.setAirspeed(ias_kts / 1.94384);
  else if (ias_ms !== undefined) autopilot.setAirspeed(ias_ms);
  else { res.status(400).json({ error: 'ias_kts or ias_ms required' }); return; }
  autopilot.arm();
  res.json({ success: true, ias_ms: autopilot.sp.ias_ms, ias_kts: autopilot.sp.ias_ms * 1.94384 });
});

// POST /api/fcs/heading  — set heading setpoint (deg or rad)
app.post('/api/fcs/heading', (req, res) => {
  const { heading_deg, heading_rad } = req.body;
  if (heading_deg !== undefined) autopilot.setHeading(heading_deg * Math.PI / 180);
  else if (heading_rad !== undefined) autopilot.setHeading(heading_rad);
  else { res.status(400).json({ error: 'heading_deg or heading_rad required' }); return; }
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
  if (!Array.isArray(waypoints)) { res.status(400).json({ error: 'waypoints array required' }); return; }
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
    fcs6dof.reset();
    fadec.resetFlameout();
    autopilot.arm();
    autopilot.setMode(FLIGHT_MODE.ALT_HOLD);
    fcsState = {};
    res.json({ success: true, message: 'FCS reset to nominal cruise' });
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


server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 MALE UAV Digital Twin Telemetry Engine Running on Port ${PORT}`);
  console.log(`📡 100 Hz CAN Bus Emulator Active (IDs 0x100, 0x200, 0x210, 0x300)`);
  console.log(`✈️  50 Hz 6-DOF Flight Controller Active (TECS + L1 + Cascaded PID)`);
  console.log(`🗄️  SQLite Database: data/garudatwin.db (Sortie #${activeSortieId})`);
  console.log(`=======================================================`);
});
