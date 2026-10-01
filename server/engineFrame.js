/**
 * Canonical engine frame: the one format shared by the flight recorder, CSV import,
 * live ingest (test rig / CAN bridge) and replay.
 *
 * Column names are the same as the training dataset (training/generate_dataset.mjs), so a
 * dataset CSV can be replayed as-is. All 25 channels the AI models use are required: the
 * models were trained with every channel present, and silently imputing a missing channel as
 * "nominal" would hide faults on it.
 */

// name -> [engineState field, cylinder index | null, plausible physical range]
export const CHANNELS = {
  rpm:          ['rpm', null, [0, 8000]],
  throttle:     ['throttlePct', null, [0, 100]],
  egt1:         ['egt', 0, [-60, 1300]],
  egt2:         ['egt', 1, [-60, 1300]],
  egt3:         ['egt', 2, [-60, 1300]],
  egt4:         ['egt', 3, [-60, 1300]],
  cht1:         ['cht', 0, [-60, 400]],
  cht2:         ['cht', 1, [-60, 400]],
  cht3:         ['cht', 2, [-60, 400]],
  cht4:         ['cht', 3, [-60, 400]],
  map_bar:      ['mapBar', null, [0, 5]],
  oil_pressure: ['oilPressBar', null, [0, 15]],
  oil_temp:     ['oilTempC', null, [-60, 250]],
  vibration:    ['vibrationGrms', null, [0, 50]],
  fuel_flow:    ['fuelFlowLph', null, [0, 200]],
  lambda:       ['lambda', null, [0.3, 3]],
  gen_voltage:  ['genVoltageV', null, [0, 60]],
  gen_current:  ['genCurrentA', null, [-300, 300]],
  coolant_temp: ['coolantTempC', null, [-60, 200]],
  // ECU injection data, battery and air data (column names as in the training dataset)
  inj_pw_ms: ['injPulseMs', null, [0.5, 30]],
  fuel_trim_pct: ['fuelTrimPct', null, [-25, 25]],
  battery_current_a: ['batteryCurrentA', null, [-150, 60]],
  battery_soc_pct: ['batterySocPct', null, [0, 100]],
  ambient_pressure_bar: ['ambientPressureBar', null, [0.3, 1.1]],
  oat_c: ['oatC', null, [-60, 55]],
};
// Recording / CSV format version (2 = with injection, battery and air-data channels)
export const FRAME_SCHEMA_VERSION = 2;
export const CHANNEL_NAMES = Object.keys(CHANNELS);

const num = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
};

/**
 * Validate one frame. Accepts flat cylinder columns (egt1..egt4) or arrays (egt: [4], cht: [4]).
 * Returns { frame } with every channel a finite number, or { error }.
 */
export function normalizeFrame(obj) {
  if (!obj || typeof obj !== 'object') return { error: 'frame must be an object' };
  const src = { ...obj };
  for (const k of ['egt', 'cht']) {
    if (Array.isArray(obj[k])) {
      if (obj[k].length !== 4) return { error: `${k} must have 4 cylinders` };
      obj[k].forEach((v, i) => { src[`${k}${i + 1}`] = v; });
    }
  }
  const frame = {};
  const missing = [], bad = [];
  for (const [name, [, , [lo, hi]]] of Object.entries(CHANNELS)) {
    if (src[name] === undefined || src[name] === null || src[name] === '') { missing.push(name); continue; }
    const v = num(src[name]);
    if (!Number.isFinite(v) || v < lo || v > hi) { bad.push(`${name}=${src[name]}`); continue; }
    frame[name] = v;
  }
  if (missing.length) return { error: `missing channels: ${missing.join(', ')}` };
  if (bad.length) return { error: `non-numeric or physically implausible: ${bad.join(', ')}` };
  return { frame };
}

/** Write a normalized frame into the gateway's engineState object (in place). */
export function applyFrameToEngineState(frame, engineState) {
  for (const [name, [field, cyl]] of Object.entries(CHANNELS)) {
    if (cyl === null) engineState[field] = frame[name];
    else engineState[field][cyl] = frame[name];
  }
}

/** Read the canonical frame out of the gateway's engineState. */
export function frameFromEngineState(e) {
  const frame = {};
  for (const [name, [field, cyl]] of Object.entries(CHANNELS)) {
    frame[name] = cyl === null ? e[field] : e[field][cyl];
  }
  return frame;
}

/** Payload for the AI service (same field names as the live loop always used). */
export function aiPayloadFromFrame(frame, { uavId, timeS, flightHours }) {
  return {
    uav_id: uavId, sim_time_s: timeS,
    ...(flightHours !== undefined ? { total_flight_hours: flightHours } : {}),
    rpm: frame.rpm, throttle: frame.throttle,
    egt: [frame.egt1, frame.egt2, frame.egt3, frame.egt4],
    cht: [frame.cht1, frame.cht2, frame.cht3, frame.cht4],
    map_bar: frame.map_bar, oil_pressure: frame.oil_pressure, oil_temp: frame.oil_temp,
    vibration: frame.vibration, fuel_flow: frame.fuel_flow, lambda: frame.lambda,
    gen_voltage: frame.gen_voltage, gen_current: frame.gen_current, coolant_temp: frame.coolant_temp,
    inj_pw_ms: frame.inj_pw_ms, fuel_trim_pct: frame.fuel_trim_pct,
    battery_current_a: frame.battery_current_a, battery_soc_pct: frame.battery_soc_pct,
    ambient_pressure_bar: frame.ambient_pressure_bar, oat_c: frame.oat_c,
  };
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). Returns array of rows. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

/** Escape one CSV value. */
export const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
