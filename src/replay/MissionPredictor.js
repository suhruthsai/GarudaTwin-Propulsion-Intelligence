/**
 * MissionPredictor.js — DEMO SCENARIO generator for the Mission Debrief tab (hand-authored sortie).
 *
 * Engine values for each running phase (CHT, EGT, oil temperature, fuel flow, MAP) come from the SAME
 * physics as the live digital twin (src/engine/EngineSimulator.js: ISA air data, turbo pressure-ratio
 * limit, density-dependent cooling) at that phase's altitude, OAT, throttle and RPM, plus the scenario's
 * scripted fault offsets (SCRIPTED_FAULT below). The health / anomaly-score / RUL curve is a scripted
 * scenario heuristic — it is NOT produced by the AI models (real AI results: Data Source & Replay tab).
 */

import { AtmosphericPhysicsEngine } from './AtmosphericPhysicsEngine.js';
import { thermalTargets, nominalFuelLph, isaPressureBar } from '../engine/EngineSimulator.js';

// Scripted anomalies of the demo sortie, added on top of the twin's nominal values (hand-authored)
const SCRIPTED_FAULT = {
  3: { egt: 12, cht: 3, oil: 1, vib: 0.05 },    // ISR orbit: injector #2 pulse irregularity
  4: { egt: 35, cht: 16, oil: 12, vib: 0.10 },  // evasive / high load: transient thermal surge
  5: { egt: 0, cht: 4, oil: 6, vib: 0.45 },     // RTB: gearbox bearing vibration (mainly vibration)
};

export class MissionPredictor {
  /**
   * Evaluates the complete multi-physics state & AI predictions
   * for a given operational phase and environmental boundary conditions.
   */
  static evaluate({
    activePhaseIndex = 7,
    altitudeFt = 22000,
    ambientTempC = -28,
    payloadKg = 85,
    headwindKts = 38,
    scenarioId = 'HIGH_ALT_FL220'
  }) {
    // 1. Compute ISA 1976 Atmosphere at Given Altitude & Temperature
    const aerothermal = AtmosphericPhysicsEngine.computeDerivations(
      altitudeFt,
      ambientTempC,
      104
    );

    const rho = aerothermal.airDensityKgM3;
    const rhoRatio = aerothermal.densityRatio; // rho / rho0
    const pBar = aerothermal.atmosphericPressureHpa / 1000.0;
    const tempK = ambientTempC + 273.15;
    const ambientDelta = ambientTempC - 15.0; // Delta from standard 15°C

    // Environmental stress multipliers

    // 2. Define the 8 Mission Phase Operating Profiles (scaled by environment)
    const rawPhases = [
      { id: 0, time: 'T+00:00:00', name: 'PRE-FLIGHT', timeSec: 0, altFrac: 0, spd: 0, thr: 0, baseRpm: 0, baseMap: 1.01, faultType: 'NONE' },
      { id: 1, time: 'T+00:06:00', name: 'TAKEOFF', timeSec: 360, altFrac: 0.05, spd: 82, thr: 100, baseRpm: 5800, baseMap: 1.55, faultType: 'NONE' },
      { id: 2, time: 'T+00:40:00', name: 'CLIMB', timeSec: 2400, altFrac: 0.65, spd: 118, thr: 85, baseRpm: 5200, baseMap: 1.48, faultType: 'NONE' },
      { id: 3, time: 'T+01:42:00', name: 'ISR ORBIT', timeSec: 6120, altFrac: 1.0, spd: 104, thr: 75, baseRpm: 4800, baseMap: 1.38, faultType: 'INJECTOR_PULSE', badge: 'ANOM', badgeType: 'warning' },
      { id: 4, time: 'T+03:18:00', name: 'EVASIVE / HIGH-LOAD', timeSec: 11880, altFrac: 1.05, spd: 152, thr: 94, baseRpm: 5650, baseMap: 1.68, faultType: 'THERMAL_SURGE', badge: 'ANOM', badgeType: 'orange' },
      { id: 5, time: 'T+04:05:00', name: 'RETURN TO BASE', timeSec: 14700, altFrac: 0.75, spd: 130, thr: 68, baseRpm: 4400, baseMap: 1.15, faultType: 'VIB_2X_HARMONIC', badge: 'ALERT', badgeType: 'danger' },
      { id: 6, time: 'T+06:00:00', name: 'DESCENT', timeSec: 21600, altFrac: 0.28, spd: 115, thr: 35, baseRpm: 3400, baseMap: 0.95, faultType: 'NONE' },
      { id: 7, time: 'T+07:00:00', name: 'RECOVERY', timeSec: 25200, altFrac: 0, spd: 62, thr: 22, baseRpm: 2680, baseMap: 0.87, faultType: 'NONE' }
    ];

    // Log notes for each phase
    const logNotes = [
      `FADEC dual-channel BIT check complete. Fuel manifold primed at ${ambientTempC}°C ambient. Pre-flight ignition verified.`,
      `Full TOGA demand (5800 RPM). Turbo wastegate locked closed. Maximum rate of climb engaged with ${payloadKg} kg payload.`,
      `En route climb through FL${Math.round((altitudeFt * 0.65) / 100)}. Transitioning to cruise mixture. Boost pressure stable at ${aerothermal.turboCompensatorRatio}:1 PR.`,
      `Station established at FL${Math.round(altitudeFt / 100)}. Sensor payload active. Fuel delivery micro-pulsation logged on Injector #2.`,
      `High-G evasion maneuver. Throttle commanded to 94% TOGA. Transient thermal surge on CHT and oil cooler (${ambientTempC > 30 ? 'High thermal stress' : 'Normal dissipation'}).`,
      `Gearbox bearing vibration anomaly (+0.45 g above the twin, scripted). Derated cruise (68% throttle) commanded to protect the bearing.`,
      `Controlled idle descent through FL${Math.round((altitudeFt * 0.28) / 100)}. Cabin alt depressurization nominal. Airspeed stabilized at 115 kts.`,
      `Autonomous touchdown, runway rollout & 3-minute post-flight engine cooldown scavenge at ${ambientTempC}°C ambient.`
    ];

    // 3. Compute Phase Telemetry & Cumulative Health Decay
    let currentHealth = 100.0;
    const trajectory = [];
    const computedPhases = [];

    rawPhases.forEach((p, idx) => {
      // Calculate phase altitude
      const isRunway = idx === 0 || idx === 7;
      const minEnrouteAlt = Math.min(1200, altitudeFt);
      const phaseAlt = isRunway ? 150 : Math.round(Math.max(minEnrouteAlt, altitudeFt * (p.altFrac || 1.0)));
      const phaseFl = isRunway ? 'FL2' : `FL${Math.round(phaseAlt / 100)}`;
      const phaseSpd = p.spd;
      const phaseThr = p.thr;
      const phaseRpm = p.baseRpm;

      // Twin physics at this phase's altitude / OAT / throttle / RPM (OAT held at the scenario value)
      const tw = thermalTargets(phaseThr, phaseRpm, isaPressureBar(phaseAlt), ambientTempC);
      const sf = SCRIPTED_FAULT[idx] || { egt: 0, cht: 0, oil: 0, vib: 0 };

      // Scripted scenario curves (hand-authored)
      const nominalOilPs = [0.0, 68.2, 58.0, 52.4, 45.2, 42.0, 46.5, 48.1];
      const nominalHealths = [100.0, 99.0, 98.0, 94.0, 86.0, 76.0, 72.0, 70.0];
      const nominalMses = [0.00, 0.01, 0.02, 0.08, 0.28, 0.54, 0.22, 0.14];
      const nominalRuls = [850.0, 848.0, 840.0, 810.0, 720.0, 550.0, 480.0, 401.2];

      // Scenario heuristics (health / oil pressure / vibration): offsets from the default FL220, -28 °C case
      const deltaTEnv = ambientTempC - (-28.0);
      const loadRatio = payloadKg / 85.0;

      let phaseCht, phaseEgt, phaseOilT, phaseOilP, phaseFfGph, phaseVib, phaseMse, phaseHealth, phaseRul, phaseMap = p.baseMap;

      if (idx === 0) {
        // PRE-FLIGHT (Engine OFF)
        phaseCht = Math.max(15.0, ambientTempC + 15.0);
        phaseEgt = Math.max(15.0, ambientTempC + 10.0);
        phaseOilT = Math.max(15.0, ambientTempC + 12.0);
        phaseOilP = 0.0;
        phaseFfGph = 0.0;
        phaseVib = 0.000;
        phaseMse = 0.00;
        phaseHealth = 100.0;
        phaseRul = 850.0;
      } else {
        // Running engine: twin physics + scripted fault offsets
        phaseCht = tw.cht + sf.cht;
        phaseEgt = tw.egt + sf.egt;
        phaseOilT = tw.oilTemp + sf.oil;
        phaseMap = tw.map;   // limited by ambient pressure x turbo max pressure ratio

        // Viscosity effect on oil pressure: cold increases pressure, hot decreases
        const viscEffect = -deltaTEnv * 0.12;
        phaseOilP = Math.max(26.0, Math.min(78.0, nominalOilPs[idx] + viscEffect));

        // Fuel flow: twin's nominal fuel model at this throttle and delivered power fraction
        phaseFfGph = nominalFuelLph(phaseThr, tw.pf) / 3.78541;

        // Vibration (broadband g-RMS): twin nominal at this RPM + scripted fault offset + small gust term (scenario heuristic)
        const windVibEffect = (headwindKts - 38.0) * 0.001;
        phaseVib = Math.max(0.1, 0.28 + ((phaseRpm - 4800) / 5800) * 0.12 + sf.vib + windVibEffect);

        // Scripted scenario anomaly score (hand-authored curve, not a model output)
        const envMseOffset = Math.max(0, deltaTEnv * 0.0015) + (loadRatio - 1.0) * 0.02;
        phaseMse = Math.max(0.01, nominalMses[idx] + envMseOffset);

        // Health Degradation Model:
        // Hot desert or heavy load accelerates degradation
        const fatigueAccel = (1.0 + Math.max(-0.2, deltaTEnv * 0.008) + (loadRatio - 1.0) * 0.35);
        const nominalDegradation = 100.0 - nominalHealths[idx];
        const actualDegradation = nominalDegradation * fatigueAccel;
        phaseHealth = Math.max(48.0, Number((100.0 - actualDegradation).toFixed(1)));

        // Scripted scenario RUL (hand-authored heuristic, not a model output):
        // RUL scales proportionally from nominal curve with health headroom to 50% MEL limit
        const nominalMargin = Math.max(1.0, nominalHealths[idx] - 50.0);
        const currentMargin = Math.max(1.0, phaseHealth - 50.0);
        const marginRatio = currentMargin / nominalMargin;
        const calculatedRul = Number((nominalRuls[idx] * marginRatio * (1.0 / Math.max(0.2, fatigueAccel))).toFixed(1));
        phaseRul = Math.max(15.0, Math.min(850.0, calculatedRul));
      }

      trajectory.push(phaseHealth);

      // Pack complete formatted telemetry object
      let telemetryObj= {
        alt: `${phaseAlt} FT`,
        flTag: phaseFl,
        spd: `${phaseSpd} KTS`,
        spdSub: idx === 0 ? 'Static GND' : 'TAS indicated',
        thr: `${phaseThr}% TOGA`,
        thrSub: 'FADEC Demand',
        rpm: `${phaseRpm} RPM`,
        rpmSub: `Prop: ${Math.round(phaseRpm / 2.54)}`,
        fuelFlow: `${phaseFfGph.toFixed(1)} GPH`,
        fuelFlowSub: `${(phaseFfGph * 3.78541).toFixed(1)} L/h`,
        cht: `${phaseCht.toFixed(1)} °C`,
        chtSub: phaseCht > 130 ? 'OVER-TEMP REDLINE' : 'Nom: <130°C',
        egt: `${Math.round(phaseEgt)} °C`,
        egtSub: phaseEgt > 930 ? 'ABOVE CAUTION (930 °C)' : 'Caution 930 / limit 950 °C (L1)',
        oilP: `${phaseOilP.toFixed(1)} PSI`,
        oilPSub: `${(phaseOilP * 0.0689476).toFixed(2)} bar`,
        oilT: `${phaseOilT.toFixed(1)} °C`,
        vib: `${phaseVib.toFixed(2)} g`,
        map: `${phaseMap.toFixed(2)} BAR`,
        health: `${phaseHealth.toFixed(0)}%`,
        healthVal: phaseHealth,
        anomalyScore: phaseMse.toFixed(2),
        rul: `${phaseRul.toFixed(1)} HRS`
      };

      // Apply scenario-specific physical characterizations from atmospheric engine
      telemetryObj = AtmosphericPhysicsEngine.getScenarioAdjustedTelemetry(
        telemetryObj,
        scenarioId,
        altitudeFt,
        ambientTempC,
        idx
      );

      computedPhases.push({
        ...p,
        alt: telemetryObj.alt,
        flTag: telemetryObj.flTag,
        spd: `${phaseSpd} KT`,
        logNote: logNotes[idx],
        telemetry: telemetryObj
      });
    });

    // 4. Generate Dynamic SVG Coordinates for Health Degradation Curve
    // X-coordinates corresponding to timestamps 00:00, 00:06, 00:40, 01:42, 03:18, 04:05, 06:00, 07:00
    const xCoords = [60, 100, 170, 300, 500, 600, 800, 940];
    const polylinePoints = trajectory.map((h, i) => {
      // Y-axis: 100% health = y 30; 50% health = y 145 (MEL Limit); 0% health = y 200
      const y = Number((30 + (100.0 - h) * 2.3).toFixed(1));
      return `${xCoords[i]},${y}`;
    }).join(' ');

    const polygonPoints = `60,30 ${polylinePoints} 940,180 60,180`;

    // 5. Active Phase Data
    const activeData = computedPhases[activePhaseIndex] || computedPhases[7];

    return {
      aerothermal,
      computedPhases,
      activeTelemetry: activeData.telemetry,
      currentLogNote: activeData.logNote,
      trajectory,
      svgCoordinates: {
        xCoords,
        polylinePoints,
        polygonPoints,
        activeX: xCoords[activePhaseIndex] || 940,
        activeY: Number((30 + (100.0 - (trajectory[activePhaseIndex] || 70.0)) * 2.3).toFixed(1))
      }
    };
  }
}
