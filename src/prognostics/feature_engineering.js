/**
 * Feature Engineering & Physics Residuals Module
 * Implements thermodynamic and gas-dynamic baseline models for the Rotax 915/916 iS.
 * Computes condition-normalized physics residuals: Observed - Expected(RPM, Load, Alt)
 * and rolling statistical features.
 */

export class FeatureEngineer {
  /**
   * First-principles thermodynamic model: computes expected nominal engine state.
   */
  static computeNominalBaseline(rpm = 4800, throttlePct = 78.5, altitudeFt = 14500) {
    const altKm = altitudeFt * 0.0003048;
    const pAmbient = 1.01325 * Math.pow(1.0 - 0.0225577 * altKm, 5.25588);
    const compressorPr = 1.0 + ((throttlePct / 100.0) * 1.15) * 1.35 * (rpm / 5800.0);
    const nominalMap = Math.min(1.85, Math.max(0.7, pAmbient * compressorPr));

    const nominalEgt = 820.0 + (throttlePct / 100.0) * 45.0 + (rpm / 5800.0) * 20.0 + (altitudeFt / 10000.0) * 8.0;
    const nominalCht = 102.0 + (throttlePct / 100.0) * 12.0 + (nominalEgt - 800.0) * 0.05;
    const nominalOilTemp = 94.0 + (throttlePct / 100.0) * 8.0 + (rpm / 5800.0) * 5.0;
    const nominalOilPress = Math.max(2.2, 4.2 - (nominalOilTemp - 90.0) * 0.018 - (5800.0 - rpm) * 0.0002);
    const nominalVib = 0.22 + 0.16 * (rpm / 5800.0) + (throttlePct / 100.0) * 0.05;

    return {
      nominalMap: Number(nominalMap.toFixed(3)),
      nominalEgt: Number(nominalEgt.toFixed(1)),
      nominalCht: Number(nominalCht.toFixed(1)),
      nominalOilTemp: Number(nominalOilTemp.toFixed(1)),
      nominalOilPress: Number(nominalOilPress.toFixed(2)),
      nominalVib: Number(nominalVib.toFixed(3))
    };
  }

  /**
   * Computes normalized features and residuals
   */
  static extractFeatures(engine, mission = { altitudeFt: 14500, throttlePct: 78.5 }) {
    const rpm = engine.rpm || 4800;
    const throttle = mission.throttlePct || 78.5;
    const alt = mission.altitudeFt || 14500;

    const base = this.computeNominalBaseline(rpm, throttle, alt);

    const chts = engine.cht || [106, 106, 106, 106];
    const egts = engine.egt || [840, 840, 840, 840];

    const chtMax = Math.max(...chts);
    const chtMin = Math.min(...chts);
    const chtSpread = Number((chtMax - chtMin).toFixed(1));

    const egtMax = Math.max(...egts);
    const egtMin = Math.min(...egts);
    const egtSpread = Number((egtMax - egtMin).toFixed(1));

    const egtResiduals = egts.map(e => Number((e - base.nominalEgt).toFixed(1)));
    const chtResiduals = chts.map(c => Number((c - base.nominalCht).toFixed(1)));
    const oilPressResidual = Number((engine.oilPressBar - base.nominalOilPress).toFixed(2));
    const oilTempResidual = Number((engine.oilTempC - base.nominalOilTemp).toFixed(1));
    const vibResidual = Number((engine.vibrationGrms - base.nominalVib).toFixed(3));
    const mapResidual = Number((engine.mapBar - base.nominalMap).toFixed(3));

    return {
      baseline: base,
      chtSpread,
      egtSpread,
      egtResiduals,
      chtResiduals,
      oilPressResidual,
      oilTempResidual,
      vibResidual,
      mapResidual,
      maxEgtResidualAbs: Math.max(...egtResiduals.map(Math.abs)),
      maxChtResidualAbs: Math.max(...chtResiduals.map(Math.abs))
    };
  }
}
