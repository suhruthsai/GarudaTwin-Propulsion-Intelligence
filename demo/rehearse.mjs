// Demo rehearsal: runs the demo fault sequence against the running system (npm run start:all),
// logs what the GCS shows at each step, and exports the flight recording as a backup CSV.
// Usage: node demo/rehearse.mjs
import { writeFileSync } from 'fs';
import { io } from 'socket.io-client';

const B = 'http://localhost:5002';
const H = { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' };
const post = (p, body = {}) => fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(body) }).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same faults and severities as the inject buttons in the 3D CAD Blueprint tab (component inspector)
const STEPS = [
  { label: 'Nominal loiter', fault: null, holdS: 40 },
  { label: 'Cyl 3 Clog (button, 0.9)', fault: ['CYL3_INJECTOR', 0.9], holdS: 40 },
  { label: 'Generator failure (button, 0.9) - battery discharging', fault: ['GENERATOR_FAILURE', 0.9], holdS: 60 },
  { label: 'Oil Cavitation (button, 0.95) - RTB case', fault: ['OIL_PUMP_CAVITATION', 0.95], holdS: 40 },
  { label: 'Sensor Drift (CHT2) (button, 0.8) - engine healthy', fault: ['SENSOR_DRIFT', 0.8], holdS: 40 },
];

const s = io(B, { transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:5173' } });
let tel = null, ai = null;
s.on('telemetry_frame', d => { tel = d; });
s.on('ai_prognostics', d => { ai = d; });
await new Promise(r => s.on('connect', r));

await post('/api/fcs/reset');
await sleep(4000);
const t0 = Date.now();
const row = () => {
  const e = tel.engine, f = tel.fcs, h = ai?.health, r = ai?.rul;
  return `AI ${h?.diagnosed_fault ?? '-'} ${h?.confidence_pct != null ? Math.round(h.confidence_pct) + '%' : ''} | health ${r?.healthIndexScore ?? '-'} RUL ${r?.rulHours ?? '-'} h`
    + ` | L1 ${tel.health.status} | thrust ${Math.round((f.thrust_factor ?? 1) * 100)}% alt ${Math.round(f.alt_ft)} ft`
    + ` | bus ${e.genVoltageV} V batt ${e.batteryCurrentA} A SOC ${e.batterySocPct}% | trim ${e.fuelTrimPct}% inj ${e.injPulseMs} ms`;
};
const log = [];
const out = line => { console.log(line); log.push(line); };

for (const st of STEPS) {
  out(`\n== ${st.label}`);
  if (st.fault) await post('/api/faults/inject', { faultType: st.fault[0], severity: st.fault[1] });
  const start = Date.now();
  let detectedAt = null;
  for (let t = 0; t <= st.holdS; t += 1) {
    await sleep(Math.max(0, start + t * 1000 - Date.now()));
    const d = ai?.health?.diagnosed_fault;
    if (st.fault && detectedAt == null && d === st.fault[0]) detectedAt = t;
    if (t % 10 === 0 || (detectedAt === t)) out(`  t+${String(t).padStart(2)} s  ${row()}`);
  }
  if (st.fault) {
    out(`  -> first correct diagnosis at ~${detectedAt ?? 'NOT DETECTED'} s; top cause: ${ai?.feature_attributions?.[0]?.description ?? '-'}`);
    await post('/api/faults/clear');
    const c0 = Date.now();
    while (ai?.health?.diagnosed_fault !== 'NONE' && Date.now() - c0 < 30000) await sleep(500);
    out(`  -> cleared; AI back to NONE after ${((Date.now() - c0) / 1000).toFixed(1)} s`);
  }
}

// Backup: export this sortie's flight recording (replayable in the Data Source & Replay tab)
await sleep(1500);
const recs = await fetch(B + '/api/recordings', { headers: H }).then(r => r.json());
const list = Array.isArray(recs) ? recs : recs.recordings;
const rec = list?.[0];
if (rec) {
  const csv = await fetch(`${B}/api/recordings/${rec.id}/export.csv`, { headers: H }).then(r => r.text());
  writeFileSync(new URL('./backup_sortie.csv', import.meta.url), csv);
  out(`\nBackup recording #${rec.id} (${rec.name ?? ''}) exported: demo/backup_sortie.csv, ${csv.split('\n').length - 2} frames`);
}
writeFileSync(new URL('./rehearsal_log.txt', import.meta.url), log.join('\n') + `\nTotal ${((Date.now() - t0) / 60000).toFixed(1)} min\n`);
s.close(); process.exit(0);
