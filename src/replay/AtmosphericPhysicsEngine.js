/**
 * Atmospheric & Environmental Physics Engine
 * Grounded in ISA 1976 (International Standard Atmosphere)
 * Computes real-time barometric pressure, density altitude,
 * turbo compressor pressure ratio (PR), radiator forced-convection heat flux,
 * and environmental scenario compensations for Rotax 915/916 iS MALE UAVs.
 */

import { PHYS, ambientFactors } from '../engine/EngineSimulator.js';

// ISA deviation range the AI models were trained and validated on (training/generate_dataset.mjs)
export const AI_VALIDATED_ISA_DEV_C = [-20, 25];
export const AI_VALIDATED_ALT_FT = [0, 23000];

export class AtmosphericPhysicsEngine {
  // ISA 1976 Physical Constants
  static P0 = 1013.25;        // Sea level standard atmospheric pressure (hPa)
  static T0 = 288.15;         // Sea level standard temperature (Kelvin / 15°C)
  static RHO0 = 1.225;        // Sea level dry air density (kg/m³)
  static LAPSE_RATE = 0.0065; // Standard temperature lapse rate (K/m)
  static G = 9.80665;         // Gravitational acceleration (m/s²)
  static M = 0.0289644;       // Molar mass of Earth's dry air (kg/mol)
  static R = 8.31447;         // Universal gas constant (J/(mol·K))
  static R_SPECIFIC = 287.058;// Specific gas constant for dry air (J/(kg·K))
  static FT_TO_M = 0.3048;    // Feet to meters conversion

  // 9 Aerospace-Grade Environmental Mission Scenarios
  static SCENARIO_PRESETS = [
    {
      id: 'HIGH_ALT_FL220',
      aliases: ['HIGH_ALT', 'HIGH_ALT_FL220', 'HIGH_ALT_FL280'],
      label: 'HIGH-ALT FL220',
      shortLabel: 'FL220 HIGH-ALT',
      icon: 'Mountain',
      altFt: 22000,
      tempC: -28,
      payload: '85 kg (EO/IR + SAR)',
      headwindKts: 38,
      humidityPct: 15,
      description: 'High-altitude standoff surveillance with wastegate MAP clamping.'
    },
    {
      id: 'HIGH_ALT_FL200',
      aliases: ['HIGH_ALT_FL200'],
      label: 'HIGH-ALT FL200',
      shortLabel: 'FL200 PATROL',
      icon: 'Plane',
      altFt: 20000,
      tempC: -22,
      payload: '90 kg (Optronic Gimbal)',
      headwindKts: 32,
      humidityPct: 25,
      description: 'Intermediate altitude loiter optimized for minimum specific fuel consumption.'
    },
    {
      id: 'HOT_DESERT',
      aliases: ['HOT_DESERT'],
      label: 'HOT DESERT +48°C',
      shortLabel: 'DESERT +48°C',
      icon: 'Sun',
      altFt: 2500,
      tempC: 48,
      payload: '95 kg (Dual EO/IR)',
      headwindKts: 18,
      humidityPct: 10,
      description: 'Severe desert heat testing cooling loop and oil thermal oxidation.'
    },
    {
      id: 'MARITIME',
      aliases: ['MARITIME'],
      label: 'MARITIME RELAY',
      shortLabel: 'MARITIME RELAY',
      icon: 'Waves',
      altFt: 1200,
      tempC: 18,
      payload: '75 kg (AIS + SATCOM)',
      headwindKts: 24,
      humidityPct: 85,
      description: 'Marine boundary layer relay with dense salt air and high humidity.'
    },
    {
      id: 'ARCTIC_SOAK',
      aliases: ['ARCTIC_SOAK'],
      label: 'ARCTIC SOAK -45°C',
      shortLabel: 'ARCTIC -45°C',
      icon: 'Snowflake',
      altFt: 8000,
      tempC: -45,
      payload: '85 kg (IPS De-Ice +3.5kW)',
      headwindKts: 42,
      humidityPct: 55,
      description: 'Extreme polar deep freeze; tests high fluid viscosity and radiator bypass.'
    },
    {
      id: 'MONSOON',
      aliases: ['MONSOON'],
      label: 'MONSOON +35°C',
      shortLabel: 'MONSOON +35°C',
      icon: 'CloudRain',
      altFt: 4500,
      tempC: 35,
      payload: '80 kg (SAR Weather Penetrator)',
      headwindKts: 46,
      humidityPct: 95,
      description: 'Heavy tropical convection with high moisture displacement of air density.'
    },
    {
      id: 'FL230_CEILING',
      aliases: ['FL230_CEILING', 'FL300_CEILING'],
      label: 'FL230 SERVICE CEILING',
      shortLabel: 'FL230 CEILING',
      icon: 'Zap',
      altFt: 23000,
      tempC: -31,
      payload: '65 kg (Minimal Standoff Pod)',
      headwindKts: 55,
      humidityPct: 8,
      description: 'Rotax 915 iS service ceiling (~23,000 ft) with maximum turbo duty.'
    },
    {
      id: 'TERRAIN_MASK',
      aliases: ['TERRAIN_MASK'],
      label: 'TERRAIN MASK 500FT',
      shortLabel: 'TERRAIN 500FT',
      icon: 'Crosshair',
      altFt: 500,
      tempC: 30,
      payload: '100 kg (Full Weapons Loadout)',
      headwindKts: 22,
      humidityPct: 45,
      description: 'Low-level terrain masking with high-density cyclic throttle turbulence.'
    },
    {
      id: 'ULTRA_LOITER',
      aliases: ['ULTRA_LOITER'],
      label: 'ULTRA-LOITER ECO',
      shortLabel: 'ULTRA-LOITER',
      icon: 'Clock',
      altFt: 22000,
      tempC: -18,
      payload: '70 kg (Endurance Pod)',
      headwindKts: 15,
      humidityPct: 20,
      description: 'Long-endurance loiter at FL220 (scenario; lambda held at the ECU target, no lean-burn mode modelled).'
    }
  ];

  /**
   * Fast lookup map for scenario presets keyed by ID and aliases
   */
  static get PRESETS() {
    const map = {};
    for (const p of this.SCENARIO_PRESETS) {
      const obj = {
        ...p,
        altitudeFt: p.altFt,
        deltaIsaTempC: p.tempC,
        payloadStr: p.payload,
        headwindKts: p.headwindKts
      };
      map[p.id] = obj;
      if (p.aliases) {
        for (const alias of p.aliases) {
          map[alias] = obj;
        }
      }
    }
    return map;
  }

  /**
   * Computes ISA 1976 physical aerothermal derivations
   * @param {number} altitudeFt - Pressure altitude in feet (0 to 30,000)
   * @param {number} ambientTempC - Ambient static temperature in °C (-50 to +50)
   * @param {number} airspeedKts - Indicated airspeed in knots
   */
  static computeDerivations(altitudeFt = 28000, ambientTempC = -28, airspeedKts = 104) {
    const hMeters = Math.max(0, altitudeFt) * this.FT_TO_M;
    const tempK = Math.max(200, ambientTempC + 273.15);

    // 1. Barometric Pressure via Barometric Formula (ISA 1976 Troposphere)
    // p = p0 * (1 - L*h/T0)^(g*M / (R*L))
    // Exponent: g*M / (R*L) = 5.25588
    const pressureRatio = Math.pow(Math.max(0.01, 1 - (this.LAPSE_RATE * hMeters) / this.T0), 5.25588);
    const atmosphericPressureHpa = Number((this.P0 * pressureRatio).toFixed(1));
    const atmosphericPressureBar = atmosphericPressureHpa / 1000.0;

    // 2. Air Density (Ideal Gas Law: rho = p / (R_specific * T))
    const pressurePa = atmosphericPressureHpa * 100.0;
    const airDensityKgM3 = Number((pressurePa / (this.R_SPECIFIC * tempK)).toFixed(3));
    const densityRatio = Number((airDensityKgM3 / this.RHO0).toFixed(2));

    // 3. Turbo pressure ratio at the ISR-orbit operating point (75 % throttle), same model as the twin:
    // MAP is held at target until ambient x PR_MAX runs out, then delivered power falls
    const af = ambientFactors(75, atmosphericPressureBar, ambientTempC);
    const requiredPr = af.mapTarget / atmosphericPressureBar;
    const turboCompensatorRatio = Number(Math.min(PHYS.PR_MAX, Math.max(1.0, requiredPr)).toFixed(2));
    const achievableMapBar = Number(af.map.toFixed(2));
    const powerFractionPct = Math.round(af.pf * 100);

    // 4. Radiator Forced-Convection Heat Flux (kW)
    // Rotax 915 iS heat rejection: Q_nominal ~ 24 kW at cruise
    const coolantTargetC = 88.0;
    const deltaT = Math.max(10, coolantTargetC - ambientTempC);
    const speedRatio = (airspeedKts || 104) / 104;
    const densityFactor = airDensityKgM3 / 1.194;
    const radiatorHeatFluxKw = Number(
      Math.min(48.0, Math.max(8.0, 23.9 * Math.sqrt(densityFactor) * speedRatio * (deltaT / 116.0))).toFixed(1)
    );

    return {
      altitudeFt,
      ambientTempC,
      // Deviation from ISA standard temperature at this altitude (T_isa = 15 - 6.5 °C/km)
      deltaIsaC: Number((ambientTempC - (15.0 - this.LAPSE_RATE * hMeters)).toFixed(1)),
      atmosphericPressureHpa,
      airDensityKgM3,
      densityRatio,
      turboCompensatorRatio,
      requiredPr: Number(requiredPr.toFixed(2)),
      prMax: PHYS.PR_MAX,
      achievableMapBar,
      powerFractionPct,
      radiatorHeatFluxKw
    };
  }

  /**
   * Adjusts base mission telemetry dynamically to reflect the physical environment of the active scenario
   */
  static getScenarioAdjustedTelemetry(baseTelemetry, scenarioId, altitudeFt, tempC, activePhaseId = 7) {
    if (!baseTelemetry) return baseTelemetry;

    const t = { ...baseTelemetry };
    const temp = tempC !== undefined ? tempC : -28;
    const alt = altitudeFt !== undefined ? altitudeFt : 28000;
    const isGroundPhase = activePhaseId === 0 || activePhaseId === 7; // PRE-FLIGHT or RECOVERY

    // 1. Temperature Deltas for CHT and Oil Temp
    const ambientDelta = temp - 15; // Deviation from standard 15°C

    if (isGroundPhase) {
      // On ground (engine off or idling on runway)
      if (activePhaseId === 0) {
        // PRE-FLIGHT: Engine cold / tarmac soaked
        const preflightT = Math.max(15, Math.round(temp));
        t.cht = `${preflightT}.0 °C`;
        t.oilT = `${preflightT}.0 °C`;
      } else {
        // RECOVERY: Touchdown cooldown
        const recoveryCht = Math.round(100.4 + ambientDelta * 0.25);
        const recoveryOilT = Math.round(90.3 + ambientDelta * 0.22);
        t.cht = `${recoveryCht}.0 °C`;
        t.oilT = `${recoveryOilT}.0 °C`;
      }
    }
    // In flight, CHT / oil temperature already include OAT and air density (twin physics in MissionPredictor)

    // 2. Oil Pressure responding to viscosity
    // Cold oil is thick -> higher pressure; Hot oil is thin -> lower pressure
    const baseOilPNum = parseFloat(baseTelemetry.oilP) || 48.0;
    if (baseOilPNum > 5) { // Only if engine is running
      const viscosityFactor = (15 - temp) * 0.18; // Cold = positive boost
      const adjustedOilP = Math.max(25, Math.min(78, baseOilPNum + viscosityFactor)).toFixed(1);
      const adjustedOilBar = (adjustedOilP * 0.0689476).toFixed(2);
      t.oilP = `${adjustedOilP} PSI`;
      t.oilPSub = `${adjustedOilBar} bar`;
    }

    // 3. Flight Level & Altitude adjustment for cruise phases (Phases 3, 4, 5)
    if (!isGroundPhase && (activePhaseId === 3 || activePhaseId === 4 || activePhaseId === 5)) {
      t.alt = `${alt} FT`;
      t.flTag = `FL${Math.round(alt / 100)}`;
    }

    // 4. Scenario-Specific Physical Characterizations
    if (scenarioId === 'ARCTIC_SOAK' || temp < -35) {
      if (parseFloat(t.oilP) > 5) {
        t.oilP = `${Math.min(76, parseFloat(t.oilP) + 8).toFixed(1)} PSI`;
      }
    } else if (scenarioId === 'HOT_DESERT' || temp > 40) {
      if (parseFloat(t.oilP) > 5) {
        t.oilP = `${Math.max(38, parseFloat(t.oilP) - 4).toFixed(1)} PSI`;
      }
    } else if (scenarioId === 'MONSOON') {
      const vibVal = parseFloat(t.vib) || 0.038;
      t.vib = `${(vibVal + 0.012).toFixed(3)} IPS`;
    } else if (scenarioId === 'TERRAIN_MASK') {
      if (activePhaseId >= 2 && activePhaseId <= 6) {
        t.alt = '500 FT';
        t.flTag = 'AGL';
        const vibVal = parseFloat(t.vib) || 0.038;
        t.vib = `${(vibVal + 0.009).toFixed(3)} IPS`;
      }
    } else if (scenarioId === 'HIGH_ALT_FL200') {
      if (activePhaseId >= 3 && activePhaseId <= 5) {
        t.alt = '20000 FT';
        t.flTag = 'FL200';
      }
    } else if (scenarioId === 'FL230_CEILING') {
      if (activePhaseId >= 3 && activePhaseId <= 5) {
        t.alt = '23000 FT';
        t.flTag = 'FL230';
      }
    } else if (scenarioId === 'ULTRA_LOITER') {
      if (activePhaseId >= 3 && activePhaseId <= 5) {
        t.alt = '22000 FT';
        t.flTag = 'FL220';
      }
    }

    return t;
  }
}
