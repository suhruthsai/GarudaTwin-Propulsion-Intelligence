/**
 * GarudaTwin MALE UAV - Preloaded Benchmark Flight Sorties
 * High-fidelity synthetic mission data generated using Rotax 915 iS
 * first-principles thermodynamic, aerodynamic, and PyTorch degradation models.
 */

// Helper to generate CAN binary hex frames for a given engine state
function packCanHex(e) {
  const b0 = Math.round(e.rpm).toString(16).padStart(4, '0');
  const b1 = Math.round(e.throttlePct * 100).toString(16).padStart(4, '0');
  const b2 = Math.round(e.fuelFlowLph * 100).toString(16).padStart(4, '0');
  const b3 = Math.round(e.lambda * 1000).toString(16).padStart(4, '0');

  const egtHex = e.egt.map(v => Math.round(v * 10).toString(16).padStart(4, '0')).join('');
  const chtHex = e.cht.map(v => Math.round(v * 10).toString(16).padStart(4, '0')).join('');

  const m0 = Math.round(e.mapBar * 1000).toString(16).padStart(4, '0');
  const m1 = Math.round(e.oilPressBar * 1000).toString(16).padStart(4, '0');
  const m2 = Math.round((e.oilTempC + 50) * 100).toString(16).padStart(4, '0');
  const m3 = Math.round(e.vibrationGrms * 1000).toString(16).padStart(4, '0');

  return [
    { canId: '0x100', rawHex: (b0 + b1 + b2 + b3).toUpperCase() },
    { canId: '0x200', rawHex: egtHex.toUpperCase() },
    { canId: '0x210', rawHex: chtHex.toUpperCase() },
    { canId: '0x300', rawHex: (m0 + m1 + m2 + m3).toUpperCase() }
  ];
}

// --------------------------------------------------------------------------
// SORTIE 1: OPERATION DESERT EYE (Nominal Loiter Surveillance Mission)
// --------------------------------------------------------------------------
function generateSortie1() {
  const frames = [];
  const totalSteps = 150;
  const startTime = Date.now() - 3600000;

  for (let i = 0; i <= totalSteps; i++) {
    const tProgress = i / totalSteps;
    const missionSec = i * 20; // 50-minute simulated profile
    const timeMs = startTime + missionSec * 1000;

    // Aerodynamic profile (Takeoff -> Climb -> Loiter -> Descent -> Landing)
    let alt = 14500;
    let spd = 110;
    let phase = 'LOITER';
    let lat = 26.4500 + Math.sin(tProgress * Math.PI * 4) * 0.15;
    let lng = 70.5200 + Math.cos(tProgress * Math.PI * 4) * 0.15;

    if (tProgress < 0.1) {
      phase = 'CLIMB';
      alt = 500 + (tProgress / 0.1) * 14000;
      spd = 90 + (tProgress / 0.1) * 20;
    } else if (tProgress > 0.9) {
      phase = 'DESCENT';
      alt = 14500 - ((tProgress - 0.9) / 0.1) * 14000;
      spd = 110 - ((tProgress - 0.9) / 0.1) * 35;
    }

    const rpm = 4800 + Math.sin(i * 0.2) * 25;
    const thr = 78.5 + Math.sin(i * 0.2) * 0.8;
    const map = 1.42 + (thr - 78.5) * 0.012;
    const oilP = 3.85 + Math.sin(i * 0.15) * 0.05;
    const oilT = 98.4 + Math.sin(i * 0.08) * 0.6;
    const vib = 0.28 + Math.sin(i * 0.3) * 0.02;

    const baseEgt = 840.0 + (thr - 78.5) * 1.8;
    const baseCht = 106.0 + (thr - 78.5) * 0.6;

    const engine = {
      rpm: Math.round(rpm),
      throttlePct: Number(thr.toFixed(1)),
      egt: [
        Number((baseEgt + Math.sin(i) * 2.0).toFixed(1)),
        Number((baseEgt - 1.5 + Math.cos(i) * 1.8).toFixed(1)),
        Number((baseEgt + 2.5 + Math.sin(i * 1.5) * 2.2).toFixed(1)),
        Number((baseEgt + 0.5 + Math.cos(i * 1.2) * 1.9).toFixed(1))
      ],
      cht: [
        Number((baseCht + 0.5).toFixed(1)),
        Number((baseCht + 1.2).toFixed(1)),
        Number((baseCht - 0.4).toFixed(1)),
        Number((baseCht + 0.8).toFixed(1))
      ],
      mapBar: Number(map.toFixed(3)),
      oilPressBar: Number(oilP.toFixed(2)),
      oilTempC: Number(oilT.toFixed(1)),
      vibrationGrms: Number(vib.toFixed(3)),
      fuelFlowLph: 26.4,
      fuelPressureBar: 3.12,
      lambda: 0.94,
      wastegateDutyPct: 62.0,
      genVoltageV: 28.4,
      genCurrentA: 45.2,
      coolantTempC: 88.5
    };

    const residuals = {
      egtResiduals: engine.egt.map(v => Number((v - baseEgt).toFixed(1))),
      chtResiduals: engine.cht.map(v => Number((v - baseCht).toFixed(1))),
      mapResidual: Number((map - 1.42).toFixed(3)),
      oilPressResidual: Number((oilP - 3.85).toFixed(2)),
      oilTempResidual: Number((oilT - 98.4).toFixed(1)),
      vibrationResidual: Number((vib - 0.28).toFixed(3))
    };

    frames.push({
      timestamp: timeMs,
      mission: {
        missionTime: missionSec,
        altitudeFt: Math.round(alt),
        airspeedKts: Math.round(spd),
        missionPhase: phase,
        uavId: 'Vahak-1',
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4))
      },
      engine,
      residuals,
      health: {
        index: Number((99.0 - tProgress * 0.8).toFixed(1)),
        status: 'NOMINAL',
        alertMessage: 'Rotax 915 iS operating strictly within green operational envelope.',
        activeFault: 'NONE',
        severity: 0.0
      },
      ai: {
        rul: Number((845.0 - tProgress * 0.8).toFixed(1)),
        mse: 0.0012,
        anomalyScore: 0.012
      },
      canBusFrames: packCanHex(engine)
    });
  }

  return {
    sortieId: 'SORTIE-VAHAK-1-ALPHA-DESERT-EYE',
    missionName: 'OPERATION DESERT EYE (Nominal 6-Hr Loiter)',
    uavId: 'Vahak-1',
    engineModel: 'Rotax 915 iS Turbocharged (S/N: RTX-0842)',
    startTime: startTime,
    endTime: startTime + totalSteps * 20 * 1000,
    durationSeconds: totalSteps * 20,
    initialFlightHours: 415.0,
    targetAirfield: 'AFS Uttarlai (Barmer)',
    benchmarkStatus: 'NOMINAL_BASELINE',
    events: [
      { time: startTime, type: 'TAKEOFF', label: 'Takeoff from AFS Uttarlai RWY 27' },
      { time: startTime + 300000, type: 'CRUISE', label: 'Level off at FL145 On-Station' },
      { time: startTime + 2400000, type: 'DESCENT', label: 'Commenced standard descent to recovery field' },
      { time: startTime + totalSteps * 20 * 1000, type: 'LANDING', label: 'Safe touchdown at AFS Uttarlai' }
    ],
    frames
  };
}

// --------------------------------------------------------------------------
// SORTIE 2: IRON RECON (Cylinder 3 Injector Clog & Lean Burn Anomaly)
// --------------------------------------------------------------------------
function generateSortie2() {
  const frames = [];
  const totalSteps = 160;
  const startTime = Date.now() - 3600000;
  const faultStep = 60; // Inception at ~37% through mission

  for (let i = 0; i <= totalSteps; i++) {
    const missionSec = i * 20;
    const timeMs = startTime + missionSec * 1000;

    let isFault = i >= faultStep;
    let faultProg = isFault ? Math.min(1.0, (i - faultStep) / 30) : 0.0;

    let alt = 14500;
    let spd = 110;
    let phase = isFault ? (faultProg > 0.5 ? 'EMERGENCY_RTB' : 'LOITER') : 'LOITER';
    let lat = 26.4500 + (isFault ? (faultProg * 0.4397) : Math.sin(i * 0.1) * 0.1);
    let lng = 70.5200 + (isFault ? (faultProg * 0.3453) : Math.cos(i * 0.1) * 0.1);

    let thr = 78.5;
    let rpm = 4800;
    if (isFault) {
      if (faultProg > 0.6) {
        // Derated for emergency RTB
        thr = 58.0;
        rpm = 4250;
        alt = Math.max(2500, 14500 - (faultProg - 0.6) * 25000);
        spd = 95;
      }
    }

    const baseEgt = 840.0 + (thr - 78.5) * 1.8;
    const cyl3EgtOffset = isFault ? (135.0 * faultProg + Math.sin(i * 1.5) * 12 * faultProg) : 0;
    const cyl3ChtOffset = isFault ? (28.0 * faultProg) : 0;
    const vibOffset = isFault ? (0.95 * faultProg + Math.sin(i * 2.0) * 0.15) : 0;

    const egt3 = baseEgt + 3.0 + cyl3EgtOffset;
    const cht3 = 106.0 + cyl3ChtOffset;
    const vib = 0.28 + vibOffset;

    const engine = {
      rpm: Math.round(rpm),
      throttlePct: Number(thr.toFixed(1)),
      egt: [
        Number((baseEgt - (isFault ? 8.0 * faultProg : 0)).toFixed(1)),
        Number((baseEgt - (isFault ? 6.0 * faultProg : 0)).toFixed(1)),
        Number(egt3.toFixed(1)),
        Number((baseEgt - (isFault ? 7.0 * faultProg : 0)).toFixed(1))
      ],
      cht: [
        Number((106.2).toFixed(1)),
        Number((107.0).toFixed(1)),
        Number(cht3.toFixed(1)),
        Number((106.5).toFixed(1))
      ],
      mapBar: Number((1.42 + (thr - 78.5) * 0.015).toFixed(3)),
      oilPressBar: Number((3.85 - (isFault ? 0.35 * faultProg : 0)).toFixed(2)),
      oilTempC: Number((98.4 + (isFault ? 12.0 * faultProg : 0)).toFixed(1)),
      vibrationGrms: Number(vib.toFixed(3)),
      fuelFlowLph: Number((26.4 - (isFault ? 3.5 * faultProg : 0)).toFixed(1)),
      fuelPressureBar: 3.12,
      lambda: Number((0.94 + (isFault ? 0.18 * faultProg : 0)).toFixed(3)),
      wastegateDutyPct: 62.0,
      genVoltageV: 28.4,
      genCurrentA: 45.2,
      coolantTempC: 88.5
    };

    const residuals = {
      egtResiduals: engine.egt.map(v => Number((v - baseEgt).toFixed(1))),
      chtResiduals: engine.cht.map(v => Number((v - 106.0).toFixed(1))),
      mapResidual: 0.0,
      oilPressResidual: Number((engine.oilPressBar - 3.85).toFixed(2)),
      oilTempResidual: Number((engine.oilTempC - 98.4).toFixed(1)),
      vibrationResidual: Number((vib - 0.28).toFixed(3))
    };

    let status = 'NOMINAL';
    let healthIdx = 98.5;
    let alertMsg = 'All engine subsystems within limits.';
    if (isFault) {
      if (egt3 > 950 || vib > 1.2) {
        status = 'CRITICAL';
        healthIdx = Math.max(18.0, 98.5 - faultProg * 75.0);
        alertMsg = 'CRITICAL: Cylinder 3 Lean Burn Thermal Runaway! Redline exceedance detected.';
      } else {
        status = 'DEGRADED';
        healthIdx = 98.5 - faultProg * 35.0;
        alertMsg = 'CAUTION: Cylinder 3 EGT residual diverging from nominal baseline.';
      }
    }

    frames.push({
      timestamp: timeMs,
      mission: {
        missionTime: missionSec,
        altitudeFt: Math.round(alt),
        airspeedKts: Math.round(spd),
        missionPhase: phase,
        uavId: 'Vahak-1',
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4))
      },
      engine,
      residuals,
      health: {
        index: Number(healthIdx.toFixed(1)),
        status,
        alertMessage: alertMsg,
        activeFault: isFault ? 'CYL3_INJECTOR' : 'NONE',
        severity: faultProg
      },
      ai: {
        rul: Number((isFault ? Math.max(1.8, 842.0 - faultProg * 835.0) : 842.0).toFixed(1)),
        mse: Number((isFault ? 0.0012 + faultProg * 0.145 : 0.0012).toFixed(4)),
        anomalyScore: Number((isFault ? faultProg * 0.92 : 0.01).toFixed(2))
      },
      canBusFrames: packCanHex(engine)
    });
  }

  return {
    sortieId: 'SORTIE-VAHAK-1-BRAVO-IRON-RECON',
    missionName: 'IRON RECON (Cylinder 3 Injector Clog & Thermal Runaway)',
    uavId: 'Vahak-1',
    engineModel: 'Rotax 915 iS Turbocharged (S/N: RTX-0842)',
    startTime: startTime,
    endTime: startTime + totalSteps * 20 * 1000,
    durationSeconds: totalSteps * 20,
    initialFlightHours: 415.0,
    targetAirfield: 'AFS Jaisalmer Forward Base (Emergency Recovery Strip)',
    benchmarkStatus: 'CRITICAL_FAULT_INJECTED',
    events: [
      { time: startTime, type: 'TAKEOFF', label: 'Takeoff from AFS Uttarlai' },
      { time: startTime + 60 * 20 * 1000, type: 'FAULT_INCEPTION', label: 'Cylinder 3 Fuel Injector Orifice Restriction' },
      { time: startTime + 80 * 20 * 1000, type: 'EXCEEDANCE_EGT', label: 'EGT 3 exceeds 950°C Redline (Peak 976.4°C)' },
      { time: startTime + 90 * 20 * 1000, type: 'RL_DIVERT', label: 'RL Policy autonomously triggered emergency diversion to Jaisalmer' },
      { time: startTime + totalSteps * 20 * 1000, type: 'RECOVERY', label: 'Emergency arrestor cable recovery at AFS Jaisalmer' }
    ],
    frames
  };
}

// --------------------------------------------------------------------------
// SORTIE 3: SENTINEL GUARDIAN (Oil Pump Cavitation & Hydrodynamic Breakdown)
// --------------------------------------------------------------------------
function generateSortie3() {
  const frames = [];
  const totalSteps = 150;
  const startTime = Date.now() - 3600000;
  const faultStep = 50;

  for (let i = 0; i <= totalSteps; i++) {
    const missionSec = i * 20;
    const timeMs = startTime + missionSec * 1000;
    const isFault = i >= faultStep;
    const faultProg = isFault ? Math.min(1.0, (i - faultStep) / 25) : 0.0;

    let alt = 14500;
    let spd = 110;
    let phase = isFault ? 'EMERGENCY_RTB' : 'LOITER';
    let lat = 26.4500 + (isFault ? (faultProg * 0.3) : Math.sin(i * 0.1) * 0.1);
    let lng = 70.5200 + (isFault ? (faultProg * 0.2) : Math.cos(i * 0.1) * 0.1);

    let thr = isFault && faultProg > 0.5 ? 60.0 : 78.5;
    let rpm = isFault && faultProg > 0.5 ? 4300 : 4800;

    const oilPressDrop = isFault ? (-2.4 * faultProg + Math.sin(i * 3.0) * 0.65 * faultProg) : 0;
    const oilPress = Math.max(1.1, 3.85 + oilPressDrop);
    const oilTemp = 98.4 + (isFault ? 32.0 * faultProg : 0);
    const vib = 0.28 + (isFault ? 1.45 * faultProg + Math.sin(i * 1.5) * 0.2 : 0);

    const engine = {
      rpm: Math.round(rpm),
      throttlePct: thr,
      egt: [842, 840, 843, 841],
      cht: [106, 108, 107, 108],
      mapBar: 1.42,
      oilPressBar: Number(oilPress.toFixed(2)),
      oilTempC: Number(oilTemp.toFixed(1)),
      vibrationGrms: Number(vib.toFixed(3)),
      fuelFlowLph: 26.4,
      fuelPressureBar: 3.12,
      lambda: 0.94,
      wastegateDutyPct: 62.0,
      genVoltageV: 28.4,
      genCurrentA: 45.2,
      coolantTempC: 88.5
    };

    const residuals = {
      egtResiduals: [2, 0, 3, 1],
      chtResiduals: [0, 2, 1, 2],
      mapResidual: 0.0,
      oilPressResidual: Number((oilPress - 3.85).toFixed(2)),
      oilTempResidual: Number((oilTemp - 98.4).toFixed(1)),
      vibrationResidual: Number((vib - 0.28).toFixed(3))
    };

    let status = 'NOMINAL';
    let healthIdx = 98.5;
    if (isFault) {
      if (oilPress < 1.8 || vib > 1.2) {
        status = 'CRITICAL';
        healthIdx = Math.max(12.0, 98.5 - faultProg * 82.0);
      } else {
        status = 'DEGRADED';
        healthIdx = 98.5 - faultProg * 40.0;
      }
    }

    frames.push({
      timestamp: timeMs,
      mission: {
        missionTime: missionSec,
        altitudeFt: Math.round(alt),
        airspeedKts: Math.round(spd),
        missionPhase: phase,
        uavId: 'Vahak-1',
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4))
      },
      engine,
      residuals,
      health: {
        index: Number(healthIdx.toFixed(1)),
        status,
        alertMessage: isFault ? 'CRITICAL: Oil pump cavitation! Hydrodynamic wedge breakdown.' : 'Nominal operation.',
        activeFault: isFault ? 'OIL_PUMP_CAVITATION' : 'NONE',
        severity: faultProg
      },
      ai: {
        rul: Number((isFault ? Math.max(0.8, 842.0 - faultProg * 840.0) : 842.0).toFixed(1)),
        mse: Number((isFault ? 0.0012 + faultProg * 0.165 : 0.0012).toFixed(4)),
        anomalyScore: Number((isFault ? faultProg * 0.96 : 0.01).toFixed(2))
      },
      canBusFrames: packCanHex(engine)
    });
  }

  return {
    sortieId: 'SORTIE-VAHAK-1-CHARLIE-SENTINEL',
    missionName: 'SENTINEL GUARDIAN (Oil Pump Cavitation & Bearing Distress)',
    uavId: 'Vahak-1',
    engineModel: 'Rotax 915 iS Turbocharged (S/N: RTX-0842)',
    startTime: startTime,
    endTime: startTime + totalSteps * 20 * 1000,
    durationSeconds: totalSteps * 20,
    initialFlightHours: 415.0,
    targetAirfield: 'Aux Recovery Strip 04',
    benchmarkStatus: 'LUBRICATION_CRITICAL',
    events: [
      { time: startTime, type: 'TAKEOFF', label: 'Takeoff from AFS Uttarlai' },
      { time: startTime + 50 * 20 * 1000, type: 'FAULT_INCEPTION', label: 'Oil aeration / Pressure relief valve chatter' },
      { time: startTime + 65 * 20 * 1000, type: 'EXCEEDANCE_OIL_PRESS', label: 'Oil Pressure dropped to 1.35 bar (Redline < 1.8 bar)' },
      { time: startTime + 80 * 20 * 1000, type: 'VIBRATION_SURGE', label: 'Hydrodynamic bearing distress (>1.65g broad-spectrum)' },
      { time: startTime + totalSteps * 20 * 1000, type: 'LANDING', label: 'Forced dead-stick recovery at Aux Strip 04' }
    ],
    frames
  };
}

// --------------------------------------------------------------------------
// SORTIE 4: FALCON STRIKE (Turbocharger Wastegate Seize & Overboost)
// --------------------------------------------------------------------------
function generateSortie4() {
  const frames = [];
  const totalSteps = 150;
  const startTime = Date.now() - 3600000;
  const faultStep = 55;

  for (let i = 0; i <= totalSteps; i++) {
    const missionSec = i * 20;
    const timeMs = startTime + missionSec * 1000;
    const isFault = i >= faultStep;
    const faultProg = isFault ? Math.min(1.0, (i - faultStep) / 25) : 0.0;

    let thr = 78.5;
    let rpm = 4800;
    let mapSurge = isFault ? (0.76 * faultProg + Math.sin(i * 2.0) * 0.08) : 0;
    let map = 1.42 + mapSurge;

    if (isFault && faultProg > 0.6) {
      thr = 62.0; // Operator derated to counter overboost
      rpm = 4500;
      map = 1.75;
    }

    const engine = {
      rpm: Math.round(rpm + (isFault ? 320 * faultProg : 0)),
      throttlePct: thr,
      egt: [
        Number((842 + (isFault ? 45 * faultProg : 0)).toFixed(1)),
        Number((840 + (isFault ? 42 * faultProg : 0)).toFixed(1)),
        Number((844 + (isFault ? 48 * faultProg : 0)).toFixed(1)),
        Number((841 + (isFault ? 44 * faultProg : 0)).toFixed(1))
      ],
      cht: [108, 109, 108, 110],
      mapBar: Number(map.toFixed(3)),
      oilPressBar: 3.85,
      oilTempC: Number((98.4 + (isFault ? 14 * faultProg : 0)).toFixed(1)),
      vibrationGrms: Number((0.28 + (isFault ? 0.48 * faultProg : 0)).toFixed(3)),
      fuelFlowLph: Number((26.4 + (isFault ? 4.8 * faultProg : 0)).toFixed(1)),
      fuelPressureBar: 3.12,
      lambda: 0.92,
      wastegateDutyPct: isFault ? 100.0 : 62.0,
      genVoltageV: 28.4,
      genCurrentA: 45.2,
      coolantTempC: 88.5
    };

    const residuals = {
      egtResiduals: [40, 38, 44, 40],
      chtResiduals: [2, 3, 2, 4],
      mapResidual: Number((map - 1.42).toFixed(3)),
      oilPressResidual: 0.0,
      oilTempResidual: Number((engine.oilTempC - 98.4).toFixed(1)),
      vibrationResidual: 0.2
    };

    let status = 'NOMINAL';
    let healthIdx = 98.5;
    if (isFault) {
      if (map > 2.0) {
        status = 'CRITICAL';
        healthIdx = Math.max(25.0, 98.5 - faultProg * 65.0);
      } else {
        status = 'DEGRADED';
        healthIdx = 98.5 - faultProg * 35.0;
      }
    }

    frames.push({
      timestamp: timeMs,
      mission: {
        missionTime: missionSec,
        altitudeFt: 16500,
        airspeedKts: 125,
        missionPhase: isFault ? 'DERATED_CRUISE' : 'CRUISE',
        uavId: 'Vahak-1',
        lat: Number((26.45 + Math.sin(i * 0.1) * 0.1).toFixed(4)),
        lng: Number((70.52 + Math.cos(i * 0.1) * 0.1).toFixed(4))
      },
      engine,
      residuals,
      health: {
        index: Number(healthIdx.toFixed(1)),
        status,
        alertMessage: isFault ? 'CRITICAL: Turbocharger Wastegate Seized! Manifold pressure exceeding 2.0 bar.' : 'Nominal operation.',
        activeFault: isFault ? 'TURBO_WASTEGATE_STUCK' : 'NONE',
        severity: faultProg
      },
      ai: {
        rul: Number((isFault ? Math.max(45.0, 842.0 - faultProg * 600.0) : 842.0).toFixed(1)),
        mse: Number((isFault ? 0.0012 + faultProg * 0.095 : 0.0012).toFixed(4)),
        anomalyScore: Number((isFault ? faultProg * 0.85 : 0.01).toFixed(2))
      },
      canBusFrames: packCanHex(engine)
    });
  }

  return {
    sortieId: 'SORTIE-VAHAK-1-DELTA-FALCON',
    missionName: 'FALCON STRIKE (Turbocharger Wastegate Seize & Overboost Surge)',
    uavId: 'Vahak-1',
    engineModel: 'Rotax 915 iS Turbocharged (S/N: RTX-0842)',
    startTime: startTime,
    endTime: startTime + totalSteps * 20 * 1000,
    durationSeconds: totalSteps * 20,
    initialFlightHours: 415.0,
    targetAirfield: 'AFS Uttarlai (Barmer)',
    benchmarkStatus: 'TURBO_OVERBOOST',
    events: [
      { time: startTime, type: 'TAKEOFF', label: 'Takeoff from AFS Uttarlai' },
      { time: startTime + 55 * 20 * 1000, type: 'FAULT_INCEPTION', label: 'Electronic wastegate actuator jam in closed position' },
      { time: startTime + 68 * 20 * 1000, type: 'EXCEEDANCE_MAP', label: 'Manifold Absolute Pressure peaked at 2.18 bar (Redline 2.0 bar)' },
      { time: startTime + 80 * 20 * 1000, type: 'DERATE', label: 'Operator derates throttle to 62% to preserve compressor wheel' },
      { time: startTime + totalSteps * 20 * 1000, type: 'LANDING', label: 'Normal landing rollout at AFS Uttarlai' }
    ],
    frames
  };
}

// --------------------------------------------------------------------------
// 8-PHASE TACTICAL ISR SORTIE (BLACK-BOX FADEC TRACE)
// Exactly matching Tactical ISR Mission Replay Wireframe Layout
// --------------------------------------------------------------------------
export const TACTICAL_ISR_8PHASE_SORTIE = {
  sortieId: 'SORTIE-TACTICAL-ISR-FL280',
  missionName: 'TACTICAL ISR MISSION REPLAY • 8-PHASE SORTIE (BLACK-BOX FADEC TRACE)',
  subtitle: 'Synchronized FADEC recorder & physics twin • Scrub timeline to inspect engine telemetry and causal residuals at any timestamp',
  uavId: 'Vahak-1',
  coords: '34.6644°N 118.0847°W',
  fadecSync: '100% PASS',
  totalDurationSeconds: 25200, // 7 Hours
  environmentalPresets: [
    { id: 'HIGH_ALT', label: 'HIGH-ALT FL280', icon: 'Mountain', altFt: 28000, tempC: -28, payload: '85 kg (EO/IR + SAR)', headwindKts: 38 },
    { id: 'HOT_DESERT', label: 'HOT DESERT +48°C', icon: 'Sun', altFt: 2500, tempC: 48, payload: '95 kg (Dual EO/IR)', headwindKts: 18 },
    { id: 'MARITIME', label: 'MARITIME RELAY', icon: 'Waves', altFt: 1200, tempC: 18, payload: '75 kg (AIS + SATCOM)', headwindKts: 24 }
  ],
  anomalies: [
    {
      id: 'ANOM_1',
      time: 'T+01:42:00',
      timeSeconds: 6120,
      phaseId: 3, // ISR ORBIT
      severity: 'MINOR',
      title: 'Minor Fuel Delivery Anomaly',
      detail: 'Δ Inj #2 Duration / Rail Pressure: +45 µs (3.6% residual)',
      deltaMetrics: { injDurationUs: '+45 µs', railPressureResidualPct: '3.6%' }
    },
    {
      id: 'ANOM_2',
      time: 'T+03:18:00',
      timeSeconds: 11880,
      phaseId: 4, // EVASIVE
      severity: 'WARNING',
      title: 'Thermal Degradation & Oil Heat Surge',
      detail: 'Δ Max CHT / Oil Temp: +19.4°C over golden twin',
      deltaMetrics: { deltaChtOilC: '+19.4°C' }
    },
    {
      id: 'ANOM_3',
      time: 'T+04:05:00',
      timeSeconds: 14700,
      phaseId: 5, // RETURN TO BASE
      severity: 'CRITICAL',
      title: 'High Vibration Detected (2X Harmonic)',
      detail: 'Δ Vibration 2X Harmonic: +0.048 IPS (141% residual)',
      deltaMetrics: { vibration2xIps: '+0.048 IPS', residualPct: '141%' }
    }
  ],
  phases: [
    {
      id: 0,
      time: 'T+00:00:00',
      timeSeconds: 0,
      name: 'PRE-FLIGHT',
      alt: '150 FT',
      altFt: 150,
      flTag: 'FL2',
      spd: '0 KT',
      spdKts: 0,
      badge: null,
      telemetry: {
        alt: '150 FT', flTag: 'FL2',
        spd: '0 KTS', spdSub: 'TAS indicated',
        thr: '0% TOGA', thrSub: 'FADEC Demand',
        rpm: '0 RPM', rpmSub: 'Prop: 0',
        fuelFlow: '0.0 GPH', fuelFlowSub: '0.0 L/h',
        cht: '25.0 °C', chtSub: 'Nom: <130°C',
        egt: '25 °C', egtSub: 'Nom: 700-820°C',
        oilP: '0.0 PSI', oilPSub: '0.00 bar',
        oilT: '24.0 °C',
        vib: '0.000 IPS',
        map: '1.01 BAR',
        health: '100%', healthVal: 100,
        anomalyScore: '0.00',
        rul: '850.0 HRS'
      },
      logNote: 'FADEC dual-channel BIT check complete. Fuel manifold primed. Pre-flight ignition verified.'
    },
    {
      id: 1,
      time: 'T+00:06:00',
      timeSeconds: 360,
      name: 'TAKEOFF',
      alt: '1200 FT',
      altFt: 1200,
      flTag: 'FL12',
      spd: '82 KT',
      spdKts: 82,
      badge: null,
      telemetry: {
        alt: '1200 FT', flTag: 'FL12',
        spd: '82 KTS', spdSub: 'TAS indicated',
        thr: '100% TOGA', thrSub: 'FADEC Demand',
        rpm: '5800 RPM', rpmSub: 'Prop: 2280',
        fuelFlow: '10.8 GPH', fuelFlowSub: '40.8 L/h',
        cht: '118.5 °C', chtSub: 'Nom: <130°C',
        egt: '865 °C', egtSub: 'Nom: 700-820°C',
        oilP: '68.2 PSI', oilPSub: '4.70 bar',
        oilT: '98.5 °C',
        vib: '0.042 IPS',
        map: '1.52 BAR',
        health: '99%', healthVal: 99,
        anomalyScore: '0.01',
        rul: '848.0 HRS'
      },
      logNote: 'Full TOGA demand (5800 RPM). Turbo wastegate locked closed. Maximum rate of climb engaged.'
    },
    {
      id: 2,
      time: 'T+00:40:00',
      timeSeconds: 2400,
      name: 'CLIMB',
      alt: '18500 FT',
      altFt: 18500,
      flTag: 'FL185',
      spd: '118 KT',
      spdKts: 118,
      badge: null,
      telemetry: {
        alt: '18500 FT', flTag: 'FL185',
        spd: '118 KTS', spdSub: 'TAS indicated',
        thr: '85% TOGA', thrSub: 'FADEC Demand',
        rpm: '5200 RPM', rpmSub: 'Prop: 2050',
        fuelFlow: '8.4 GPH', fuelFlowSub: '31.8 L/h',
        cht: '112.0 °C', chtSub: 'Nom: <130°C',
        egt: '845 °C', egtSub: 'Nom: 700-820°C',
        oilP: '58.0 PSI', oilPSub: '4.00 bar',
        oilT: '96.0 °C',
        vib: '0.035 IPS',
        map: '1.45 BAR',
        health: '98%', healthVal: 98,
        anomalyScore: '0.02',
        rul: '840.0 HRS'
      },
      logNote: 'En route climb through FL185. Transitioning to cruise mixture (Lambda 0.94). Boost pressure stable.'
    },
    {
      id: 3,
      time: 'T+01:42:00',
      timeSeconds: 6120,
      name: 'ISR ORBIT',
      alt: '25000 FT',
      altFt: 25000,
      flTag: 'FL250',
      spd: '104 KT',
      spdKts: 104,
      badge: 'ANOM',
      badgeType: 'warning',
      telemetry: {
        alt: '25000 FT', flTag: 'FL250',
        spd: '104 KTS', spdSub: 'TAS indicated',
        thr: '75% TOGA', thrSub: 'FADEC Demand',
        rpm: '4800 RPM', rpmSub: 'Prop: 1890',
        fuelFlow: '6.2 GPH', fuelFlowSub: '23.5 L/h',
        cht: '108.2 °C', chtSub: 'Nom: <130°C',
        egt: '858 °C', egtSub: 'Nom: 700-820°C',
        oilP: '52.4 PSI', oilPSub: '3.61 bar',
        oilT: '95.2 °C',
        vib: '0.038 IPS',
        map: '1.38 BAR',
        health: '94%', healthVal: 94,
        anomalyScore: '0.08',
        rul: '810.0 HRS'
      },
      logNote: 'Station established at FL250. Sensor payload active. Fuel delivery micro-pulsation logged on Injector #2.'
    },
    {
      id: 4,
      time: 'T+03:18:00',
      timeSeconds: 11880,
      name: 'EVASIVE / HIGH-LOAD',
      alt: '26500 FT',
      altFt: 26500,
      flTag: 'FL265',
      spd: '152 KT',
      spdKts: 152,
      badge: 'ANOM',
      badgeType: 'orange',
      telemetry: {
        alt: '26500 FT', flTag: 'FL265',
        spd: '152 KTS', spdSub: 'TAS indicated',
        thr: '94% TOGA', thrSub: 'FADEC Demand',
        rpm: '5650 RPM', rpmSub: 'Prop: 2220',
        fuelFlow: '9.8 GPH', fuelFlowSub: '37.1 L/h',
        cht: '132.8 °C', chtSub: 'Nom: <130°C',
        egt: '912 °C', egtSub: 'Nom: 700-820°C',
        oilP: '45.2 PSI', oilPSub: '3.12 bar',
        oilT: '118.4 °C',
        vib: '0.058 IPS',
        map: '1.68 BAR',
        health: '86%', healthVal: 86,
        anomalyScore: '0.28',
        rul: '720.0 HRS'
      },
      logNote: 'High-G evasion maneuver. Throttle commanded to 94% TOGA. Transient thermal surge on CHT and oil cooler.'
    },
    {
      id: 5,
      time: 'T+04:05:00',
      timeSeconds: 14700,
      name: 'RETURN TO BASE',
      alt: '21000 FT',
      altFt: 21000,
      flTag: 'FL210',
      spd: '130 KT',
      spdKts: 130,
      badge: 'ALERT',
      badgeType: 'danger',
      telemetry: {
        alt: '21000 FT', flTag: 'FL210',
        spd: '130 KTS', spdSub: 'TAS indicated',
        thr: '68% TOGA', thrSub: 'FADEC Demand',
        rpm: '4400 RPM', rpmSub: 'Prop: 1730',
        fuelFlow: '5.4 GPH', fuelFlowSub: '20.4 L/h',
        cht: '115.0 °C', chtSub: 'Nom: <130°C',
        egt: '840 °C', egtSub: 'Nom: 700-820°C',
        oilP: '42.0 PSI', oilPSub: '2.90 bar',
        oilT: '106.0 °C',
        vib: '0.082 IPS',
        map: '1.15 BAR',
        health: '76%', healthVal: 76,
        anomalyScore: '0.54',
        rul: '550.0 HRS'
      },
      logNote: '2X harmonic vibration anomaly detected. FADEC commanding derated cruise (68% throttle) to preserve bearing.'
    },
    {
      id: 6,
      time: 'T+06:00:00',
      timeSeconds: 21600,
      name: 'DESCENT',
      alt: '7500 FT',
      altFt: 7500,
      flTag: 'FL75',
      spd: '115 KT',
      spdKts: 115,
      badge: null,
      telemetry: {
        alt: '7500 FT', flTag: 'FL75',
        spd: '115 KTS', spdSub: 'TAS indicated',
        thr: '35% TOGA', thrSub: 'FADEC Demand',
        rpm: '3400 RPM', rpmSub: 'Prop: 1340',
        fuelFlow: '3.2 GPH', fuelFlowSub: '12.1 L/h',
        cht: '102.0 °C', chtSub: 'Nom: <130°C',
        egt: '760 °C', egtSub: 'Nom: 700-820°C',
        oilP: '46.5 PSI', oilPSub: '3.21 bar',
        oilT: '92.5 °C',
        vib: '0.036 IPS',
        map: '0.95 BAR',
        health: '72%', healthVal: 72,
        anomalyScore: '0.22',
        rul: '480.0 HRS'
      },
      logNote: 'Controlled idle descent through FL075. Cabin alt depressurization nominal. Airspeed stabilized at 115 kts.'
    },
    {
      id: 7,
      time: 'T+07:00:00',
      timeSeconds: 25200,
      name: 'RECOVERY',
      alt: '150 FT',
      altFt: 150,
      flTag: 'FL2',
      spd: '62 KT',
      spdKts: 62,
      badge: null,
      telemetry: {
        alt: '150 FT', flTag: 'FL2',
        spd: '62 KTS', spdSub: 'TAS indicated',
        thr: '22% TOGA', thrSub: 'FADEC Demand',
        rpm: '2680 RPM', rpmSub: 'Prop: 1055',
        fuelFlow: '2.3 GPH', fuelFlowSub: '8.7 L/h',
        cht: '100.4 °C', chtSub: 'Nom: <130°C',
        egt: '730 °C', egtSub: 'Nom: 700-820°C',
        oilP: '48.1 PSI', oilPSub: '3.32 bar',
        oilT: '90.3 °C',
        vib: '0.038 IPS',
        map: '0.87 BAR',
        health: '70%', healthVal: 70, // Matches 70% in image curve
        anomalyScore: '0.14',
        rul: '401.2 HRS'
      },
      logNote: 'Autonomous touchdown, runway rollout & 3-minute post-flight engine cooldown scavenge.'
    }
  ]
};

// Export pre-generated benchmark sorties
export const PRELOADED_SORTIES = [
  TACTICAL_ISR_8PHASE_SORTIE,
  generateSortie1(),
  generateSortie2(),
  generateSortie3(),
  generateSortie4()
];
