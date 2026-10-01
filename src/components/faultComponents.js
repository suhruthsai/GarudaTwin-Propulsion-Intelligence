// Maps the AI diagnosis (tel.health.activeFault + tel.health.suspectSensor) to 3D / schematic components.
// Shared by the UAV Blueprint tab and the What-If bench's engine model.

const CYLS = ['CYL_01', 'CYL_02', 'CYL_03', 'CYL_04'];
// Components implicated by each AI-diagnosed fault class (the AI names a class, not a part number;
// faults it cannot localise to one cylinder light the whole cylinder group)
export const FAULT_COMPONENTS = {
  CYL3_INJECTOR: ['CYL_03', 'FUEL_RAIL'],
  BLOW_BY: ['CYL_02', 'CYL_03', 'OIL_SYSTEM'],
  OIL_PUMP_CAVITATION: ['OIL_SYSTEM'],
  TURBO_WASTEGATE_STUCK: ['TURBO_01'],
  COOLING_DEGRADATION: [...CYLS, 'COOLANT_RADIATOR'],
  PRGB_DEGRADATION: ['PRGB_GEARBOX'],
  GENERATOR_FAILURE: ['UAV_GENERATOR_28V'],
  MISFIRE: CYLS,
  COMBUSTION_INSTABILITY: CYLS,
  INJECTOR_COKING: ['FUEL_RAIL', ...CYLS],
};
/** Component that hosts the sensor the AI flagged. suspect_sensor is e.g. "CHT cylinder 2 (+8.1 °C vs other
 *  cylinders)", "oil pressure", "coolant temperature" (drift) or raw channel names such as "oil_pressure, cht3" (stuck). */
export function sensorComponent(sensor) {
  const s = String(sensor || '').toLowerCase();
  const m = /(?:egt|cht)\s*(?:cylinder\s*)?([1-4])/.exec(s);
  if (m) return `CYL_0${m[1]}`;
  if (/oil/.test(s)) return 'OIL_SYSTEM';
  if (/coolant/.test(s)) return 'COOLANT_RADIATOR';
  return null;
}
/** True when the AI diagnosis in tel.health implicates this component. */
export function isComponentFaulted(id, tel) {
  const af = tel?.health?.activeFault || 'NONE';
  if (af === 'SENSOR_DRIFT' || af === 'SENSOR_FAILURE') return sensorComponent(tel?.health?.suspectSensor) === id;
  return (FAULT_COMPONENTS[af] || []).includes(id);
}
