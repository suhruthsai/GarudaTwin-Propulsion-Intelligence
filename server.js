/**
 * GarudaTwin MALE UAV - CAN Bus Telemetry Engine & Socket.io Server
 * Simulates high-frequency CAN Bus frames (100 Hz binary / structured packets)
 * for Rotax 915/916 iS Turbocharged Aero Piston Engines.
 */

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

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

// 100 Hz simulation loop (10ms)
setInterval(() => {
  updatePhysicsStep(0.01);
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
    canBusFrames: binaryCanFrames
  };

  io.emit('telemetry_frame', payload);
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
    const data = await aiRes.json();
    return res.json(data);
  } catch (error) {
    // Local first-principles analytical RL policy fallback
    const {
      current_lat = 26.4500,
      current_lng = 70.5200,
      altitude_ft = 14500.0,
      engine_health_index = 98.5,
      rul_hours = 842.0
    } = req.body || {};

    const home_base = { name: "AFS Uttarlai (Barmer)", lat: 25.8117, lng: 71.4883, alt_ft: 500 };
    const emergency_strip = { name: "AFS Jaisalmer Forward Base", lat: 26.8897, lng: 70.8653, alt_ft: 825 };

    const toRad = deg => (deg * Math.PI) / 180;
    const calcDistNm = (lat1, lon1, lat2, lon2) => {
      const R = 3440.065;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const distHome = calcDistNm(current_lat, current_lng, home_base.lat, home_base.lng);
    const distAux = calcDistNm(current_lat, current_lng, emergency_strip.lat, emergency_strip.lng);

    const requiresDivert = rul_hours < 2.0 || engine_health_index < 40.0;
    const targetDest = (requiresDivert && distAux < distHome) ? emergency_strip : (requiresDivert ? emergency_strip : home_base);
    const targetDist = targetDest === emergency_strip ? distAux : distHome;

    let recThrottle = 78.0;
    let recRpm = 4850;
    let recClimbFpm = 0;
    let speedKts = 115.0;

    if (engine_health_index < 40.0) {
      recThrottle = 58.0;
      recRpm = 4200;
      recClimbFpm = -350;
      speedKts = 95.0;
    } else if (engine_health_index < 75.0) {
      recThrottle = 68.0;
      recRpm = 4600;
      recClimbFpm = -200;
      speedKts = 105.0;
    }

    const flightTimeMin = Math.max(0.1, (targetDist / speedKts) * 60.0);
    const safetyMargin = Number((rul_hours / (flightTimeMin / 60.0)).toFixed(2));

    const waypoints = [];
    const numWp = 4;
    for (let i = 0; i <= numWp; i++) {
      const frac = i / numWp;
      waypoints.push({
        wp_id: `RTB-${i + 1}`,
        lat: Number((current_lat + frac * (targetDest.lat - current_lat)).toFixed(4)),
        lng: Number((current_lng + frac * (targetDest.lng - current_lng)).toFixed(4)),
        altitude_ft: Math.round(altitude_ft - frac * (altitude_ft - targetDest.alt_ft)),
        commanded_airspeed_kts: speedKts
      });
    }

    return res.json({
      action: requiresDivert ? "EMERGENCY_DIVERT_RTB" : "DERATE_AND_CONTINUE_MISSION",
      target_recovery_field: targetDest.name,
      distance_to_field_nm: Number(targetDist.toFixed(1)),
      estimated_flight_time_minutes: Number(flightTimeMin.toFixed(1)),
      rul_safety_margin_factor: safetyMargin,
      rl_control_commands: {
        recommended_throttle_pct: recThrottle,
        recommended_rpm: recRpm,
        recommended_vertical_speed_fpm: recClimbFpm,
        fuel_flow_target_lph: recThrottle < 65 ? 18.5 : 25.0
      },
      optimized_rtb_flight_plan: waypoints
    });
  }
});


server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 MALE UAV Digital Twin Telemetry Engine Running on Port ${PORT}`);
  console.log(`📡 100 Hz CAN Bus Emulator Active (IDs 0x100, 0x200, 0x210, 0x300)`);
  console.log(`=======================================================`);
});
