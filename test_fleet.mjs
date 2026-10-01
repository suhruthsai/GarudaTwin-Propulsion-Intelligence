/**
 * Fleet test suite (real AI service): every escort vehicle has its own engine simulator, golden twin
 * and AI session; faults are per vehicle; nothing about Vahak-2..5 is hard-coded.
 * Starts an isolated AI service and gateway (temp data dir, random ports). Takes ~2 minutes.
 * Run: npm run test:fleet
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, info = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && info !== '' ? `  -> ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'garuda-fleet-'));
const aiPort = 20000 + Math.floor(Math.random() * 10000);
const gwPort = aiPort + 10000;
const B = `http://127.0.0.1:${gwPort}`;
const env = { ...process.env, GCS_DATA_DIR: tmp, GCS_INTERNAL_KEY: crypto.randomBytes(32).toString('hex'), PYTHONIOENCODING: 'utf-8' };
const py = process.platform === 'win32' ? path.join(ROOT, 'ai_venv', 'Scripts', 'python.exe') : path.join(ROOT, 'ai_venv', 'bin', 'python');
const procs = [];
const start = (cmd, args, extra) => {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  procs.push(p);
};
async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await sleep(500);
  }
  throw new Error(`${url} did not come up`);
}
const cleanup = () => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } };
process.on('exit', cleanup);

console.log('Starting isolated AI service and gateway...');
start(py, ['ai_service.py'], { AI_PORT: String(aiPort) });
await waitHttp(`http://127.0.0.1:${aiPort}/health`, 180000);
start(process.execPath, ['server.js'], { PORT: String(gwPort), HOST: '127.0.0.1', AI_SERVICE_URL: `http://127.0.0.1:${aiPort}` });
await waitHttp(`${B}/api/health`, 30000);

const H = { 'Content-Type': 'application/json', Origin: ORIGIN };
const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() }; };
const sock = io(B, { transports: ['websocket'], extraHeaders: { Origin: ORIGIN } });
await new Promise(r => sock.on('connect', r));
let tel = null; const fleetAi = [];
sock.on('telemetry_frame', d => { tel = d; });
sock.on('fleet_ai', d => fleetAi.push(d));
const F = () => Object.fromEntries(tel.fleetState.map(u => [u.id, u]));

try {
  await sleep(12000);
  let f = F();
  console.log('\n[1] Independent vehicles');
  check('5 vehicles reported', tel.fleetState.length === 5);
  check('Vahak-2..4 run their own engines at different operating points',
    new Set(['Vahak-2', 'Vahak-3', 'Vahak-4'].map(id => Math.round((f[id].engineState?.rpm ?? 0) / 50))).size === 3);
  check('Vahak-5 grounded: no engine data and no AI', f['Vahak-5'].airborne === false && !f['Vahak-5'].engineState && !f['Vahak-5'].ai);
  check('full AI results broadcast for the 3 airborne escorts', Object.keys(fleetAi.at(-1) ?? {}).sort().join() === 'Vahak-2,Vahak-3,Vahak-4');
  check('healthy escort: AI NONE, MONITOR, stable (no inspection just for flight hours)',
    f['Vahak-2'].ai?.diagnosis === 'NONE' && f['Vahak-2'].ai?.action === 'MONITOR', f['Vahak-2'].ai);
  check('healthy high-hours Vahak-1 is not flagged for inspection by its hours alone', f['Vahak-1'].ai?.action === 'MONITOR', f['Vahak-1'].ai);
  check('nominal RUL = 2000 h TBO minus each engine\'s hours (1585 / 1920 / 751.4)',
    Math.abs(f['Vahak-2'].ai.rulHours - 1585) < 1 && Math.abs(f['Vahak-3'].ai.rulHours - 1920) < 1 && Math.abs(f['Vahak-1'].ai.rulHours - 751.4) < 1,
    [f['Vahak-2'].ai.rulHours, f['Vahak-3'].ai.rulHours, f['Vahak-1'].ai?.rulHours]);
  check(`Vahak-4 starting scenario (gearbox 0.25) found by its own AI: ${f['Vahak-4'].ai?.diagnosis} health ${f['Vahak-4'].ai?.health}`,
    f['Vahak-4'].ai?.diagnosis === 'PRGB_DEGRADATION' && Math.abs(f['Vahak-4'].ai.health - 75) <= 6, f['Vahak-4'].ai);
  check('Vahak-4 subsystem view flags the gearbox', f['Vahak-4'].subsystems?.gearbox?.status === 'FAULT', f['Vahak-4'].subsystems);

  console.log('\n[2] Per-vehicle fault injection');
  check('grounded vehicle refused (400)', (await post('/api/faults/inject', { uavId: 'Vahak-5', faultType: 'MISFIRE' })).status === 400);
  check('unknown vehicle refused (400)', (await post('/api/faults/inject', { uavId: 'Vahak-9', faultType: 'MISFIRE' })).status === 400);
  check('MISFIRE 0.6 on Vahak-3 accepted', (await post('/api/faults/inject', { uavId: 'Vahak-3', faultType: 'MISFIRE', severity: 0.6 })).status === 200);
  await sleep(12000);
  f = F();
  check(`Vahak-3 AI diagnoses MISFIRE, health ${f['Vahak-3'].ai?.health} (truth 40)`,
    f['Vahak-3'].ai?.diagnosis === 'MISFIRE' && Math.abs(f['Vahak-3'].ai.health - 40) <= 6, f['Vahak-3'].ai);
  check('no other vehicle affected', f['Vahak-1'].ai?.diagnosis === 'NONE' && f['Vahak-2'].ai?.diagnosis === 'NONE' && f['Vahak-1'].injectedFault === 'NONE',
    [f['Vahak-1'].ai?.diagnosis, f['Vahak-2'].ai?.diagnosis]);
  await post('/api/faults/clear', { uavId: 'Vahak-3' });
  await sleep(12000);
  check('Vahak-3 returns to NONE after clearing', F()['Vahak-3'].ai?.diagnosis === 'NONE', F()['Vahak-3'].ai);

  console.log('\n[3] RTB planner: GCS rules == planner service == gateway fallback');
  const { classifyVehicle, rtbAction, RTB_PROFILES } = await import('./src/planner/rtbRules.js');
  // second gateway whose AI service is unreachable -> exercises the gateway's own fallback planner
  const fbPort = gwPort + 1;
  start(process.execPath, ['server.js'], { PORT: String(fbPort), HOST: '127.0.0.1', AI_SERVICE_URL: 'http://127.0.0.1:9', GCS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'garuda-fb-')) });
  await waitHttp(`http://127.0.0.1:${fbPort}/api/health`, 30000);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const cases = [];
  // every threshold edge once, then random combinations
  for (const health of [null, 39.9, 40, 74.9, 75]) cases.push({ health, rul: 500, fault: 'NONE', fuel: 100, mode: 'AUTO_EVENT' });
  for (const rul of [null, 1.9, 2, 19.9, 20]) cases.push({ health: 100, rul, fault: 'NONE', fuel: 100, mode: 'AUTO_EVENT' });
  for (const fuel of [null, 22, 22.1, 34.9, 35]) cases.push({ health: 100, rul: 500, fault: 'NONE', fuel, mode: 'AUTO_EVENT' });
  for (let i = 0; i < 300; i++) cases.push({
    health: pick([null, 20, 39.9, 40, 60, 74.9, 75, 100]), rul: pick([null, 1, 2, 10, 19.9, 20, 751.4]),
    fault: pick(['NONE', 'NONE', 'MISFIRE', 'CYL3_INJECTOR', 'SENSOR_DRIFT', 'OIL_PUMP_CAVITATION']),
    fuel: pick([null, 15, 22, 30, 35, 120]), mode: pick(['AUTO_EVENT', 'FORCE_SIMULATION', 'CONTINGENCY_PREVIEW']),
  });
  const mism = { service: [], fallback: [] };
  for (const c of cases) {
    const expStatus = classifyVehicle({ health: c.health, rul: c.rul, fault: c.fault, fuel: c.fuel }).status;
    const expAction = rtbAction(expStatus, c.mode);
    const prof = RTB_PROFILES[expAction];
    const expThrottle = prof.throttle ?? 71.5;
    const body = { current_lat: 26.35, current_lng: 70.9, altitude_ft: 12000, engine_health_index: c.health, rul_hours: c.rul,
      diagnosed_fault: c.fault, fuel_remaining_liters: c.fuel, mode: c.mode, target_field_id: 'AUTO', current_throttle_pct: 71.5, current_rpm: 4600, current_airspeed_kts: 98 };
    for (const [name, base] of [['service', B], ['fallback', `http://127.0.0.1:${fbPort}`]]) {
      const r = await (await fetch(`${base}/api/rl-replan`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();
      const expField = prof.field === 'NEAREST' ? 'AFS_JAISALMER' : 'AFS_UTTARLAI';   // nearest to (26.35, 70.90) is Jaisalmer
      if (r.status !== expStatus || r.action !== expAction || r.target_field_id !== expField || r.rl_control_commands?.recommended_throttle_pct !== expThrottle) {
        if (mism[name].length < 3) mism[name].push({ c, got: [r.status, r.action, r.target_field_id, r.rl_control_commands?.recommended_throttle_pct], exp: [expStatus, expAction, expField, expThrottle] });
        mism[name].count = (mism[name].count || 0) + 1;
      }
    }
  }
  check(`planner service matches GCS rules on all ${cases.length} cases (status, action, airfield, throttle)`, !mism.service.count, mism.service);
  check(`gateway fallback matches GCS rules on all ${cases.length} cases`, !mism.fallback.count, mism.fallback);

  console.log('\n[4] What-If Test Bench: independent single-frame assessments');
  const BENCH = {
    A: [{ rpm: 4800, throttle_pct: 78.5, egt: [840, 840, 840, 840], cht: [106, 106, 106, 106], map_bar: 1.42, oil_press_bar: 3.85, oil_temp_c: 98, vibration_grms: 0.28, gen_voltage_v: 28.4 }, 'NONE'],
    B: [{ rpm: 4800, throttle_pct: 78.5, egt: [831.5, 833.2, 954.7, 832.4], cht: [106, 106, 129.8, 106], map_bar: 1.42, oil_press_bar: 3.85, oil_temp_c: 98, vibration_grms: 1.09, gen_voltage_v: 28.4 }, 'CYL3_INJECTOR'],
    C: [{ rpm: 4800, throttle_pct: 78.5, egt: [840, 840, 840, 840], cht: [106, 121.3, 124.7, 106], map_bar: 1.42, oil_press_bar: 2.45, oil_temp_c: 124.6, vibration_grms: 0.83, gen_voltage_v: 28.4 }, 'BLOW_BY'],
    D: [{ rpm: 4800, throttle_pct: 78.5, egt: [840, 840, 840, 840], cht: [106, 106, 106, 106], map_bar: 1.42, oil_press_bar: 1.9, oil_temp_c: 119.3, vibration_grms: 1.43, gen_voltage_v: 28.4 }, 'OIL_PUMP_CAVITATION'],
    E: [{ rpm: 5098, throttle_pct: 78.5, egt: [878.2, 875.7, 880.8, 877.4], cht: [106, 106, 106, 106], map_bar: 1.91, oil_press_bar: 3.85, oil_temp_c: 98, vibration_grms: 0.71, gen_voltage_v: 28.4 }, 'TURBO_WASTEGATE_STUCK'],
  };
  const bench = async (k) => (await post('/api/health-rul/predict', { ...BENCH[k][0], is_sandbox: true, mode: 'SANDBOX' })).body;
  const seq = ['A', 'B', 'C', 'D', 'E', 'A'];
  const outs = [];
  for (const k of seq) outs.push(await bench(k));
  check('each profile diagnosed correctly with one request, in any order',
    seq.every((k, i) => outs[i].health.diagnosed_fault === BENCH[k][1]), seq.map((k, i) => `${k}:${outs[i].health.diagnosed_fault}`));
  check('nominal profile gives the same result before and after fault profiles (no carry-over)',
    outs[0].rul.healthIndexScore === outs[5].rul.healthIndexScore && outs[0].health.diagnosed_fault === outs[5].health.diagnosed_fault,
    [outs[0].rul.healthIndexScore, outs[5].rul.healthIndexScore]);
} catch (e) {
  check('suite ran to completion', false, e.message);
} finally {
  sock.close();
  cleanup();
  console.log(`\nRESULTS: ${passed}/${passed + failed} CHECKS PASSED`);
  process.exit(failed ? 1 : 0);
}
