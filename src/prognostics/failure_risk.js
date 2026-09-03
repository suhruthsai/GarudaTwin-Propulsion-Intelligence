/**
 * Failure Risk & Multi-Horizon Reliability Model
 * Calculates cumulative failure probability using Weibull hazard formulations
 * and evaluates multi-horizon risk (1 hr, 4 hr, 8 hr, 24 hr).
 */

export class FailureRiskModel {
  static evaluate(edi, rulHours, trend, activeRatePerHour) {
    const beta = trend === 'RAPIDLY DEGRADING' ? 2.2 : trend === 'DEGRADING' ? 1.6 : 1.2;
    const eta = 60.0; // characteristic degradation scale

    // Cumulative failure probability 0-1
    const pFail = Math.min(0.99, 1.0 - Math.exp(-Math.pow(edi / eta, beta)));
    const riskPct = Number((pFail * 100.0).toFixed(1));

    let riskLevel = 'LOW';
    if (riskPct >= 65.0 || rulHours < 2.0) {
      riskLevel = 'CRITICAL';
    } else if (riskPct >= 25.0 || rulHours < 10.0) {
      riskLevel = 'HIGH';
    } else if (riskPct >= 8.0 || rulHours < 50.0) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }

    // Multi-horizon risk projection: risk over 1h, 4h, 8h, 24h
    const projectRisk = (hours) => {
      const projectedEdi = Math.min(100.0, edi + activeRatePerHour * hours * 18.0);
      const pf = Math.min(0.99, 1.0 - Math.exp(-Math.pow(projectedEdi / eta, beta)));
      return Number((pf * 100.0).toFixed(1));
    };

    const multiHorizon = {
      h1: projectRisk(1.0),
      h4: projectRisk(4.0),
      h8: projectRisk(8.0),
      h24: projectRisk(24.0)
    };

    return {
      riskScore: pFail,
      riskPct,
      riskLevel,
      multiHorizon
    };
  }
}
