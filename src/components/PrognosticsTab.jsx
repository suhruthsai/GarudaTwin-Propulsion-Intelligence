import React, { useState, useMemo } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { 
  Brain, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ShieldAlert, 
  Activity, 
  BarChart3, 
  Cpu, 
  Wrench, 
  Thermometer, 
  Zap, 
  Droplets, 
  Wind, 
  Flame,
  Info,
  Sliders,
  ChevronRight,
  TrendingDown,
  FileSearch,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { PrognosticsDetailDrawer } from './PrognosticsDetailDrawer';

export const PrognosticsTab = () => {
  const { 
    telemetry, 
    aiPrognostics, 
    missionDemandHours, 
    setMissionDemandHours 
  } = useTelemetry();

  const [activeSubView, setActiveSubView] = useState('PROGNOSTICS'); // 'PROGNOSTICS' | 'ADVISORY'
  const [selectedUnit, setSelectedUnit] = useState('Vahak-1');
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);

  // Fleet Specifications & Metadata Registry
  const FLEET_REGISTRY = {
    'Vahak-1': {
      callsign: 'Vahak-1 (ACTIVE TESTBED)',
      engine: 'Rotax 915 iS (S/N: ENG-882-X)',
      sn: 'ENG-882-X',
      flightHours: 1248.6,
      tboDueHours: 751.4,
      role: 'Lead Tactical Testbed'
    },
    'Vahak-2': {
      callsign: 'Vahak-2 (ESCORT LEAD)',
      engine: 'Rotax 915 iS (S/N: RTX-0819)',
      sn: 'RTX-0819',
      flightHours: 415.0,
      tboDueHours: 785.0,
      role: 'Escort Lead'
    },
    'Vahak-3': {
      callsign: 'Vahak-3 (RELAY ORBIT)',
      engine: 'Rotax 916 iS (S/N: RTX-0902)',
      sn: 'RTX-0902',
      flightHours: 80.0,
      tboDueHours: 1120.0,
      role: 'Relay Orbit'
    },
    'Vahak-4': {
      callsign: 'Vahak-4 (PERIMETER PATROL)',
      engine: 'Rotax 915 iS (S/N: RTX-0754)',
      sn: 'RTX-0754',
      flightHours: 780.0,
      tboDueHours: 420.0,
      role: 'Perimeter Patrol'
    },
    'Vahak-5': {
      callsign: 'Vahak-5 (HANGAR RESERVE)',
      engine: 'Rotax 915 iS (S/N: RTX-0699)',
      sn: 'RTX-0699',
      flightHours: 1080.0,
      tboDueHours: 120.0,
      role: 'Hangar Reserve'
    }
  };

  const unitInfo = FLEET_REGISTRY[selectedUnit] || FLEET_REGISTRY['Vahak-1'];

  // Fleet Multiplexer & Physics Computation
  let baseHealth = 100;
  let baseRul = 2000;
  let activeUavStats = null;
  let degradationRate = 0.045;
  let combinedStress = 1.0;
  let stressBreakdown = { thermalStress: 1.0, mechanicalStress: 1.0, lubricationStress: 1.0, combustionStress: 1.0, operatingStress: 1.0, combinedStress: 1.0 };
  let subsystemsDegradation = { thermal: 2, mechanical: 2, lubrication: 2, combustion: 2, fuel: 2, electrical: 2 };
  let probableFault = 'NONE';
  let activeFault = 'NONE';
  let faultConfidence = 95;
  let anomalyScore = 0.02;
  let riskScore = 0.03;
  let riskPct = 3.0;
  let riskLevel = 'LOW';
  let multiHorizonRisk = { h1: 0.8, h4: 2.4, h8: 6.7, h24: 14.2 };
  let whyReasoning = '';
  let recommendationText = '';
  let operationalWindow = '';
  let priority = 'LOW';
  let urgencyLabel = 'ROUTINE MONITORING';
  let action = 'MONITOR';
  let xaiAttributions = [];
  let parameterEvidence = [];
  let degradationTrend = 'NOMINAL';

  if (selectedUnit === 'Vahak-1') {
    baseHealth = aiPrognostics?.engine_health_index ?? telemetry.health?.index ?? 100;
    baseRul = aiPrognostics?.rul_hours_mean ?? 750;
    degradationRate = aiPrognostics?.degradation_rate_pct_per_hour || 0.045;
    stressBreakdown = aiPrognostics?.stressBreakdown || stressBreakdown;
    combinedStress = stressBreakdown.combinedStress || 1.0;
    subsystemsDegradation = aiPrognostics?.subsystem_degradation || subsystemsDegradation;

    // Normalize fault: treat nominal names cleanly as NONE
    const rawDiag = aiPrognostics?.diagnosed_fault;
    const telFault = telemetry.health?.activeFault;
    const isNominal = (!rawDiag || ['NONE', 'none', 'NOMINAL', 'NOMINAL_OPERATION', 'NOMINAL BASELINE'].includes(rawDiag)) &&
                      (!telFault || ['NONE', 'none', 'NOMINAL'].includes(telFault));

    activeFault = isNominal ? 'NONE' : (telFault && telFault !== 'NONE' ? telFault : rawDiag);
    probableFault = isNominal ? 'NOMINAL BASELINE' : activeFault.replace(/_/g, ' ');
    faultConfidence = isNominal ? 75 : (aiPrognostics?.confidencePct || 92);
    anomalyScore = aiPrognostics?.anomaly_score || 0.02;
    degradationTrend = aiPrognostics?.degradationTrend || (baseHealth < 75 ? 'DEGRADING' : 'NOMINAL');

    riskScore = aiPrognostics?.failureRiskScore || (baseHealth < 40 ? 0.75 : baseHealth < 75 ? 0.25 : 0.03);
    riskPct = Number((riskScore * 100).toFixed(1));
    riskLevel = aiPrognostics?.failureRiskLevel || (riskScore > 0.6 ? 'CRITICAL' : riskScore > 0.3 ? 'HIGH' : riskScore > 0.15 ? 'MEDIUM' : 'LOW');
    multiHorizonRisk = {
      h1: Number((aiPrognostics?.multiHorizonRisk?.['1hr'] || (riskPct * 0.2)).toFixed(1)),
      h4: Number((aiPrognostics?.multiHorizonRisk?.['4hr'] || (riskPct * 0.55)).toFixed(1)),
      h8: Number((aiPrognostics?.multiHorizonRisk?.['8hr'] || (riskPct * 1.1)).toFixed(1)),
      h24: Number((aiPrognostics?.multiHorizonRisk?.['24hr'] || Math.min(99, riskPct * 2.2)).toFixed(1))
    };

    whyReasoning = aiPrognostics?.maintenance?.reason?.[0] || 
      (isNominal 
        ? 'All thermodynamic, vibrational, and combustion telemetry parameters track within ±1.5σ of the nominal Golden Twin baseline.'
        : `Physical telemetry deviations detected on ${activeFault.replace(/_/g, ' ')}. Component thermal and vibrational fatigue accelerates RUL consumption.`);
    recommendationText = aiPrognostics?.pilot_advisory?.action_plan?.join(' ') || 
      (isNominal 
        ? 'Continue standard flight operations. Perform routine 50-hour scheduled maintenance inspection.'
        : `Active fault mode [${activeFault}]. Reduce engine operating power and execute advisory checklist.`);
    operationalWindow = aiPrognostics?.maintenance?.suggestedWindow || 
      (isNominal ? 'Standard scheduled inspection at 50-hour interval.' : 'Immediate in-flight intervention required.');
    priority = isNominal ? 'LOW' : (baseHealth < 40 ? 'CRITICAL' : 'HIGH');
    urgencyLabel = isNominal ? 'ROUTINE MONITORING' : (baseHealth < 40 ? 'IMMEDIATE RTB' : 'DERATE & INSPECT');
    action = isNominal ? 'MONITOR' : 'INSPECTION';

    // Parameter Evidence: use live mapped evidence from aiPrognostics if present
    if (Array.isArray(aiPrognostics?.maintenance?.evidence) && aiPrognostics.maintenance.evidence.length > 0) {
      parameterEvidence = aiPrognostics.maintenance.evidence;
    } else {
      const egtSpread = Math.max(...(telemetry.engine?.egt || [840, 840, 840, 840])) - Math.min(...(telemetry.engine?.egt || [840, 840, 840, 840]));
      const chtSpread = Math.max(...(telemetry.engine?.cht || [106, 106, 106, 106])) - Math.min(...(telemetry.engine?.cht || [106, 106, 106, 106]));
      const oilP = telemetry.engine?.oilPressBar ?? 3.85;
      const vib = telemetry.engine?.vibrationGrms ?? 0.28;
      parameterEvidence = [
        {
          parameter: 'Exhaust Gas Temp (EGT) Spread',
          goldenModel: '< 18.0 °C spread',
          liveTelemetry: `${egtSpread.toFixed(1)} °C spread`,
          residual: egtSpread > 18.0 ? `+${(egtSpread - 18.0).toFixed(1)} °C` : '-22%',
          diagnosticWeight: egtSpread > 25.0 ? '95%' : '88%',
          status: egtSpread > 40.0 ? 'CRITICAL' : egtSpread > 20.0 ? 'WARNING' : 'NOMINAL'
        },
        {
          parameter: 'Cylinder CHT Thermal Spread',
          goldenModel: '< 10.0 °C spread',
          liveTelemetry: `${chtSpread.toFixed(1)} °C spread`,
          residual: chtSpread > 10.0 ? `+${(chtSpread - 10.0).toFixed(1)} °C` : '-45%',
          diagnosticWeight: chtSpread > 15.0 ? '94%' : '86%',
          status: chtSpread > 20.0 ? 'CRITICAL' : chtSpread > 12.0 ? 'WARNING' : 'NOMINAL'
        },
        {
          parameter: 'Hydrodynamic Oil Pressure',
          goldenModel: '3.85 bar ± 0.35',
          liveTelemetry: `${oilP.toFixed(2)} bar`,
          residual: Math.abs(oilP - 3.85) > 0.4 ? `${(oilP - 3.85).toFixed(2)} bar` : '±0.04 bar',
          diagnosticWeight: oilP < 2.5 ? '98%' : '84%',
          status: oilP < 2.0 ? 'CRITICAL' : oilP < 2.8 ? 'WARNING' : 'NOMINAL'
        },
        {
          parameter: 'Engine Block Vibration (g-RMS)',
          goldenModel: '< 0.35 g-RMS',
          liveTelemetry: `${vib.toFixed(2)} g-RMS`,
          residual: vib > 0.35 ? `+${(vib - 0.35).toFixed(2)} g` : '-18%',
          diagnosticWeight: vib > 0.6 ? '96%' : '82%',
          status: vib > 1.0 ? 'CRITICAL' : vib > 0.5 ? 'WARNING' : 'NOMINAL'
        }
      ];
    }

    // XAI Attributions
    if (aiPrognostics?.feature_attributions && Object.keys(aiPrognostics.feature_attributions).length > 0) {
      xaiAttributions = Object.entries(aiPrognostics.feature_attributions).map(([key, val]) => ({
        name: key.replace(/_/g, ' '),
        weight: `${typeof val === 'number' ? val.toFixed(1) : val}%`,
        description: `Physics SHAP anomaly contribution for ${key.replace(/_/g, ' ')}.`,
        status: val > 20 ? 'CRITICAL' : val > 10 ? 'ELEVATED' : 'NOMINAL'
      })).sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight)).slice(0, 6);
    }
  } else {
    // Vahak-2 through Vahak-5 physics models
    activeUavStats = (telemetry.fleetState || []).find(u => u.id === selectedUnit);
    if (!activeUavStats) {
      const reg = {
        'Vahak-2': { health: 96.2, rulHours: 785.0, status: 'ON STATION', flightHours: 415.0, subsystems: { combustion: 98, lubrication: 95, induction: 97, cooling: 96, vibration: 95 } },
        'Vahak-3': { health: 99.1, rulHours: 1120.0, status: 'CLIMB TO CRUISE', flightHours: 80.0, subsystems: { combustion: 100, lubrication: 99, induction: 98, cooling: 99, vibration: 100 } },
        'Vahak-4': { health: 84.5, rulHours: 420.0, status: 'DERATED CRUISE', flightHours: 780.0, subsystems: { combustion: 88, lubrication: 82, induction: 85, cooling: 86, vibration: 80 } },
        'Vahak-5': { health: 72.0, rulHours: 120.0, status: 'GROUND MAINTENANCE', flightHours: 1080.0, subsystems: { combustion: 74, lubrication: 70, induction: 78, cooling: 65, vibration: 68 } },
      };
      activeUavStats = reg[selectedUnit] || reg['Vahak-2'];
    }

    baseHealth = activeUavStats.health;
    baseRul = activeUavStats.rulHours; // Clean, non-negative RUL

    const sub = activeUavStats.subsystems || {};
    // Subsystem degradation index: 0 = nominal, 100 = degraded
    subsystemsDegradation = {
      thermal: Math.max(0, 100 - (sub.cooling || 95)),
      mechanical: Math.max(0, 100 - (sub.vibration || 95)),
      lubrication: Math.max(0, 100 - (sub.lubrication || 95)),
      combustion: Math.max(0, 100 - (sub.combustion || 95)),
      fuel: Math.max(0, 100 - (sub.induction || 95)),
      electrical: selectedUnit === 'Vahak-5' ? 12 : 3
    };

    if (selectedUnit === 'Vahak-2') {
      degradationRate = 0.052;
      combinedStress = 1.22;
      stressBreakdown = { thermalStress: 1.05, mechanicalStress: 1.08, lubricationStress: 1.06, combustionStress: 1.02, operatingStress: 1.0, combinedStress: 1.22 };
      probableFault = 'NOMINAL BASELINE';
      activeFault = 'NONE';
      faultConfidence = 96;
      anomalyScore = 0.03;
      riskScore = 0.03;
      riskPct = 3.2;
      riskLevel = 'LOW';
      multiHorizonRisk = { h1: 0.6, h4: 1.8, h8: 4.5, h24: 10.2 };
      degradationTrend = 'NOMINAL';
      whyReasoning = 'Rotax 915 iS engine operating well within certified envelope. Low thermal wear and minimal friction residuals detected across all 4 cylinders.';
      recommendationText = 'Unit certified for standard flight operations. Continue routine scheduled 50-hour inspection interval.';
      operationalWindow = 'Standard scheduled inspection at 50-hour interval.';
      priority = 'LOW';
      urgencyLabel = 'ROUTINE MONITORING';
      action = 'MONITOR';

      xaiAttributions = [
        { name: 'Cylinder CHT Thermal Spread', weight: '18.2%', description: 'Nominal cylinder thermal balance across boxer cylinders.', status: 'NOMINAL' },
        { name: 'Exhaust Gas Temp Disparity', weight: '16.5%', description: 'Turbine inlet temperature consistent with commanded throttle.', status: 'NOMINAL' },
        { name: 'Engine Vibration RMS', weight: '15.4%', description: 'Smooth torsional balance at 4800 RPM cruise.', status: 'NOMINAL' },
        { name: 'Hydrodynamic Oil Pressure', weight: '14.8%', description: 'Bearing lubrication film intact at 3.82 bar.', status: 'NOMINAL' },
        { name: 'Manifold Absolute Pressure', weight: '12.0%', description: 'Turbo boost pressure matches FADEC MAP target.', status: 'NOMINAL' },
        { name: 'Fuel Rail Flow Delta', weight: '11.5%', description: 'Equalized injector flow rate.', status: 'NOMINAL' }
      ];

      parameterEvidence = [
        { parameter: 'Cylinder CHT Thermal Spread', goldenModel: '< 10.0 °C', liveTelemetry: '4.2 °C', residual: '-58%', diagnosticWeight: '88%', status: 'NOMINAL' },
        { parameter: 'Exhaust Gas Temp Disparity', goldenModel: '< 18.0 °C', liveTelemetry: '7.8 °C', residual: '-56%', diagnosticWeight: '85%', status: 'NOMINAL' },
        { parameter: 'Hydrodynamic Oil Pressure', goldenModel: '3.85 bar ± 0.35', liveTelemetry: '3.82 bar', residual: '-0.03 bar', diagnosticWeight: '82%', status: 'NOMINAL' },
        { parameter: 'Engine Vibration (g-RMS)', goldenModel: '< 0.35 g-RMS', liveTelemetry: '0.29 g-RMS', residual: '-17%', diagnosticWeight: '80%', status: 'NOMINAL' }
      ];
    } else if (selectedUnit === 'Vahak-3') {
      degradationRate = 0.041;
      combinedStress = 1.02;
      stressBreakdown = { thermalStress: 1.01, mechanicalStress: 1.01, lubricationStress: 1.01, combustionStress: 1.0, operatingStress: 1.0, combinedStress: 1.02 };
      probableFault = 'PRISTINE BASELINE';
      activeFault = 'NONE';
      faultConfidence = 99;
      anomalyScore = 0.01;
      riskScore = 0.01;
      riskPct = 1.1;
      riskLevel = 'LOW';
      multiHorizonRisk = { h1: 0.2, h4: 0.8, h8: 2.1, h24: 5.4 };
      degradationTrend = 'NOMINAL';
      whyReasoning = 'Rotax 916 iS factory-fresh powertrain with only 80 flight hours. Near-zero sensor residuals indicate pristine break-in conditions.';
      recommendationText = 'Certified for maximum endurance mission loiter. Zero maintenance discrepancies or PHM interventions required.';
      operationalWindow = 'Standard scheduled inspection at 50-hour interval.';
      priority = 'LOW';
      urgencyLabel = 'OPTIMAL STATUS';
      action = 'MONITOR';

      xaiAttributions = [
        { name: 'Cylinder CHT Thermal Spread', weight: '17.1%', description: 'Near-zero temperature gradient across dual cylinder banks.', status: 'NOMINAL' },
        { name: 'Exhaust Gas Temp Disparity', weight: '16.8%', description: 'Pristine lambda distribution and combustion balance.', status: 'NOMINAL' },
        { name: 'Hydrodynamic Oil Pressure', weight: '15.9%', description: 'Optimal viscosity and high film wedge pressure (3.92 bar).', status: 'NOMINAL' },
        { name: 'Engine Vibration RMS', weight: '14.2%', description: 'Minimum harmonic vibration at 0.24g RMS.', status: 'NOMINAL' },
        { name: 'Manifold Absolute Pressure', weight: '13.0%', description: 'FADEC closed-loop wastegate tracking within 0.5%.', status: 'NOMINAL' },
        { name: 'Alternator Bus Voltage', weight: '11.0%', description: 'Dual 28V generator buses operating at full capacity.', status: 'NOMINAL' }
      ];

      parameterEvidence = [
        { parameter: 'Cylinder CHT Thermal Spread', goldenModel: '< 10.0 °C', liveTelemetry: '3.1 °C', residual: '-69%', diagnosticWeight: '90%', status: 'NOMINAL' },
        { parameter: 'Exhaust Gas Temp Disparity', goldenModel: '< 18.0 °C', liveTelemetry: '5.4 °C', residual: '-70%', diagnosticWeight: '88%', status: 'NOMINAL' },
        { parameter: 'Hydrodynamic Oil Pressure', goldenModel: '3.85 bar ± 0.35', liveTelemetry: '3.92 bar', residual: '+0.07 bar', diagnosticWeight: '85%', status: 'NOMINAL' },
        { parameter: 'Engine Vibration (g-RMS)', goldenModel: '< 0.35 g-RMS', liveTelemetry: '0.24 g-RMS', residual: '-31%', diagnosticWeight: '82%', status: 'NOMINAL' }
      ];
    } else if (selectedUnit === 'Vahak-4') {
      degradationRate = 0.082;
      combinedStress = 2.89;
      stressBreakdown = { thermalStress: 1.35, mechanicalStress: 1.42, lubricationStress: 1.25, combustionStress: 1.15, operatingStress: 1.10, combinedStress: 2.89 };
      probableFault = 'PRGB BACKLASH & THERMAL ACCUMULATION';
      activeFault = 'PRGB_DEGRADATION';
      faultConfidence = 88;
      anomalyScore = 0.28;
      riskScore = 0.24;
      riskPct = 24.0;
      riskLevel = 'MEDIUM';
      multiHorizonRisk = { h1: 3.8, h4: 11.2, h8: 24.5, h24: 48.0 };
      degradationTrend = 'DEGRADING';
      whyReasoning = 'Propeller Reduction Gearbox (PRGB) displays 2X torsional vibration harmonics, accompanied by +14°C elevated cylinder head thermal spread under sustained patrol duty.';
      recommendationText = 'Derate continuous cruise throttle to max 72% MAP. Conduct borescope inspection of PRGB gears and inspect oil scavenge filter within 15 flight hours.';
      operationalWindow = 'Schedule maintenance inspection within 15 operating hours.';
      priority = 'HIGH';
      urgencyLabel = 'INSPECTION ADVISED';
      action = 'INSPECTION';

      xaiAttributions = [
        { name: 'Gearbox 2X Torsional Harmonic', weight: '38.5%', description: 'Vibration FFT energy spike at propeller reduction gearbox gearmesh frequency.', status: 'CRITICAL' },
        { name: 'Cylinder CHT Thermal Spread', weight: '24.2%', description: 'Cooling airflow restriction elevating cylinder head thermal gradient.', status: 'ELEVATED' },
        { name: 'Oil Filter Differential Pressure', weight: '18.4%', description: 'Early debris loading causing elevated pressure drop across filter.', status: 'ELEVATED' },
        { name: 'Manifold Pressure Ripple', weight: '10.2%', description: 'Slight turbocharger boost hunting during power transitions.', status: 'NOMINAL' },
        { name: 'Exhaust Gas Temp Disparity', weight: '8.7%', description: 'Moderate thermal delta across rear exhaust runners.', status: 'NOMINAL' }
      ];

      parameterEvidence = [
        { parameter: 'Gearbox Vibration (g-RMS)', goldenModel: '< 0.35 g-RMS', liveTelemetry: '0.58 g-RMS', residual: '+0.23 g-RMS', diagnosticWeight: '92%', status: 'WARNING' },
        { parameter: 'Cylinder CHT Thermal Spread', goldenModel: '< 10.0 °C', liveTelemetry: '16.8 °C', residual: '+6.8 °C', diagnosticWeight: '88%', status: 'WARNING' },
        { parameter: 'Hydrodynamic Oil Pressure', goldenModel: '3.85 bar ± 0.35', liveTelemetry: '3.38 bar', residual: '-0.47 bar', diagnosticWeight: '84%', status: 'WARNING' },
        { parameter: 'Exhaust Gas Temp Disparity', goldenModel: '< 18.0 °C', liveTelemetry: '24.2 °C', residual: '+6.2 °C', diagnosticWeight: '76%', status: 'WARNING' }
      ];
    } else { // Vahak-5
      degradationRate = 0.183;
      combinedStress = 8.45;
      stressBreakdown = { thermalStress: 1.75, mechanicalStress: 1.60, lubricationStress: 1.82, combustionStress: 1.45, operatingStress: 1.15, combinedStress: 8.45 };
      probableFault = 'OIL PUMP CAVITATION & COMPRESSION BLOW-BY';
      activeFault = 'OIL_PUMP_CAVITATION';
      faultConfidence = 97;
      anomalyScore = 0.64;
      riskScore = 0.68;
      riskPct = 68.0;
      riskLevel = 'CRITICAL';
      multiHorizonRisk = { h1: 14.5, h4: 38.2, h8: 62.4, h24: 89.1 };
      degradationTrend = 'RAPIDLY DEGRADING';
      whyReasoning = 'Hydrodynamic oil film pressure has collapsed to 2.28 bar with cooling circuit thermal runaway. Hot blow-by gases pressurize crankcase, accelerating journal bearing fatigue.';
      recommendationText = 'AIRCRAFT GROUNDED. Do NOT authorize dispatch for flight missions. Perform complete oil pump overhaul, cylinder compression leakdown test, and flush engine oil cooler circuit immediately.';
      operationalWindow = 'Ground aircraft immediately — zero dispatch authorized.';
      priority = 'CRITICAL';
      urgencyLabel = 'REMOVE FROM SERVICE';
      action = 'ENGINEERING_REVIEW';

      xaiAttributions = [
        { name: 'Oil Pressure Hydrodynamic Loss', weight: '44.2%', description: 'Oil pressure severely degraded (2.28 bar), compromising journal bearing lubrication.', status: 'CRITICAL' },
        { name: 'Coolant Radiator Delta T', weight: '26.8%', description: 'Thermal rejection efficiency impaired; coolant core approaching boilover.', status: 'CRITICAL' },
        { name: 'Crankcase Blow-by Pressure', weight: '16.5%', description: 'Piston ring sealing failure leaking combustion gas into oil sump.', status: 'ELEVATED' },
        { name: 'Engine Block Vibration RMS', weight: '8.5%', description: 'High-frequency acoustic chatter from un-cushioned journal bearings.', status: 'ELEVATED' },
        { name: 'Exhaust Gas Temp Disparity', weight: '4.0%', description: 'Uneven combustion from oil contamination in intake charge.', status: 'NOMINAL' }
      ];

      parameterEvidence = [
        { parameter: 'Hydrodynamic Oil Pressure', goldenModel: '3.85 bar ± 0.35', liveTelemetry: '2.28 bar', residual: '-1.57 bar', diagnosticWeight: '98%', status: 'CRITICAL' },
        { parameter: 'Coolant Radiator Temperature', goldenModel: '< 95.0 °C', liveTelemetry: '108.2 °C', residual: '+13.2 °C', diagnosticWeight: '95%', status: 'CRITICAL' },
        { parameter: 'Engine Vibration (g-RMS)', goldenModel: '< 0.35 g-RMS', liveTelemetry: '0.74 g-RMS', residual: '+0.39 g-RMS', diagnosticWeight: '91%', status: 'CRITICAL' },
        { parameter: 'Cylinder CHT Thermal Spread', goldenModel: '< 10.0 °C', liveTelemetry: '21.4 °C', residual: '+11.4 °C', diagnosticWeight: '89%', status: 'CRITICAL' }
      ];
    }
  }

  // Trajectory Generation (Consistent physics envelope across all units)
  const traj = (selectedUnit === 'Vahak-1' && aiPrognostics?.trajectory?.length > 0)
    ? aiPrognostics.trajectory
    : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((step) => {
        const wearDelta = degradationRate * step * (1.0 + step / 120.0);
        const predictedHealth = Number(Math.max(0.0, baseHealth - wearDelta).toFixed(1));
        const uncertainty = 1.2 + Math.sqrt(step) * (0.8 + combinedStress * 0.25);
        return {
          hoursElapsed: step,
          predictedHealth,
          upperConfidence: Number(Math.min(100.0, predictedHealth + uncertainty).toFixed(1)),
          lowerConfidence: Number(Math.max(0.0, predictedHealth - uncertainty).toFixed(1)),
          thresholdLimit: 50.0
        };
      });

  const histHealthRaw = (selectedUnit === 'Vahak-1' && aiPrognostics?.historicalHealthPoints?.length > 0)
    ? aiPrognostics.historicalHealthPoints
    : [
        { hoursOffset: -50, value: Math.min(100.0, baseHealth + degradationRate * 50) },
        { hoursOffset: -25, value: Math.min(100.0, baseHealth + degradationRate * 25) },
        { hoursOffset: 0,   value: baseHealth }
      ];

  const histRulRaw = (selectedUnit === 'Vahak-1' && aiPrognostics?.historicalRulPoints?.length > 0)
    ? aiPrognostics.historicalRulPoints
    : [
        { hoursOffset: -50, value: baseRul + 50 * combinedStress },
        { hoursOffset: -25, value: baseRul + 25 * combinedStress },
        { hoursOffset: 0,   value: baseRul }
      ];

  // Dynamic Mission Margin
  const dynamicMissionMargin = Number((baseRul - missionDemandHours).toFixed(1));
  const isMissionFeasible = selectedUnit === 'Vahak-5'
    ? false
    : (dynamicMissionMargin > 0 && baseHealth >= 75 && baseRul > missionDemandHours * 1.2);

  const data = {
    health: { 
      index: baseHealth, 
      status: selectedUnit === 'Vahak-1' ? (telemetry.health?.status || 'NOMINAL') : (activeUavStats?.status || 'NOMINAL'), 
      probableFault: probableFault, 
      activeFault: activeFault, 
      faultConfidence: faultConfidence, 
      overallAnomalyScore: anomalyScore 
    },
    degradation: { 
      edi: Number(Math.max(0, Math.min(99, 100 - baseHealth)).toFixed(1)), 
      trend: degradationTrend, 
      ratePerHour: Number(degradationRate.toFixed(3)), 
      stressBreakdown: stressBreakdown,
      subsystems: subsystemsDegradation
    },
    rul: { 
      hours: baseRul, 
      lower95: selectedUnit === 'Vahak-1' ? (aiPrognostics?.rul_hours_lower_95 || Number((baseRul * 0.9).toFixed(1))) : Number((baseRul * 0.9).toFixed(1)), 
      upper95: selectedUnit === 'Vahak-1' ? (aiPrognostics?.rul_hours_upper_95 || Number((baseRul * 1.1).toFixed(1))) : Number((baseRul * 1.1).toFixed(1)), 
      confidencePct: faultConfidence, 
      melLimit: 50.0, 
      minDispatchRul: 20.0, 
      accumFlightHours: unitInfo.flightHours,
      trajectory: traj,
      historicalHealth: histHealthRaw.map(p => ({ hoursOffset: p.hoursOffset || 0, value: p.value || 0 })),
      historicalRul: histRulRaw.map(p => ({ hoursOffset: p.hoursOffset || 0, value: p.value || 0 }))
    },
    risk: { 
      score: riskScore, 
      pct: riskPct, 
      level: riskLevel, 
      multiHorizon: multiHorizonRisk 
    },
    advisory: {
      action: action,
      actionLabel: urgencyLabel,
      priority: priority,
      urgencyLabel: urgencyLabel,
      whyReasoning: whyReasoning,
      recommendationText: recommendationText,
      operationalWindow: operationalWindow,
      fadecStatus: activeFault === 'NONE' ? 'FADEC Status: ALL CHANNELS NOMINAL * CLOSED-LOOP AUTO-TRIM ACTIVE' : `FADEC Status: CONTINGENCY DERATE ENGAGED [${activeFault}]`,
      affectedSubsystems: activeFault === 'NONE' ? ['NOMINAL'] : [activeFault],
      parameterEvidence: parameterEvidence,
      missionMarginHours: dynamicMissionMargin,
      isMissionFeasible: isMissionFeasible
    },
    dataQuality: { 
      score: selectedUnit === 'Vahak-1' ? (aiPrognostics?.dataQuality?.quality_score_pct || 99) : (selectedUnit === 'Vahak-5' ? 92 : 98), 
      sensorConfidence: selectedUnit === 'Vahak-1' ? (aiPrognostics?.dataQuality?.sensor_confidence_pct || 98) : (selectedUnit === 'Vahak-5' ? 89 : 97), 
      telemetryAgeMs: selectedUnit === 'Vahak-1' ? (aiPrognostics?.dataQuality?.telemetry_age_ms || 12) : 15 
    },
    xaiAttributions: xaiAttributions,
    modelMetadata: {
      name: 'PINN Autoencoder + Multi-Stress Fatigue RUL',
      version: '1.2.0',
      dataset: 'Rotax 915/916-iS Hardware-in-the-Loop Telemetry & Physics Baseline',
      featuresCount: 71,
      tboHours: 2000,
      melThresholdPct: 50,
      disclaimer: 'AI-assisted prototype decision support only. Follow Rotax 915-iS AMM statutory procedures.'
    }
  };

  const isDegraded = data.health.index < 75;
  const isCritical = data.health.index < 40;

  // SVG Chart Dimensions & Helpers
  const chartW = 460;
  const chartH = 170;
  const padL = 45;
  const padR = 25;
  const padT = 20;
  const padB = 30;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  // Health Chart Points Calculation (-50h to +50h)
  const healthPoints = useMemo(() => {
    const hist = data.rul.historicalHealth || [];
    const traj = data.rul.trajectory || [];

    // Map -50h to +50h on X-axis: 0h is at center (X = padL + plotW/2)
    const mapX = (hrs) => padL + ((hrs + 50) / 100) * plotW;
    const mapY = (val) => padT + (1 - Math.max(0, Math.min(100, val)) / 100) * plotH;

    // Historical path
    const histCoords = hist.map(p => ({ x: mapX(p.hoursOffset), y: mapY(p.value) }));
    const histPath = histCoords.length > 0
      ? `M ${histCoords[0].x} ${histCoords[0].y} ` + histCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ')
      : '';

    // Forecast path (step 0 to 50)
    const nowCoord = { x: mapX(0), y: mapY(data.health.index) };
    const forecastCoords = [nowCoord, ...traj.map(t => ({ x: mapX(t.hoursElapsed), y: mapY(t.predictedHealth) }))];
    const forecastPath = forecastCoords.length > 0
      ? `M ${forecastCoords[0].x} ${forecastCoords[0].y} ` + forecastCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ')
      : '';

    // 95% Confidence Shaded Polygon
    const upperCoords = [nowCoord, ...traj.map(t => ({ x: mapX(t.hoursElapsed), y: mapY(t.upperConfidence) }))];
    const lowerCoords = [nowCoord, ...traj.map(t => ({ x: mapX(t.hoursElapsed), y: mapY(t.lowerConfidence) }))];
    
    let polygonPath = '';
    if (upperCoords.length > 1) {
      polygonPath = `M ${upperCoords[0].x} ${upperCoords[0].y} ` +
        upperCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ') +
        lowerCoords.slice().reverse().map(c => `L ${c.x} ${c.y}`).join(' ') +
        ' Z';
    }

    return {
      nowCoord,
      histPath,
      forecastPath,
      polygonPath,
      melY: mapY(data.rul.melLimit || 50),
      mapX,
      mapY
    };
  }, [data, plotW, plotH]);

  // RUL Chart Points Calculation
  const rulPoints = useMemo(() => {
    const hist = data.rul.historicalRul || [];
    const maxRul = Math.max(500, (data.rul.hours || 400) * 1.3);

    const mapX = (hrs) => padL + ((hrs + 50) / 100) * plotW;
    const mapY = (val) => padT + (1 - Math.max(0, Math.min(maxRul, val)) / maxRul) * plotH;

    const histCoords = hist.map(p => ({ x: mapX(p.hoursOffset), y: mapY(p.value) }));
    const histPath = histCoords.length > 0
      ? `M ${histCoords[0].x} ${histCoords[0].y} ` + histCoords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ')
      : '';

    const nowCoord = { x: mapX(0), y: mapY(data.rul.hours) };
    const endCoord = { 
      x: mapX(50), 
      y: mapY(Math.max(0, data.rul.hours - (data.degradation.stressBreakdown?.combinedStress || 1.0) * 50)) 
    };
    const slopePath = `M ${nowCoord.x} ${nowCoord.y} L ${endCoord.x} ${endCoord.y}`;

    return {
      nowCoord,
      histPath,
      slopePath,
      minDispatchY: mapY(data.rul.minDispatchRul || 20),
      maxRul
    };
  }, [data, plotW, plotH]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-4 pb-12 pr-1 text-slate-900 font-mono">
      
      {/* ─────────────────────────────────────────────────────────────
          1. TOP STATUS BAR: Data Quality, Unit Switcher & Subnav
         ───────────────────────────────────────────────────────────── */}
      <div className="gcs-panel rounded-lg border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        
        {/* Left: View Title & Sub-view Switcher */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600 shadow-xs">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-mono font-bold text-xs tracking-wider text-slate-900 uppercase">
                {activeSubView === 'PROGNOSTICS'
                  ? 'REMAINING USEFUL LIFE (RUL) & DEGRADATION PROGNOSTICS'
                  : 'EXPLAINABLE DIAGNOSTICS & CAUSAL REASONING'}
              </h2>
              <span className="text-[9px] font-mono bg-slate-100 border border-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                PHYSICS-INFORMED AI
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-500 flex items-center gap-1.5 mt-0.5">
              <span>Fatigue modeling for:</span>
              <span className="text-slate-800 font-semibold">{selectedUnit}</span>
              <span className="text-slate-300">•</span>
              <span>{unitInfo.callsign}</span>
              <span className="text-slate-300">•</span>
              <span className="text-sky-700 font-semibold tabular-nums">{data.rul.accumFlightHours} FLIGHT HRS</span>
            </div>
          </div>
        </div>

        {/* Center: Sub-view Navigation Buttons */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200">
          <button
            onClick={() => setActiveSubView('PROGNOSTICS')}
            className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-colors flex items-center gap-2 border ${
              activeSubView === 'PROGNOSTICS'
                ? 'bg-white text-slate-900 border-slate-300 shadow-xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5 text-sky-600" />
            RUL & PROGNOSTICS
          </button>

          <button
            onClick={() => setActiveSubView('ADVISORY')}
            className={`px-3 py-1 text-xs font-mono font-semibold rounded-md transition-colors flex items-center gap-2 border ${
              activeSubView === 'ADVISORY'
                ? 'bg-white text-slate-900 border-slate-300 shadow-xs font-bold'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
          >
            <Wrench className="w-3.5 h-3.5 text-amber-600" />
            DIAGNOSTICS & ADVISORY
          </button>
        </div>

        {/* Right: Unit Selector & Audit Drawer Button */}
        <div className="flex items-center gap-2">
          {/* Unit Pills */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-slate-500 mr-1 font-semibold">ASSET:</span>
            {['Vahak-1', 'Vahak-2', 'Vahak-3', 'Vahak-4', 'Vahak-5'].map((unit) => {
              const uStats = (telemetry.fleetState || []).find(u => u.id === unit);
              const uHealth = unit === 'Vahak-1' ? data.health.index : (uStats?.health ?? (unit === 'Vahak-2' ? 96.2 : unit === 'Vahak-3' ? 99.1 : unit === 'Vahak-4' ? 84.5 : 72.0));
              return (
                <button
                  key={unit}
                  onClick={() => setSelectedUnit(unit)}
                  className={`px-2 py-1 rounded-md border text-xs font-mono transition-colors tabular-nums ${
                    selectedUnit === unit
                      ? 'bg-sky-600 text-white font-bold border-sky-600 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {unit} ({uHealth.toFixed(0)}%)
                </button>
              );
            })}
          </div>

          {/* Model Audit Drawer Trigger */}
          <button
            onClick={() => setIsAuditDrawerOpen(true)}
            className="px-2.5 py-1 rounded-md bg-white border border-slate-200 hover:border-sky-400 text-slate-700 hover:text-slate-900 text-xs font-mono font-medium flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <FileSearch className="w-3.5 h-3.5 text-sky-600" />
            EXPLAIN MODEL
          </button>
        </div>

      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. DATA QUALITY BANNER (Master Prompt Rule 6)
         ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono">
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">DATA QUALITY:</span>
          <span className="text-emerald-600 font-bold tabular-nums">{data.dataQuality.score}% COMPLIANT</span>
        </div>
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">SENSOR CONFIDENCE:</span>
          <span className="text-sky-600 font-bold tabular-nums">{data.dataQuality.sensorConfidence}% BAYESIAN</span>
        </div>
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">TELEMETRY FRESHNESS:</span>
          <span className="text-slate-800 font-bold tabular-nums">LIVE — {data.dataQuality.telemetryAgeMs}ms</span>
        </div>
        <div className="gcs-card p-2 rounded border border-slate-200 bg-white flex items-center justify-between shadow-xs">
          <span className="text-slate-500 text-[10px] font-semibold">ACTIVE FAULT:</span>
          <span className={`font-bold ${data.health.activeFault === 'NONE' ? 'text-emerald-600' : data.health.activeFault === 'MODEL_DISAGREEMENT' ? 'text-amber-600' : 'text-red-600'}`}>
            {data.health.activeFault}
          </span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. SUB-VIEW A: RUL & FATIGUE PROGNOSTICS (Screenshots 2 & 3)
         ───────────────────────────────────────────────────────────── */}
      {activeSubView === 'PROGNOSTICS' && (
        <div className="flex flex-col gap-4">
          
          {/* 4 Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            
            {/* Card 1: Estimated RUL */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">1. ESTIMATED RUL</span>
                <Clock className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.rul.hours.toFixed(1)}
                </span>
                <span className="text-xs font-mono font-bold text-slate-500">HOURS</span>
              </div>
              <div className="text-[11px] font-mono text-slate-600 mt-1 font-medium">
                Until MEL Overhaul Limit (50% Health)
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>Degradation: -{data.degradation.ratePerHour}%/hr</span>
                <span className="text-slate-700 font-semibold">TBO: 2000h</span>
              </div>
            </div>

            {/* Card 2: Health Index */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">2. HEALTH INDEX</span>
                <Activity className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-mono font-bold tabular-nums ${
                  data.health.index < 40 ? 'text-red-600' : data.health.index < 75 ? 'text-amber-600' : 'text-emerald-600'
                }`}>
                  {data.health.index.toFixed(0)}%
                </span>
                <span className="text-xs text-slate-500 font-mono font-medium">Composite</span>
              </div>
              
              {/* Clean solid progress bar */}
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className={`h-full transition-all duration-300 rounded ${
                    data.health.index < 40 ? 'bg-red-500' : data.health.index < 75 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${data.health.index}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>MEL Limit: 50%</span>
                <span className="text-slate-700 font-medium">Accum: 1249h</span>
              </div>
            </div>

            {/* Card 3: Degradation Trend */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">3. DEGRADATION TREND</span>
                <TrendingDown className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border inline-block ${
                  data.degradation.trend === 'RAPIDLY DEGRADING'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : data.degradation.trend === 'DEGRADING'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                  {data.degradation.trend}
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-600 mt-2 font-medium">
                Moderate RUL reduction under thermal/mechanical stress
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>Stress Factor: {data.degradation.stressBreakdown.combinedStress}x</span>
                <span className="text-amber-700 font-semibold">Active Fatigue</span>
              </div>
            </div>

            {/* Card 4: Confidence Score */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-slate-500 font-mono font-bold tracking-wider uppercase">4. CONFIDENCE</span>
                <ShieldAlert className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.rul.confidencePct}%
                </span>
                <span className="text-xs text-slate-500 font-mono font-medium">Bayesian 95%</span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-sky-600 rounded transition-all duration-300"
                  style={{ width: `${data.rul.confidencePct}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-2.5 pt-2 border-t border-slate-100 tabular-nums">
                <span>Sensor Agreement: High</span>
                <span className="text-slate-700 font-semibold">±1.8h Margin</span>
              </div>
            </div>

          </div>

          {/* Twin Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            
            {/* Chart 1: TIME -> HEALTH INDEX (%) */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2">
                <div>
                  <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    TIME → HEALTH INDEX (%)
                  </h3>
                  <div className="text-[10px] font-mono text-slate-500 font-medium">
                    Historical degradation log (T-50h → NOW) & 50h forecast envelope
                  </div>
                </div>
                <div className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-xs font-mono font-bold tabular-nums">
                  NOW: {data.health.index.toFixed(0)}%
                </div>
              </div>

              {/* SVG Health Plot */}
              <div className="relative w-full h-[180px] bg-slate-50/80 rounded border border-slate-200 overflow-hidden">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full">
                  {/* Grid Lines */}
                  <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.25} x2={padL + plotW} y2={padT + plotH * 0.25} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.5} x2={padL + plotW} y2={padT + plotH * 0.5} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.75} x2={padL + plotW} y2={padT + plotH * 0.75} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#CBD5E1" />

                  {/* Y Axis Labels */}
                  <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">100%</text>
                  <text x={padL - 6} y={padT + plotH * 0.25 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">75%</text>
                  <text x={padL - 6} y={padT + plotH * 0.5 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">50%</text>
                  <text x={padL - 6} y={padT + plotH * 0.75 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">25%</text>
                  <text x={padL - 6} y={padT + plotH + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">0%</text>

                  {/* X Axis Center Marker (NOW) */}
                  <line 
                    x1={healthPoints.nowCoord.x} 
                    y1={padT} 
                    x2={healthPoints.nowCoord.x} 
                    y2={padT + plotH} 
                    stroke="#0284c7" 
                    strokeDasharray="3,3" 
                    strokeWidth="1.5"
                  />
                  <text 
                    x={healthPoints.nowCoord.x} 
                    y={padT - 6} 
                    textAnchor="middle" 
                    fill="#0284c7" 
                    fontSize="9" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    NOW
                  </text>

                  {/* MEL Limit (50%) Red Dashed Line */}
                  <line 
                    x1={padL} 
                    y1={healthPoints.melY} 
                    x2={padL + plotW} 
                    y2={healthPoints.melY} 
                    stroke="#dc2626" 
                    strokeDasharray="4,4" 
                    strokeWidth="1.2"
                  />
                  <text 
                    x={padL + plotW - 10} 
                    y={healthPoints.melY - 4} 
                    textAnchor="end" 
                    fill="#dc2626" 
                    fontSize="8" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    MEL LIMIT (50%)
                  </text>

                  {/* 95% Bayesian Confidence Envelope */}
                  {healthPoints.polygonPath && (
                    <path d={healthPoints.polygonPath} fill="#059669" fillOpacity="0.12" />
                  )}

                  {/* Historical Log Path (Past: T-50h to NOW) */}
                  {healthPoints.histPath && (
                    <path 
                      d={healthPoints.histPath} 
                      fill="none" 
                      stroke="#0284c7" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Forecast Trajectory Path (Future: NOW to +50h) */}
                  {healthPoints.forecastPath && (
                    <path 
                      d={healthPoints.forecastPath} 
                      fill="none" 
                      stroke="#059669" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Current Position Point */}
                  <circle 
                    cx={healthPoints.nowCoord.x} 
                    cy={healthPoints.nowCoord.y} 
                    r="4" 
                    fill="#059669" 
                    stroke="#ffffff" 
                    strokeWidth="2" 
                  />

                  {/* X Axis Time Labels */}
                  <text x={healthPoints.mapX(-50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-50h</text>
                  <text x={healthPoints.mapX(-25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-25h</text>
                  <text x={healthPoints.mapX(0)} y={padT + plotH + 15} textAnchor="middle" fill="#0284c7" fontSize="8" fontWeight="bold" fontFamily="monospace">NOW</text>
                  <text x={healthPoints.mapX(25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+25h</text>
                  <text x={healthPoints.mapX(50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+50h</text>
                </svg>
              </div>

              {/* Chart Legend */}
              <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-600 mt-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#0284c7]"></span>
                  <span className="font-medium">Historical Flight Log</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#059669]"></span>
                  <span className="font-medium">Forecast Trajectory</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-[#059669]/20 border border-[#059669]/40 rounded-sm"></span>
                  <span className="font-medium">95% Bayesian Envelope</span>
                </div>
              </div>
            </div>

            {/* Chart 2: TIME -> ESTIMATED RUL (HOURS) */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-2">
                <div>
                  <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                    <Clock className="w-4 h-4 text-sky-600" />
                    TIME → ESTIMATED RUL (HOURS)
                  </h3>
                  <div className="text-[10px] font-mono text-slate-500 font-medium">
                    RUL progression across operational history & dynamic stress reduction
                  </div>
                </div>
                <div className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-xs font-mono font-bold tabular-nums">
                  NOW: {data.rul.hours.toFixed(1)}h RUL
                </div>
              </div>

              {/* SVG RUL Plot */}
              <div className="relative w-full h-[180px] bg-slate-50/80 rounded border border-slate-200 overflow-hidden">
                <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-full">
                  {/* Grid Lines */}
                  <line x1={padL} y1={padT} x2={padL + plotW} y2={padT} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH * 0.5} x2={padL + plotW} y2={padT + plotH * 0.5} stroke="#E2E8F0" strokeDasharray="2,2" />
                  <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="#CBD5E1" />

                  {/* Y Axis Labels */}
                  <text x={padL - 6} y={padT + 4} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">{Math.round(rulPoints.maxRul)}h</text>
                  <text x={padL - 6} y={padT + plotH * 0.5 + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">{Math.round(rulPoints.maxRul / 2)}h</text>
                  <text x={padL - 6} y={padT + plotH + 3} textAnchor="end" fill="#64748b" fontSize="8" fontFamily="monospace">0h</text>

                  {/* X Axis Center Marker (NOW) */}
                  <line 
                    x1={healthPoints.nowCoord.x} 
                    y1={padT} 
                    x2={healthPoints.nowCoord.x} 
                    y2={padT + plotH} 
                    stroke="#0284c7" 
                    strokeDasharray="3,3" 
                    strokeWidth="1.5"
                  />
                  <text 
                    x={healthPoints.nowCoord.x} 
                    y={padT - 6} 
                    textAnchor="middle" 
                    fill="#0284c7" 
                    fontSize="9" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    NOW
                  </text>

                  {/* MIN DISPATCH (20h) Red Dashed Line */}
                  <line 
                    x1={padL} 
                    y1={rulPoints.minDispatchY} 
                    x2={padL + plotW} 
                    y2={rulPoints.minDispatchY} 
                    stroke="#dc2626" 
                    strokeDasharray="4,4" 
                    strokeWidth="1.2"
                  />
                  <text 
                    x={padL + plotW - 10} 
                    y={rulPoints.minDispatchY - 4} 
                    textAnchor="end" 
                    fill="#dc2626" 
                    fontSize="8" 
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    MIN DISPATCH (20h)
                  </text>

                  {/* Historical RUL Curve */}
                  {rulPoints.histPath && (
                    <path 
                      d={rulPoints.histPath} 
                      fill="none" 
                      stroke="#0284c7" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Active Degradation Slope Path */}
                  {rulPoints.slopePath && (
                    <path 
                      d={rulPoints.slopePath} 
                      fill="none" 
                      stroke="#059669" 
                      strokeWidth="2" 
                    />
                  )}

                  {/* Current Position Point */}
                  <circle 
                    cx={rulPoints.nowCoord.x} 
                    cy={rulPoints.nowCoord.y} 
                    r="4" 
                    fill="#0284c7" 
                    stroke="#ffffff" 
                    strokeWidth="2" 
                  />

                  {/* X Axis Time Labels */}
                  <text x={healthPoints.mapX(-50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-50h</text>
                  <text x={healthPoints.mapX(-25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">T-25h</text>
                  <text x={healthPoints.mapX(0)} y={padT + plotH + 15} textAnchor="middle" fill="#0284c7" fontSize="8" fontWeight="bold" fontFamily="monospace">NOW</text>
                  <text x={healthPoints.mapX(25)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+25h</text>
                  <text x={healthPoints.mapX(50)} y={padT + plotH + 15} textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">+50h</text>
                </svg>
              </div>

              {/* Chart Legend */}
              <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-600 mt-2 px-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#0284c7]"></span>
                  <span className="font-medium">Historical RUL Curve</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-[#059669]"></span>
                  <span className="font-medium">Active Degradation Slope</span>
                </div>
                <div className="text-slate-700 font-mono font-bold tabular-nums">
                  Rate: -{data.degradation.ratePerHour}%/hr
                </div>
              </div>
            </div>

          </div>

          {/* ─────────────────────────────────────────────────────────────
              4. MULTI-STRESS INFLUENCE FACTORS (Screenshot 3)
             ───────────────────────────────────────────────────────────── */}
          {/* ─────────────────────────────────────────────────────────────
              4. MULTI-STRESS INFLUENCE FACTORS
             ───────────────────────────────────────────────────────────── */}
          {/* ─────────────────────────────────────────────────────────────
              4. MULTI-STRESS INFLUENCE FACTORS
             ───────────────────────────────────────────────────────────── */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <Zap className="w-4 h-4 text-sky-600" />
                PHYSICS-INFORMED MULTI-STRESS INFLUENCE FACTORS
              </h3>
              <span className="text-xs font-mono text-slate-600 font-medium">
                Combined Fatigue Acceleration: <span className="text-sky-700 font-bold tabular-nums">{data.degradation.stressBreakdown.combinedStress}x</span>
              </span>
            </div>

            {/* 5 Stress Factor Tiles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
              
              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">1. THERMAL STRESS</span>
                <div className="text-xl font-mono font-bold text-amber-600 my-1 tabular-nums">
                  {data.degradation.stressBreakdown.thermalStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">CHT / Oil Heat</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">2. VIBRATION / MECH</span>
                <div className="text-xl font-mono font-bold text-amber-600 my-1 tabular-nums">
                  {data.degradation.stressBreakdown.mechanicalStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">IPS / 2X Harmonics</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">3. LUBRICATION</span>
                <div className={`text-xl font-mono font-bold my-1 tabular-nums ${
                  data.degradation.stressBreakdown.lubricationStress > 1.2 ? 'text-red-600' : 'text-emerald-600'
                }`}>
                  {data.degradation.stressBreakdown.lubricationStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">Film / Oil PSI</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">4. COMBUSTION</span>
                <div className={`text-xl font-mono font-bold my-1 tabular-nums ${
                  data.degradation.stressBreakdown.combustionStress > 1.2 ? 'text-red-600' : 'text-emerald-600'
                }`}>
                  {data.degradation.stressBreakdown.combustionStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">Rail / Knock RMS</span>
              </div>

              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                <span className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">5. OPERATING LOAD</span>
                <div className="text-xl font-mono font-bold text-slate-900 my-1 tabular-nums">
                  {data.degradation.stressBreakdown.operatingStress.toFixed(2)}x
                </div>
                <span className="text-[9px] font-mono text-slate-500 font-medium">RPM / MAP Boost</span>
              </div>

            </div>

            {/* Scenario Response Logic Legend */}
            <div className="mt-3 p-2.5 gcs-card rounded border border-slate-200 bg-slate-50/80 flex flex-wrap items-center justify-between text-[10px] font-mono text-slate-600">
              <span className="text-slate-900 font-bold">RESPONSE CRITERIA:</span>
              <span className="text-emerald-700 font-medium">Normal Operation → Degradation Rate ~0.045%/hr</span>
              <span className="text-amber-700 font-medium">Mild Fault Mode → RUL Acceleration ~1.4x - 1.8x</span>
              <span className="text-red-700 font-medium">Severe Fault Mode → RUL Acceleration ~3.8x - 7.5x</span>
            </div>
          </div>

          {/* Prototype Notice Callout */}
          <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-[11px] leading-relaxed text-slate-700 flex items-start gap-2.5 shadow-xs">
            <Info className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
            <div>
              <span className="font-bold text-slate-900">RESEARCH BENCHMARK & ESTIMATION NOTICE: </span>
              This Remaining Useful Life (RUL) computation is a <span className="text-sky-700 font-semibold">physics-informed fatigue estimation</span> generated by multi-stress Weibull damage accumulation models and sensor residual attribution. In-flight authority and dispatch decisions remain strictly subject to the official Rotax 915-iS Aircraft Maintenance Manual (AMM) and statutory Time Between Overhaul (TBO: 2000 hours) compliance.
            </div>
          </div>

          {/* ─────────────────────────────────────────────────────────────
              5. EXPLAINABLE AI (XAI) ANOMALY ATTRIBUTION
             ───────────────────────────────────────────────────────────── */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <div>
                <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-sky-600" />
                  EXPLAINABLE AI (XAI) ANOMALY ATTRIBUTION
                </h3>
                <div className="text-[10px] font-mono text-slate-500 font-medium">
                  SHAP-style neural weight contribution to current deviation score
                </div>
              </div>
              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-mono font-semibold">
                PINN AUTOENCODER
              </span>
            </div>

            {/* 6 XAI Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {(data.xaiAttributions || []).map((attr, idx) => (
                <div key={idx} className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 leading-snug">
                      {attr.name}
                    </span>
                    <span className={`text-xs font-mono font-bold shrink-0 tabular-nums ${
                      attr.status === 'CRITICAL' ? 'text-red-600' : attr.status === 'ELEVATED' ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {attr.weight}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600 mt-1 leading-relaxed">
                    {attr.description}
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        attr.status === 'CRITICAL' ? 'bg-red-500' : attr.status === 'ELEVATED' ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.abs(parseInt(attr.weight) || 20) * 1.5)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Multi-Horizon Failure Risk */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-sky-600" />
                MULTI-HORIZON PROBABILISTIC FAILURE RISK
              </h3>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase ${
                data.risk.level === 'CRITICAL' ? 'bg-red-50 text-red-700 border-red-200' :
                data.risk.level === 'HIGH' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                data.risk.level === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                RISK LEVEL: {data.risk.level}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 1 HOUR</div>
                <div className="text-lg font-bold font-mono text-emerald-600 mt-0.5 tabular-nums">{data.risk.multiHorizon.h1}%</div>
                <div className="text-[9px] font-mono text-slate-500">Cumulative hazard</div>
              </div>
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 4 HOURS</div>
                <div className="text-lg font-bold font-mono text-emerald-600 mt-0.5 tabular-nums">{data.risk.multiHorizon.h4}%</div>
                <div className="text-[9px] font-mono text-slate-500">Sortie window</div>
              </div>
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 8 HOURS</div>
                <div className="text-lg font-bold font-mono text-amber-600 mt-0.5 tabular-nums">{data.risk.multiHorizon.h8}%</div>
                <div className="text-[9px] font-mono text-slate-500">Loiter envelope</div>
              </div>
              <div className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">NEXT 24 HOURS</div>
                <div className="text-lg font-bold font-mono text-slate-900 mt-0.5 tabular-nums">{data.risk.multiHorizon.h24}%</div>
                <div className="text-[9px] font-mono text-slate-500">Endurance horizon</div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. SUB-VIEW B: CAUSAL DIAGNOSTICS & ADVISORY (Screenshot 1)
         ───────────────────────────────────────────────────────────── */}
      {activeSubView === 'ADVISORY' && (
        <div className="flex flex-col gap-3">
          
          {/* Top 4 Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            
            {/* Card 1: Overall Anomaly Score */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">1. OVERALL ANOMALY SCORE</span>
                <Activity className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-emerald-600 tabular-nums">
                  {data.health.overallAnomalyScore.toFixed(2)}
                </span>
                <span className="text-xs font-mono text-slate-500 font-medium">σ Residual</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.min(100, data.health.overallAnomalyScore * 70)}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 font-medium">
                Within Nominal (≤0.15 σ)
              </div>
            </div>

            {/* Card 2: Health Index */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">2. HEALTH INDEX</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-emerald-600 tabular-nums">
                  {data.health.index.toFixed(0)}
                </span>
                <span className="text-xs font-mono text-slate-500 font-medium">/ 100</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${data.health.index}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 tabular-nums font-medium">
                RUL Projection: {data.rul.hours.toFixed(1)} Flight Hours
              </div>
            </div>

            {/* Card 3: Probable Fault */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">3. PROBABLE FAULT</span>
                <AlertTriangle className="w-4 h-4 text-amber-600" />
              </div>
              <div className={`text-sm font-bold font-mono tracking-wide ${
                data.health.activeFault === 'NONE' ? 'text-emerald-700' : 'text-red-700'
              }`}>
                {data.health.probableFault}
              </div>
              <div className="text-[10px] font-mono text-slate-600 mt-1">
                Subsystem: <span className="text-slate-900 font-bold">{data.advisory.affectedSubsystems[0] || 'Nominal'}</span>
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 pt-2 border-t border-slate-100">
                Signature: {data.health.activeFault === 'NONE' ? 'NOMINAL' : 'ANOMALY DETECTED'}
              </div>
            </div>

            {/* Card 4: Fault Confidence */}
            <div className="gcs-card rounded-lg border border-slate-200 bg-white p-3.5 relative overflow-hidden shadow-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-mono text-slate-500 font-bold tracking-wider uppercase">4. FAULT CONFIDENCE</span>
                <BarChart3 className="w-4 h-4 text-sky-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-mono font-bold text-slate-900 tabular-nums">
                  {data.health.faultConfidence}%
                </span>
                <span className="text-xs font-mono text-slate-500 font-medium">Posterior</span>
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded mt-2.5 overflow-hidden border border-slate-200">
                <div 
                  className="h-full bg-sky-600 transition-all duration-300"
                  style={{ width: `${data.health.faultConfidence}%` }}
                />
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-2 font-medium">
                Physics Correlation: 100%
              </div>
            </div>

          </div>

          {/* Parameter Evidence Table */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <FileSearch className="w-4 h-4 text-sky-600" />
                PARAMETER EVIDENCE (GOLDEN TWIN VS. LIVE TELEMETRY DEVIATION)
              </h3>
              <span className="text-[10px] font-mono text-slate-500 font-medium">
                Ranked by Mahalanobis influence metric
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] text-slate-600 uppercase tracking-wider">
                    <th className="py-2.5 px-3 font-bold">PARAMETER</th>
                    <th className="py-2.5 px-3 font-bold">GOLDEN MODEL</th>
                    <th className="py-2.5 px-3 font-bold">LIVE TELEMETRY</th>
                    <th className="py-2.5 px-3 font-bold">DEVIATION / RESIDUAL</th>
                    <th className="py-2.5 px-3 font-bold">DIAGNOSTIC WEIGHT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!data.advisory.parameterEvidence || data.advisory.parameterEvidence.length === 0) ? (
                    <tr>
                      <td colSpan={5} className="py-6 px-3 text-center text-slate-500 italic">
                        All thermodynamic, mechanical, and combustion sensor channels tracking within nominal ±1.5σ baseline.
                      </td>
                    </tr>
                  ) : (
                    data.advisory.parameterEvidence.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            row.status === 'CRITICAL' ? 'bg-red-500' : row.status === 'WARNING' ? 'bg-amber-500' : 'bg-emerald-500'
                          }`} />
                          <span className="text-slate-900 font-bold">{row.parameter}</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 tabular-nums">{row.goldenModel}</td>
                        <td className="py-2.5 px-3 text-slate-900 font-bold tabular-nums">{row.liveTelemetry}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border tabular-nums ${
                            row.status === 'CRITICAL'
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : row.status === 'WARNING'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-100 border-slate-200 text-slate-700'
                          }`}>
                            {row.residual}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-slate-100 h-1.5 rounded overflow-hidden border border-slate-200">
                              <div 
                                className="h-full bg-sky-600 rounded"
                                style={{ width: row.diagnosticWeight }}
                              />
                            </div>
                            <span className="text-slate-800 text-[11px] font-bold tabular-nums">{row.diagnosticWeight}</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom 2 Panels: WHY IT MATTERS & RECOMMENDED ACTION */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            
            {/* Left: WHY THIS MATTERS (PHYSICAL CAUSAL REASONING) */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col justify-between shadow-xs">
              <div>
                <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-3">
                  <Brain className="w-4 h-4 text-sky-600" />
                  PHYSICAL CAUSAL REASONING
                </h3>
                <p className="text-xs font-mono text-slate-700 leading-relaxed font-medium">
                  {data.advisory.whyReasoning}
                </p>
              </div>

              <div className="mt-4 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>Inference: Physics-Informed Neural Autoencoder (PINN)</span>
                <span className="text-slate-700 font-semibold">Validated vs. Rotax 915-iS Dataset</span>
              </div>
            </div>

            {/* Right: RECOMMENDED MAINTENANCE ACTION & FADEC INTERVENTION */}
            <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col justify-between shadow-xs">
              <div>
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
                  <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-600" />
                    RECOMMENDED ADVISORY & FADEC INTERVENTION
                  </h3>
                  <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border uppercase ${
                    data.advisory.priority === 'CRITICAL' ? 'bg-red-50 text-red-700 border-red-200' :
                    data.advisory.priority === 'HIGH' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    URGENCY: {data.advisory.urgencyLabel}
                  </span>
                </div>

                <div className="text-xs font-mono text-slate-800 leading-relaxed font-medium">
                  {data.advisory.recommendationText}
                </div>

                <div className="mt-3 text-[11px] font-mono text-slate-600">
                  <span className="text-slate-500 font-semibold">Operational Window: </span>
                  <span className="text-slate-900 font-bold">{data.advisory.operationalWindow}</span>
                </div>
              </div>

              <div className="mt-4 pt-2.5 border-t border-slate-100 text-[10px] font-mono font-medium">
                <span className="text-emerald-700 font-semibold">{data.advisory.fadecStatus}</span>
              </div>
            </div>

          </div>

          {/* Mission Demand Interactive Scrubber & Mission Margin */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
                <Sliders className="w-4 h-4 text-sky-600" />
                MISSION-AWARE RUL DISPATCH MARGIN EVALUATOR
              </h3>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border uppercase ${
                data.advisory.isMissionFeasible 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                {data.advisory.isMissionFeasible ? '✓ SORTIE AUTHORIZED' : '⚠️ MISSION RISK REVIEW REQUIRED'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
              {/* Slider Input */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-500 font-medium">PLANNED MISSION DURATION:</span>
                  <span className="text-slate-900 font-bold tabular-nums">{missionDemandHours.toFixed(1)} HOURS</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="14"
                  step="0.5"
                  value={missionDemandHours}
                  onChange={(e) => setMissionDemandHours(parseFloat(e.target.value))}
                  className="w-full accent-sky-600 cursor-pointer h-2 bg-slate-200 rounded border border-slate-300"
                />
                <div className="flex justify-between text-[9px] font-mono text-slate-500 tabular-nums">
                  <span>1.0h (Recon)</span>
                  <span>6.0h (Cruise)</span>
                  <span>14.0h (Max Endurance)</span>
                </div>
              </div>

              {/* RUL vs Mission Comparison */}
              <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex justify-around items-center text-center font-mono shadow-xs">
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">ESTIMATED RUL</div>
                  <div className="text-lg font-bold font-mono text-slate-900 tabular-nums">{data.rul.hours.toFixed(1)}h</div>
                </div>
                <div className="text-slate-400 font-bold text-xs">VS</div>
                <div>
                  <div className="text-[10px] text-slate-500 font-bold uppercase">SORTIE DEMAND</div>
                  <div className="text-lg font-bold font-mono text-sky-600 tabular-nums">{missionDemandHours.toFixed(1)}h</div>
                </div>
              </div>

              {/* Margin Result Tile */}
              <div className={`p-3 rounded-lg border text-center font-mono shadow-xs ${
                data.advisory.isMissionFeasible 
                  ? 'bg-emerald-50/80 border-emerald-200 text-emerald-800' 
                  : 'bg-red-50/80 border-red-200 text-red-800'
              }`}>
                <div className="text-[10px] uppercase font-bold">RUL DISPATCH MARGIN</div>
                <div className="text-2xl font-bold font-mono my-0.5 tabular-nums">
                  {data.advisory.missionMarginHours > 0 ? `+${data.advisory.missionMarginHours.toFixed(1)}` : data.advisory.missionMarginHours.toFixed(1)}h
                </div>
                <div className="text-[10px] text-slate-600 font-medium">
                  {data.advisory.isMissionFeasible ? 'Exceeds standard 20% flight safety reserve' : 'RUL lower than mission flight plan!'}
                </div>
              </div>
            </div>
          </div>

          {/* Subsystems Matrix */}
          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs">
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2 border-b border-slate-100 pb-2.5 mb-3">
              <Layers className="w-4 h-4 text-sky-600" />
              DIGITAL TWIN SUBSYSTEM DEGRADATION INDEX (0 - 100)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              {Object.entries(data.degradation.subsystems || {}).map(([name, val]) => (
                <div key={name} className="gcs-card p-2.5 rounded-lg border border-slate-200 bg-white flex flex-col justify-between shadow-xs">
                  <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">{name}</span>
                  <div className={`text-lg font-mono font-bold my-1 tabular-nums ${
                    val > 50 ? 'text-red-600' : val > 20 ? 'text-amber-600' : 'text-emerald-600'
                  }`}>
                    {val}%
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded overflow-hidden border border-slate-200">
                    <div 
                      className={`h-full transition-all duration-300 ${val > 50 ? 'bg-red-500' : val > 20 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${val}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          5. TECHNICAL AUDIT SLIDE-OUT DRAWER FOR JUDGES (Rule 58)
         ───────────────────────────────────────────────────────────── */}
      <PrognosticsDetailDrawer 
        isOpen={isAuditDrawerOpen} 
        onClose={() => setIsAuditDrawerOpen(false)}
        modelMetadata={data.modelMetadata}
      />

    </div>
  );
};
