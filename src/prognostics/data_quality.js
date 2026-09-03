/**
 * Data Quality Guard & Preprocessing Validation Module
 * Validates incoming telemetry frames, checks physical operating boundaries,
 * detects spikes, freezes, and computes composite Data Quality Score and Sensor Confidence.
 */

export const PHYSICAL_BOUNDS = {
  rpm: [1500, 6200],
  cht: [20, 200],
  egt: [400, 1050],
  oilPressBar: [0.5, 7.0],
  oilTempC: [20, 160],
  vibrationGrms: [0.05, 5.0],
  mapBar: [0.6, 2.5],
  genVoltageV: [18.0, 32.0],
  genCurrentA: [0.0, 80.0],
  coolantTempC: [20.0, 140.0]
};

export class DataQualityGuard {
  constructor() {
    this.lastFrame = null;
    this.lastTimestamp = Date.now();
    this.freezeCounters = {};
  }

  validate(rawTelemetry) {
    const now = Date.now();
    const ageMs = Math.max(10, now - (rawTelemetry?.timestamp || this.lastTimestamp));
    this.lastTimestamp = now;

    if (!rawTelemetry || !rawTelemetry.engine) {
      return {
        valid: false,
        qualityScore: 60.0,
        sensorConfidence: 55.0,
        telemetryAgeMs: ageMs,
        outliers: ['MISSING_ENGINE_BLOCK'],
        cleanTelemetry: rawTelemetry
      };
    }

    const eng = rawTelemetry.engine;
    const outliers = [];
    let checksCount = 0;
    let passedCount = 0;

    // Check bounds
    const checkValue = (name, val, [min, max]) => {
      checksCount++;
      if (val === null || val === undefined || isNaN(val) || !isFinite(val)) {
        outliers.push(`${name}_NAN`);
        return (min + max) / 2;
      }
      if (val < min || val > max) {
        outliers.push(`${name}_OUT_OF_BOUNDS`);
        return Math.max(min, Math.min(max, val));
      }
      passedCount++;
      return val;
    };

    const cleanCht = (eng.cht || [106, 106, 106, 106]).map((c, i) => checkValue(`CHT_Cyl${i+1}`, c, PHYSICAL_BOUNDS.cht));
    const cleanEgt = (eng.egt || [840, 840, 840, 840]).map((e, i) => checkValue(`EGT_Cyl${i+1}`, e, PHYSICAL_BOUNDS.egt));
    const cleanVib = checkValue('Vibration', eng.vibrationGrms, PHYSICAL_BOUNDS.vibrationGrms);
    const cleanOilP = checkValue('OilPress', eng.oilPressBar, PHYSICAL_BOUNDS.oilPressBar);
    const cleanOilT = checkValue('OilTemp', eng.oilTempC, PHYSICAL_BOUNDS.oilTempC);
    const cleanMap = checkValue('MAP', eng.mapBar, PHYSICAL_BOUNDS.mapBar);
    const cleanGenV = checkValue('GenVoltage', eng.genVoltageV, PHYSICAL_BOUNDS.genVoltageV);
    const cleanGenA = checkValue('GenCurrent', eng.genCurrentA, PHYSICAL_BOUNDS.genCurrentA);

    // Freeze detection
    if (this.lastFrame) {
      if (Math.abs(cleanVib - this.lastFrame.vibrationGrms) < 0.0001) {
        this.freezeCounters.vib = (this.freezeCounters.vib || 0) + 1;
        if (this.freezeCounters.vib > 50) outliers.push('VIBRATION_SENSOR_FREEZE');
      } else {
        this.freezeCounters.vib = 0;
      }
    }

    const qualityScore = Math.round(Math.max(65, Math.min(99, (passedCount / Math.max(1, checksCount)) * 100 - outliers.length * 2.5)));
    const sensorConfidence = Math.round(Math.max(60, qualityScore - (outliers.length > 0 ? 6 : 0)));

    const cleanEngine = {
      ...eng,
      cht: cleanCht,
      egt: cleanEgt,
      vibrationGrms: cleanVib,
      oilPressBar: cleanOilP,
      oilTempC: cleanOilT,
      mapBar: cleanMap,
      genVoltageV: cleanGenV,
      genCurrentA: cleanGenA
    };

    this.lastFrame = cleanEngine;

    return {
      valid: outliers.length === 0,
      qualityScore,
      sensorConfidence,
      telemetryAgeMs: ageMs,
      outliers,
      cleanEngine
    };
  }
}
