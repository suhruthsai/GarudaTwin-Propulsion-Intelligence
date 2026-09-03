/**
 * GarudaTwin MALE UAV - Post-Flight Analytics (PFA) Engine
 * DO-178C / STANAG 4671 Compliant Airworthiness & Diagnostic Mathematics
 * 
 * Physics Principles:
 * - First-Principles Thermodynamic Baseline & Delta Residuals
 * - Cumulative Thermal Stress Integration (Time-at-Temperature)
 * - Rainflow Stress Cycle Counting & Miner's Cumulative Damage Rule (D = Sum n_i / N_i)
 * - Hydrodynamic Lubrication Breakdown Integration
 * - Multi-Subsystem Degradation Grading & Golden Baseline Comparison
 */

export class PostFlightAnalytics {
  /**
   * Run full post-flight analysis on a set of recorded or replayed telemetry frames
   */
  static analyzeSortie(sortie) {
    if (!sortie || !sortie.frames || sortie.frames.length === 0) {
      return this._getEmptyAudit(sortie);
    }

    const frames = sortie.frames;
    const n = frames.length;
    const durationSeconds = sortie.durationSeconds || Math.round((frames[n - 1].timestamp - frames[0].timestamp) / 1000);
    const dt = durationSeconds / Math.max(1, n - 1);

    // 1. Parameter Envelope Min/Max/Avg & Exceedance Scanner
    const exceedances = [];
    let currentExceedance = null;

    const stats = {
      egtMax: [0, 0, 0, 0],
      egtAvg: [0, 0, 0, 0],
      chtMax: [0, 0, 0, 0],
      chtAvg: [0, 0, 0, 0],
      mapMax: 0,
      mapMin: 99,
      oilPressMin: 99,
      oilTempMax: 0,
      vibMax: 0,
      vibAvg: 0,
      fuelTotalLiters: 0,
      minHealthIndex: 100,
      finalHealthIndex: 100,
      minRulHours: 9999,
      maxMseLoss: 0
    };

    let thermalStressAccum = 0;
    let lubricationStressAccum = 0;
    const vibSeries = [];
    const rpmSeries = [];

    // Redline limits compliant with Rotax 915 iS Operating Manual
    const LIMITS = {
      egtMax: 950.0,      // °C
      chtMax: 135.0,      // °C
      mapMax: 2.00,       // bar
      oilPressMin: 1.80,  // bar
      oilTempMax: 130.0,  // °C
      vibMax: 1.20        // g-RMS
    };

    frames.forEach((f, idx) => {
      const e = f.engine;
      const t = f.timestamp;
      const m = f.mission;

      vibSeries.push(e.vibrationGrms);
      rpmSeries.push(e.rpm);

      // Accumulate stats
      stats.mapMax = Math.max(stats.mapMax, e.mapBar);
      stats.mapMin = Math.min(stats.mapMin, e.mapBar);
      stats.oilPressMin = Math.min(stats.oilPressMin, e.oilPressBar);
      stats.oilTempMax = Math.max(stats.oilTempMax, e.oilTempC);
      stats.vibMax = Math.max(stats.vibMax, e.vibrationGrms);
      stats.vibAvg += e.vibrationGrms;
      stats.fuelTotalLiters += (e.fuelFlowLph / 3600) * dt;

      if (f.health) {
        stats.minHealthIndex = Math.min(stats.minHealthIndex, f.health.index);
        stats.finalHealthIndex = f.health.index;
      }
      if (f.ai) {
        stats.minRulHours = Math.min(stats.minRulHours, f.ai.rul);
        stats.maxMseLoss = Math.max(stats.maxMseLoss, f.ai.mse);
      }

      for (let c = 0; c < 4; c++) {
        stats.egtMax[c] = Math.max(stats.egtMax[c], e.egt[c]);
        stats.egtAvg[c] += e.egt[c];
        stats.chtMax[c] = Math.max(stats.chtMax[c], e.cht[c]);
        stats.chtAvg[c] += e.cht[c];

        // EGT Exceedance Check
        if (e.egt[c] > LIMITS.egtMax) {
          this._handleExceedance(exceedances, 'EGT_CRITICAL', `Cylinder ${c + 1} EGT Exceedance`, e.egt[c], LIMITS.egtMax, '°C', t, dt, 'CLASS_A');
        }
        // CHT Exceedance Check
        if (e.cht[c] > LIMITS.chtMax) {
          this._handleExceedance(exceedances, 'CHT_WARNING', `Cylinder ${c + 1} CHT Exceedance`, e.cht[c], LIMITS.chtMax, '°C', t, dt, 'CLASS_B');
        }
      }

      // MAP Overboost Check
      if (e.mapBar > LIMITS.mapMax) {
        this._handleExceedance(exceedances, 'MAP_OVERBOOST', 'Manifold Absolute Pressure Overboost', e.mapBar, LIMITS.mapMax, 'bar', t, dt, 'CLASS_A');
      }

      // Oil Pressure Drop Check
      if (e.oilPressBar < LIMITS.oilPressMin) {
        this._handleExceedance(exceedances, 'OIL_PRESS_LOSS', 'Hydrodynamic Oil Pressure Below Minimum', e.oilPressBar, LIMITS.oilPressMin, 'bar', t, dt, 'CLASS_A');
      }

      // Vibration Surge Check
      if (e.vibrationGrms > LIMITS.vibMax) {
        this._handleExceedance(exceedances, 'VIB_SURGE', 'Vibration Envelope Redline Exceedance', e.vibrationGrms, LIMITS.vibMax, 'g-RMS', t, dt, 'CLASS_B');
      }

      // Physics Stress Integrals
      // Thermal stress: time-at-temperature integral above thermal damage threshold
      const maxEgt = Math.max(...e.egt);
      const maxCht = Math.max(...e.cht);
      if (maxEgt > 880) thermalStressAccum += Math.pow((maxEgt - 880) / 20.0, 1.8) * dt;
      if (maxCht > 120) thermalStressAccum += Math.pow((maxCht - 120) / 8.0, 1.6) * dt;

      // Lubrication breakdown stress: integral of pressure deficit and oil overheating
      if (e.oilPressBar < 2.8) lubricationStressAccum += Math.pow((2.8 - e.oilPressBar) / 0.8, 2.0) * dt;
      if (e.oilTempC > 115) lubricationStressAccum += Math.pow((e.oilTempC - 115) / 10.0, 1.7) * dt;
    });

    for (let c = 0; c < 4; c++) {
      stats.egtAvg[c] = Number((stats.egtAvg[c] / n).toFixed(1));
      stats.chtAvg[c] = Number((stats.chtAvg[c] / n).toFixed(1));
    }
    stats.vibAvg = Number((stats.vibAvg / n).toFixed(3));
    stats.fuelTotalLiters = Number(stats.fuelTotalLiters.toFixed(2));

    // 2. Mechanical Fatigue: Rainflow Cycle Counting & Miner's Cumulative Rule
    const mechanicalDamage = this._computeMinerDamage(vibSeries, rpmSeries, dt);

    // 3. Subsystem Health Scorecards (0 to 100)
    const combustionHealth = Math.max(15, Math.min(100, Math.round(100 - (exceedances.filter(e => e.param.includes('EGT')).length * 6) - (thermalStressAccum * 0.08))));
    const lubricationHealth = Math.max(10, Math.min(100, Math.round(100 - (exceedances.filter(e => e.param.includes('Oil')).length * 8) - (lubricationStressAccum * 0.12))));
    const turboHealth = Math.max(20, Math.min(100, Math.round(100 - (stats.mapMax > 1.9 ? (stats.mapMax - 1.9) * 120 : 0))));
    const structuralHealth = Math.max(20, Math.min(100, Math.round(100 - mechanicalDamage.damageIndex * 100)));
    const coolingHealth = Math.max(25, Math.min(100, Math.round(100 - (stats.chtMax.some(c => c > 125) ? 35 : 0))));

    // Overall Airworthiness Certification
    let airworthiness = 'AIRWORTHY';
    let airworthinessBadgeClass = 'text-emerald-400 border-emerald-500/50 bg-emerald-950/60';
    let maintenanceWorkOrder = 'NONE';

    const hasClassA = exceedances.some(e => e.severity === 'CLASS_A');
    if (hasClassA || stats.minHealthIndex < 40.0 || mechanicalDamage.damageIndex > 0.4) {
      airworthiness = 'MAINTENANCE_MANDATORY_AOG';
      airworthinessBadgeClass = 'text-red-400 border-red-500/50 bg-red-950/60';
      maintenanceWorkOrder = 'AOG: Immediate teardown inspection of combustion chamber, injectors, and PRGB required prior to next flight.';
    } else if (exceedances.length > 0 || stats.minHealthIndex < 80.0) {
      airworthiness = 'DERATED_INSPECTION_DUE';
      airworthinessBadgeClass = 'text-amber-400 border-amber-500/50 bg-amber-950/60';
      maintenanceWorkOrder = 'CAUTION: Perform borescope examination of exhaust valves and oil filter residue test.';
    }

    return {
      sortieId: sortie.sortieId,
      missionName: sortie.missionName,
      uavId: sortie.uavId,
      durationSeconds,
      frameCount: n,
      stats,
      exceedances,
      thermalStressJoules: Number(thermalStressAccum.toFixed(1)),
      lubricationStressIntegral: Number(lubricationStressAccum.toFixed(1)),
      mechanicalDamage,
      subsystems: {
        combustion: combustionHealth,
        lubrication: lubricationHealth,
        turbocharger: turboHealth,
        cooling: coolingHealth,
        structural: structuralHealth
      },
      airworthiness: {
        status: airworthiness,
        badgeClass: airworthinessBadgeClass,
        workOrder: maintenanceWorkOrder
      }
    };
  }

  /**
   * Helper to merge consecutive exceedance frames into unified incidents with duration
   */
  static _handleExceedance(list, id, label, currentVal, limitVal, unit, timestamp, dt, severity) {
    const last = list[list.length - 1];
    if (last && last.id === id && (timestamp - last.lastTimestamp) <= 30000) {
      last.durationSec += dt;
      last.lastTimestamp = timestamp;
      if (currentVal > last.peakValue) {
        last.peakValue = currentVal;
        last.peakDeviation = Number((currentVal - limitVal).toFixed(2));
      }
    } else {
      list.push({
        id,
        param: label,
        startTime: timestamp,
        lastTimestamp: timestamp,
        durationSec: Number(dt.toFixed(1)),
        peakValue: currentVal,
        limitValue: limitVal,
        peakDeviation: Number((currentVal - limitVal).toFixed(2)),
        unit,
        severity
      });
    }
  }

  /**
   * Approximates Rainflow Cycle Counting and Miner's Cumulative Damage Rule
   * D = Sum(n_i / N_i)
   */
  static _computeMinerDamage(vibrationSeries, rpmSeries, dt) {
    if (vibrationSeries.length < 3) {
      return { damageIndex: 0.01, cycleCount: 0, fatigueLevel: 'NOMINAL' };
    }

    // Peak-valley extraction
    const extrema = [];
    for (let i = 1; i < vibrationSeries.length - 1; i++) {
      const prev = vibrationSeries[i - 1];
      const curr = vibrationSeries[i];
      const next = vibrationSeries[i + 1];
      if ((curr >= prev && curr >= next) || (curr <= prev && curr <= next)) {
        extrema.push(curr);
      }
    }

    // Count stress ranges
    let damageIndex = 0;
    let cycleCount = 0;
    for (let i = 0; i < extrema.length - 1; i++) {
      const deltaG = Math.abs(extrema[i + 1] - extrema[i]);
      if (deltaG > 0.1) {
        cycleCount++;
        // Basquin S-N fatigue curve exponent: N = (1.5 / deltaG)^3.2
        const nCyclesToFailure = Math.max(100, Math.pow(2.0 / deltaG, 3.5) * 10000);
        damageIndex += (1.0 / nCyclesToFailure);
      }
    }

    damageIndex = Number(Math.min(1.0, damageIndex * 15).toFixed(4));

    let fatigueLevel = 'MINIMAL';
    if (damageIndex > 0.4) fatigueLevel = 'CRITICAL';
    else if (damageIndex > 0.15) fatigueLevel = 'MODERATE';

    return {
      damageIndex,
      cycleCount,
      fatigueLevel
    };
  }

  /**
   * Compare two sorties (Analyzed Sortie vs Golden Standard Sortie)
   */
  static compareWithGolden(analyzedSortie, goldenSortie) {
    if (!analyzedSortie?.frames || !goldenSortie?.frames) return null;

    const aFrames = analyzedSortie.frames;
    const gFrames = goldenSortie.frames;
    const minLen = Math.min(aFrames.length, gFrames.length);

    let sumEgtDiffSq = 0;
    let sumOilPDiffSq = 0;
    let sumVibDiffSq = 0;
    let maxEgtDelta = 0;

    for (let i = 0; i < minLen; i++) {
      const aEgt = aFrames[i].engine.egt[2];
      const gEgt = gFrames[i].engine.egt[2];
      const egtDiff = aEgt - gEgt;
      sumEgtDiffSq += egtDiff * egtDiff;
      if (Math.abs(egtDiff) > maxEgtDelta) maxEgtDelta = Math.abs(egtDiff);

      const aOilP = aFrames[i].engine.oilPressBar;
      const gOilP = gFrames[i].engine.oilPressBar;
      sumOilPDiffSq += Math.pow(aOilP - gOilP, 2);

      const aVib = aFrames[i].engine.vibrationGrms;
      const gVib = gFrames[i].engine.vibrationGrms;
      sumVibDiffSq += Math.pow(aVib - gVib, 2);
    }

    const rmsdEgt = Number(Math.sqrt(sumEgtDiffSq / minLen).toFixed(1));
    const rmsdOilP = Number(Math.sqrt(sumOilPDiffSq / minLen).toFixed(2));
    const rmsdVib = Number(Math.sqrt(sumVibDiffSq / minLen).toFixed(3));

    return {
      rmsdEgt,
      rmsdOilP,
      rmsdVib,
      maxEgtDelta: Number(maxEgtDelta.toFixed(1)),
      degradationDriftPct: Number(Math.min(100, (rmsdEgt / 45.0 + rmsdVib / 0.5) * 50).toFixed(1))
    };
  }

  static _getEmptyAudit(sortie) {
    return {
      sortieId: sortie?.sortieId || 'UNKNOWN',
      missionName: sortie?.missionName || 'No Data',
      durationSeconds: 0,
      frameCount: 0,
      stats: { egtMax: [0,0,0,0], chtMax: [0,0,0,0], mapMax: 0, oilPressMin: 0, vibMax: 0, fuelTotalLiters: 0, minHealthIndex: 100 },
      exceedances: [],
      thermalStressJoules: 0,
      lubricationStressIntegral: 0,
      mechanicalDamage: { damageIndex: 0, cycleCount: 0, fatigueLevel: 'NOMINAL' },
      subsystems: { combustion: 100, lubrication: 100, turbocharger: 100, cooling: 100, structural: 100 },
      airworthiness: { status: 'AIRWORTHY', badgeClass: 'text-emerald-400', workOrder: 'NONE' }
    };
  }
}
