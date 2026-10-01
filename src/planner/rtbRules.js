/**
 * Rule-based RTB contingency rules: the single definition used by the GCS (MissionMapTab) and
 * mirrored by the planner service (ai_service.py, /api/rl-replan). test_fleet.mjs checks that both
 * give the same decision over a grid of inputs.
 *
 * All thresholds are project assumptions, not certified limits.
 */
export const RTB_RULES = {
  CRITICAL_HEALTH_PCT: 40,      // AI health below this
  CRITICAL_RUL_H: 2,            // remaining useful life below this
  BINGO_FUEL_L: 22,             // fuel at or below this (reserve)
  CRITICAL_FAULTS: ['CYL3_INJECTOR', 'OIL_PUMP_CAVITATION'],
  DEGRADED_HEALTH_PCT: 75,
  DEGRADED_RUL_H: 20,
  LOW_FUEL_L: 35,
};

// Fixed rule outputs
export const RTB_PROFILES = {
  EMERGENCY_DIVERT_RTB: { throttle: 58, rpm: 4200, climbFpm: -350, speedKts: 95, field: 'NEAREST' },
  DERATE_AND_DIVERT: { throttle: 68, rpm: 4400, climbFpm: -200, speedKts: 105, field: 'NEAREST' },
  CONTINGENCY_RTB_PREVIEW: { throttle: 68, rpm: 4600, climbFpm: -200, speedKts: 105, field: 'PRIMARY' },
  CONTINUE_MISSION: { throttle: null, rpm: null, climbFpm: 0, speedKts: null, field: 'PRIMARY' },  // keep current operating point
};

/**
 * Classify a vehicle. health/rul/fuel may be null (unknown); fault is the AI diagnosis
 * ('NONE' if none); when the AI is offline the L1 threshold status is used instead.
 */
export function classifyVehicle({ health = null, rul = null, fault = 'NONE', fuel = null, aiOk = true, l1 = null }) {
  const R = RTB_RULES;
  const crit = [], deg = [];
  if (health != null && health < R.CRITICAL_HEALTH_PCT) crit.push(`health ${health.toFixed(1)} % < ${R.CRITICAL_HEALTH_PCT} %`);
  if (rul != null && rul < R.CRITICAL_RUL_H) crit.push(`RUL ${rul.toFixed(1)} h < ${R.CRITICAL_RUL_H} h`);
  if (R.CRITICAL_FAULTS.includes(fault)) crit.push(`diagnosis ${fault}`);
  if (fuel != null && fuel <= R.BINGO_FUEL_L) crit.push(`fuel ${fuel.toFixed(1)} L <= ${R.BINGO_FUEL_L} L (bingo)`);
  if (!aiOk && l1 === 'CRITICAL') crit.push('L1 threshold monitor CRITICAL (AI offline)');
  if (health != null && health < R.DEGRADED_HEALTH_PCT) deg.push(`health ${health.toFixed(1)} % < ${R.DEGRADED_HEALTH_PCT} %`);
  if (rul != null && rul < R.DEGRADED_RUL_H) deg.push(`RUL ${rul.toFixed(1)} h < ${R.DEGRADED_RUL_H} h`);
  if (fault && fault !== 'NONE') deg.push(`diagnosis ${fault}`);
  if (fuel != null && fuel < R.LOW_FUEL_L) deg.push(`fuel ${fuel.toFixed(1)} L < ${R.LOW_FUEL_L} L`);
  if (!aiOk && l1 === 'DEGRADED') deg.push('L1 threshold monitor DEGRADED (AI offline)');
  const status = crit.length ? 'CRITICAL' : deg.length ? 'DEGRADED' : 'NOMINAL';
  return { status, reasons: crit.length ? crit : deg };
}

/** Planner action for a status and operator mode ('AUTO_EVENT' | 'FORCE_SIMULATION' | 'CONTINGENCY_PREVIEW'). */
export function rtbAction(status, mode = 'AUTO_EVENT') {
  if (status === 'CRITICAL' || mode === 'FORCE_SIMULATION') return 'EMERGENCY_DIVERT_RTB';
  if (status === 'DEGRADED') return 'DERATE_AND_DIVERT';
  if (mode === 'CONTINGENCY_PREVIEW') return 'CONTINGENCY_RTB_PREVIEW';
  return 'CONTINUE_MISSION';
}

export const RTB_ACTION_LABEL = {
  EMERGENCY_DIVERT_RTB: 'EMERGENCY DIVERT TO NEAREST AIRFIELD',
  DERATE_AND_DIVERT: 'POWER DERATE & DIVERT TO NEAREST AIRFIELD',
  CONTINGENCY_RTB_PREVIEW: 'CONTINGENCY PREVIEW: RTB TO AFS UTTARLAI',
  CONTINUE_MISSION: 'CONTINUE MISSION (CONTINGENCY ROUTE SHOWN)',
};
