/**
 * Data source / flight recorder / replay / live ingest test suite (real AI service).
 * Starts an isolated AI service and gateway (temp data dir, random ports). Takes ~3-4 minutes.
 * Run: npm run test:data
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'garuda-data-'));
const INTERNAL_KEY = crypto.randomBytes(32).toString('hex');
const INGEST_KEY = crypto.randomBytes(32).toString('hex');
const aiPort = 20000 + Math.floor(Math.random() * 10000);
const gwPort = aiPort + 10000;
const B = `http://127.0.0.1:${gwPort}`;
const env = { ...process.env, GCS_DATA_DIR: tmp, GCS_INTERNAL_KEY: INTERNAL_KEY, GCS_INGEST_KEY: INGEST_KEY, PYTHONIOENCODING: 'utf-8' };
const py = process.platform === 'win32' ? path.join(ROOT, 'ai_venv', 'Scripts', 'python.exe') : path.join(ROOT, 'ai_venv', 'bin', 'python');

const procs = [];
function start(cmd, args, extraEnv) {
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  procs.push(p);
  return p;
}
async function waitHttp(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
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
const IH = { 'Content-Type': 'application/json', 'X-Ingest-Key': INGEST_KEY };
const post = async (p, body, headers = H) => {
  const r = await fetch(B + p, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const get = async (p) => (await fetch(B + p, { headers: { Origin: ORIGIN } })).json();
async function replayToEnd(id) {
  await post('/api/replay/load', { id });
  await post('/api/replay/control', { action: 'speed', value: 10 });
  await post('/api/replay/control', { action: 'play' });
  let st;
  do { await sleep(500); st = await get('/api/source'); } while (!(st.replay.ended && st.replay.aiQueue === 0) && !st.replay.error);
  await sleep(400);
  return get('/api/source');
}

const sock = io(B, { transports: ['websocket'], extraHeaders: { Origin: ORIGIN } });
await new Promise(r => sock.on('connect', r));
let tel = null;
const ai = [];
sock.on('telemetry_frame', d => { tel = d; });
sock.on('ai_prognostics', d => ai.push(d));

// fixture: unseen simulator episodes
const lines = fs.readFileSync(path.join(ROOT, 'ai_health_rul/tests/fixtures/sim_episodes.csv'), 'utf8').trim().split('\n');
const head = lines[0].split(',');
const rows = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
const episodeOf = (fc) => [...new Set(rows.filter(r => r.fault_class === fc).map(r => r.episode))]
  .find(e => !rows.some(r => r.episode === e && r.phase === 'recovery')
    && rows.filter(r => r.episode === e && (r.phase === 'fault' || r.phase === 'nominal')).length > 30);

try {
  console.log('\n[1] Simulator flight recording -> replay reproduces the live AI exactly');
  await post('/api/fcs/reset');
  await sleep(8000);
  await post('/api/faults/inject', { faultType: 'MISFIRE', severity: 0.7 });
  await sleep(14000);
  await post('/api/faults/clear');
  await sleep(6000);
  const simRecId = (await get('/api/source')).recordingId;
  const live = ai.filter(a => a.source?.mode === 'SIM').length;
  check('live AI scored the simulator at ~1 Hz', live >= 22, live);
  let st = await replayToEnd(simRecId);
  const meta = (await get('/api/recordings')).find(r => r.id === simRecId);
  check(`replay diagnoses identical to live (${st.replay.stats.liveAgree}/${st.replay.stats.liveN})`,
    st.replay.stats.liveN === meta.ai_frame_count && st.replay.stats.liveAgree === st.replay.stats.liveN, st.replay.stats);
  check('recording carries the injected scenario as ground truth', meta.has_truth === 1 && st.replay.stats.truthN === meta.ai_frame_count);
  check('fault injection refused during replay (409)', (await post('/api/faults/inject', { faultType: 'MISFIRE' })).status === 409);
  check('replaying recording cannot be deleted (409)', (await post(`/api/recordings/${simRecId}/delete`)).status === 409);

  console.log('\n[2] CSV import -> replay through twin + AI');
  const eps = ['MISFIRE', 'COMBUSTION_INSTABILITY', 'INJECTOR_COKING', 'SENSOR_DRIFT', 'NONE'].map(episodeOf);
  check('fixture has a usable episode for each class', eps.every(Boolean), eps);
  const sub = [head.join(','), ...lines.slice(1).filter((l, i) => eps.includes(rows[i].episode))].join('\n');
  const importCsv = (text, name) => fetch(`${B}/api/recordings/import?name=${name}`, { method: 'POST', headers: { 'Content-Type': 'text/csv', Origin: ORIGIN }, body: text })
    .then(async r => ({ status: r.status, body: await r.json() }));
  const imp = await importCsv(sub, 'test-subset');
  check('import: one segment per episode, every ~1 Hz row is an AI sample', imp.status === 200 && imp.body.segments === 5 && imp.body.aiFrames === imp.body.frames, imp.body);
  const noRpm = sub.replace(/^([^\n]*?)\brpm\b/, '$1rpm_x');
  const bad = await importCsv(noRpm, 'bad');
  check('import without a required channel rejected with its name', bad.status === 400 && /rpm/.test(bad.body.error), bad.body);
  st = await replayToEnd(imp.body.id);
  const acc = st.replay.stats.truthAgree / st.replay.stats.truthN;
  check(`every imported AI sample scored (${st.replay.stats.scored}/${imp.body.aiFrames})`, st.replay.stats.scored === imp.body.aiFrames);
  check(`agreement with labels >= 90% (${(100 * acc).toFixed(1)}%, incl. onset delay)`, acc >= 0.9, st.replay.stats.confusion);
  const csv = await (await fetch(`${B}/api/recordings/${imp.body.id}/export.csv`, { headers: { Origin: ORIGIN } })).text();
  const back = await importCsv(csv, 'roundtrip');
  check('export -> import round trip keeps frames, AI samples and segments', back.body.frames === imp.body.frames && back.body.aiFrames === imp.body.aiFrames && back.body.segments === 5, back.body);

  console.log('\n[3] Live ingest (test rig / CAN bridge path)');
  const ep = episodeOf('MISFIRE');
  const epRows = rows.filter(r => r.episode === ep && r.phase === 'fault').slice(-16);
  const CH = ['rpm', 'throttle', 'egt1', 'egt2', 'egt3', 'egt4', 'cht1', 'cht2', 'cht3', 'cht4', 'map_bar', 'oil_pressure', 'oil_temp', 'vibration', 'fuel_flow', 'lambda', 'gen_voltage', 'gen_current', 'coolant_temp'];
  const toFrame = r => ({ t_s: Number(r.t_s), ...Object.fromEntries(CH.map(c => [c, Number(r[c])])) });
  check('ingest refused unless source is LIVE (409)', (await post('/api/ingest/frames', { frames: [toFrame(epRows[0])] }, IH)).status === 409);
  await post('/api/source', { mode: 'LIVE' });
  check('ingest without the key refused (401)', (await post('/api/ingest/frames', { frames: [toFrame(epRows[0])] }, { 'Content-Type': 'application/json' })).status === 401);
  await sleep(700);
  check('no frame yet -> NO_DATA, never NOMINAL', tel.health.status === 'NO_DATA', tel.health.status);
  const missing = toFrame(epRows[0]); delete missing.lambda;
  const r1 = await post('/api/ingest/frames', { frames: [missing] }, IH);
  check('frame missing a channel rejected with its name', r1.status === 400 && /lambda/.test(r1.body.errors[0]), r1.body);
  const n0 = ai.length;
  for (let i = 0; i < epRows.length; i++) {
    await post('/api/ingest/frames', { frames: [toFrame(epRows[i])] }, IH);
    if (i + 1 < epRows.length) await sleep((Number(epRows[i + 1].t_s) - Number(epRows[i].t_s)) * 1000);
  }
  await sleep(1300);
  const liveAi = ai.slice(n0).filter(a => a.source?.mode === 'LIVE');
  check(`live AI diagnoses MISFIRE from ingested frames (last of ${liveAi.length})`, liveAi.at(-1)?.health.diagnosed_fault === 'MISFIRE', liveAi.at(-1)?.health.diagnosed_fault);
  check('out-of-order timestamp rejected', (await post('/api/ingest/frames', { frames: [toFrame(epRows[0])] }, IH)).status === 400);
  await sleep(2200);
  check('feed stops -> NO_DATA within 2.2 s', tel.health.status === 'NO_DATA', tel.health.status);
  const nAi = ai.length; await sleep(1500);
  check('stale frame is not re-scored', ai.length === nAi, ai.length - nAi);
  const liveRecId = (await get('/api/source')).recordingId;
  st = await replayToEnd(liveRecId);
  check(`replay of the live recording identical (${st.replay.stats.liveAgree}/${st.replay.stats.liveN})`,
    st.replay.stats.liveN === liveAi.length && st.replay.stats.liveAgree === liveAi.length, st.replay.stats);

  await post('/api/source', { mode: 'SIM' });
  await sleep(2500);
  check('back to SIM: simulator data and AI flowing', tel.source.mode === 'SIM' && ai.at(-1)?.source?.mode === 'SIM');
} catch (e) {
  check('suite ran to completion', false, e.message);
} finally {
  sock.close();
  cleanup();
  console.log(`\nRESULTS: ${passed}/${passed + failed} CHECKS PASSED`);
  process.exit(failed ? 1 : 0);
}
