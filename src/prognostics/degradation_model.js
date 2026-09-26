/**
 * Degradation Model Module
 * Multi-physics fatigue stress decomposition across 5 physical domains:
 * Thermal, Mechanical, Lubrication, Combustion, Operating Load.
 * Computes:
 * - Engine Degradation Index (EDI 0-100)
 * - Subsystem Degradation Breakdown (Thermal, Mechanical, Lubrication, Combustion, Fuel, Electrical)
 * - Active Degradation Rate (% health loss per hour)
 * - Degradation Trend (STABLE, DEGRADING, RAPIDLY DEGRADING)
 * - Change-point detection
 */

export class DegradationEstimator {
  static evaluate(engine, features, activeFault = 'NONE') {
    const isFault = activeFault !== 'NONE';
    const chts = engine.cht || [106, 106, 106, 106];
    const egts = engine.egt || [840, 840, 840, 840];
    const maxCht = Math.max(...chts);
    const maxEgt = Math.max(...egts);
    const vib = engine.vibrationGrms || 0.28;
    const oilP = engine.oilPressBar || 3.85;
    const oilT = engine.oilTempC || 98.0;
    const map = engine.mapBar || 1.42;
    const rpm = engine.rpm || 4800;

    // 1. Thermal Stress Factor
    let thermalStress = 1.0;
    if (maxCht > 118.0) thermalStress += Math.pow((maxCht - 118.0) / 14.0, 1.8);
    if (oilT > 95.0) thermalStress += Math.pow((oilT - 95.0) / 12.0, 1.6) * 0.7;
    if (maxEgt > 880.0) thermalStress += Math.pow((maxEgt - 880.0) / 25.0, 1.5) * 0.6;

    // 2. Mechanical / Vibration Stress
    let mechanicalStress = 1.0;
    if (vib > 0.35) mechanicalStress += Math.pow((vib - 0.35) / 0.22, 2.0);

    // 3. Lubrication Stress
    let lubricationStress = 1.0;
    if (oilP < 2.8) lubricationStress += Math.pow((2.8 - oilP) / 0.8, 2.2);
    if (oilT > 110.0 && oilP < 2.5) lubricationStress += 1.4;

    // 4. Combustion Stress
    let combustionStress = 1.0;
    if (features.egtSpread > 35.0) combustionStress += (features.egtSpread - 35.0) / 25.0;
    if (maxEgt > 920.0) combustionStress += (maxEgt - 920.0) / 30.0;

    // 5. Operating Load Stress
    let operatingStress = 1.0;
    if (rpm > 5200.0) operatingStress += ((rpm - 5200.0) / 600.0) * 0.5;
    if (map > 1.65) operatingStress += ((map - 1.65) / 0.25) * 0.4;

    // Fault Multipliers
    let faultMult = 1.0;
    if (isFault) {
      if (['CYL3_INJECTOR', 'OIL_PUMP_CAVITATION', 'PRGB_DEGRADATION'].includes(activeFault)) {
        faultMult = 3.5;
      } else if (['BLOW_BY', 'TURBO_WASTEGATE_STUCK'].includes(activeFault)) {
        faultMult = 2.8;
      } else {
        faultMult = 2.2;
      }
    }

    const combinedStress = Number(
      (Math.max(1.0, thermalStress) *
       Math.max(1.0, mechanicalStress) *
       Math.max(1.0, lubricationStress) *
       Math.max(1.0, combustionStress) *
       Math.max(1.0, operatingStress) *
       faultMult).toFixed(2)
    );

    // Engine Degradation Index (EDI 0-100)
    // 0 = pristine / nominal, 100 = catastrophic wear/breakdown
    let rawEdi = 0.0;
    if (isFault) {
      rawEdi = (combinedStress - 1.0) * 12.0 + 35.0;
    } else if (combinedStress > 1.35) {
      rawEdi = (combinedStress - 1.35) * 8.0;
    }
    const edi = Number(Math.max(0.0, Math.min(99.0, rawEdi)).toFixed(1));

    // Health Index (0-100): 100% under nominal cruise operation
    const healthIndex = Number(Math.max(8.0, Math.min(100.0, 100.0 - edi)).toFixed(1));

    // Degradation Rate (%/hr)
    const baseRatePerHour = 0.045; // ~2000 hr TBO nominal
    const activeRatePerHour = Number((baseRatePerHour * combinedStress).toFixed(3));

    // Degradation Trend State
    let trend = 'STABLE';
    if (activeRatePerHour > 0.22 || combinedStress > 3.0) {
      trend = 'RAPIDLY DEGRADING';
    } else if (activeRatePerHour > 0.075 || combinedStress > 1.4) {
      trend = 'DEGRADING';
    } else {
      trend = 'STABLE';
    }

    // Subsystem Degradation Breakdown (0-100)
    // 1. Thermal Subsystem
    const thermalDeg = Math.min(100, Math.max(0, (thermalStress - 1.0) * 45 + (activeFault === 'COOLING_DEGRADATION' ? 65 : 0)));

    // 2. Mechanical Subsystem
    const mechanicalDeg = Math.min(100, Math.max(0, (mechanicalStress - 1.0) * 50 + (activeFault === 'PRGB_DEGRADATION' ? 70 : 0)));

    // 3. Lubrication Subsystem (Oil Pressure, Oil Temp, Bearing Vibration)
    let lubDeg = 2.5 + (rpm / 5800.0) * 2.0;
    if (oilP < 3.5) {
      lubDeg += Math.pow((3.5 - oilP) / 3.0, 1.3) * 82.0;
    } else if (oilP > 4.5) {
      lubDeg += ((oilP - 4.5) / 1.5) * 28.0;
    }
    if (oilT > 105.0) {
      lubDeg += Math.pow((oilT - 105.0) / 45.0, 1.2) * 60.0;
    } else if (oilT < 75.0) {
      lubDeg += ((75.0 - oilT) / 25.0) * 18.0;
    }
    if (vib > 0.45) {
      lubDeg += Math.min(22.0, (vib - 0.45) * 16.0);
    }
    if (activeFault === 'OIL_PUMP_CAVITATION') {
      lubDeg = Math.max(lubDeg, 88.0);
    } else if (activeFault === 'BLOW_BY') {
      lubDeg = Math.max(lubDeg, 58.0);
    }
    const lubricationDeg = Math.min(100, Math.max(0, lubDeg));

    // 4. Combustion Subsystem
    const combustionDeg = Math.min(100, Math.max(0, (combustionStress - 1.0) * 42 + (activeFault === 'CYL3_INJECTOR' ? 75 : 0)));

    // 5. Fuel Subsystem (EGT Spread, Injection Disparity, Lambda)
    let fuelDeg = 3.2 + ((engine.throttlePct || 78.5) / 100.0) * 3.2;
    const egtSpread = features?.egtSpread ?? (maxEgt - Math.min(...egts));
    if (egtSpread > 18.0) {
      fuelDeg += Math.pow(Math.min(1.0, (egtSpread - 18.0) / 120.0), 1.2) * 72.0;
    }
    const lambda = engine.lambda ?? 0.94;
    if (lambda > 1.02) {
      fuelDeg += Math.min(35.0, (lambda - 1.02) * 180.0);
    }
    if (engine.fuelPressureBar && (engine.fuelPressureBar < 2.8 || engine.fuelPressureBar > 3.8)) {
      const pDiff = engine.fuelPressureBar < 2.8 ? 2.8 - engine.fuelPressureBar : engine.fuelPressureBar - 3.8;
      fuelDeg += Math.min(45.0, pDiff * 35.0);
    }
    if (activeFault === 'CYL3_INJECTOR') {
      fuelDeg = Math.max(fuelDeg, 82.0);
    }
    const fuelSystemDeg = Math.min(100, Math.max(0, fuelDeg));

    // 6. Electrical Subsystem (28V Generator, Bus Voltage, Stator Vibration)
    let elecDeg = 2.8 + (rpm / 5800.0) * 2.2;
    const genV = engine.genVoltageV ?? 28.4;
    if (genV < 27.5) {
      elecDeg += Math.min(70.0, (27.5 - genV) * 25.0);
    } else if (genV > 29.2) {
      elecDeg += Math.min(60.0, (genV - 29.2) * 35.0);
    }
    if (rpm < 2600) {
      elecDeg += ((2600 - rpm) / 600.0) * 20.0;
    } else if (rpm > 5500) {
      elecDeg += ((rpm - 5500) / 300.0) * 18.0;
    }
    if (vib > 0.45) {
      elecDeg += Math.min(25.0, (vib - 0.45) * 14.0);
    }
    if (oilT > 115.0) {
      elecDeg += Math.min(20.0, ((oilT - 115.0) / 35.0) * 18.0);
    }
    if (activeFault === 'GENERATOR_FAILURE') {
      elecDeg = Math.max(elecDeg, 88.0);
    }
    const electricalSystemDeg = Math.min(100, Math.max(0, elecDeg));

    const subsystemDegradation = {
      thermal: Number(thermalDeg.toFixed(1)),
      mechanical: Number(mechanicalDeg.toFixed(1)),
      lubrication: Number(lubricationDeg.toFixed(1)),
      combustion: Number(combustionDeg.toFixed(1)),
      fuel: Number(fuelSystemDeg.toFixed(1)),
      electrical: Number(electricalSystemDeg.toFixed(1))
    };

    // Change-point estimation (onset hours ago)
    const changePointHoursAgo = isFault ? Number((edi / Math.max(0.01, activeRatePerHour) * 0.04).toFixed(1)) : null;

    return {
      stressBreakdown: {
        thermalStress: Number(thermalStress.toFixed(2)),
        mechanicalStress: Number(mechanicalStress.toFixed(2)),
        lubricationStress: Number(lubricationStress.toFixed(2)),
        combustionStress: Number(combustionStress.toFixed(2)),
        operatingStress: Number(operatingStress.toFixed(2)),
        combinedStress
      },
      edi,
      healthIndex,
      activeRatePerHour,
      trend,
      subsystemDegradation,
      changePointHoursAgo
    };
  }
}
