/**
 * Geofence suite: Vahak-1 orbits its station by default, routes that cross the border buffer are
 * refused, and flying straight at the border makes the guard return it to the station orbit.
 * Isolated gateway with a stub AI service (AI not needed). Runs in real time (~7 minutes).
 * Run: npm run test:geofence
 */
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';
import { STATION, GEOFENCE_RULES, localToLatLon, borderDistanceNm } from './src/planner/geofence.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:5173';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = (name, ok, info = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && info !== '' ? `  -> ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`);
};

const aiStub = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }); });
await new Promise(r => aiStub.listen(0, '127.0.0.1', r));
const port = 20000 + Math.floor(Math.random() * 20000);
const B = `http://127.0.0.1:${port}`;
const gw = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', GCS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'garuda-geo-')),
    AI_SERVICE_URL: `http://127.0.0.1:${aiStub.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
gw.stdout.on('data', () => {}); gw.stderr.on('data', () => {});
const cleanup = () => { try { gw.kill(); } catch { /* gone */ } aiStub.close(); };
process.on('exit', cleanup);
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${B}/api/health`)).ok) break; } catch { /* starting */ } await sleep(500); }

const H = { 'Content-Type': 'application/json', Origin: ORIGIN };
const post = async (p, b) => { const r = await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };
const get = async (p) => (await fetch(B + p, { headers: { Origin: ORIGIN } })).json();
const sock = io(B, { transports: ['websocket'], extraHeaders: { Origin: ORIGIN } });
await new Promise(r => sock.on('connect', r));
let fcs = null; const alerts = [];
sock.on('fcs_frame', d => { fcs = d; });
sock.on('geofence_alert', a => alerts.push(a));
const pos = () => { const { lat, lon } = localToLatLon(fcs.north_m, fcs.east_m); return { lat, lon, r: Math.hypot(fcs.north_m, fcs.east_m), border: borderDistanceNm(lat, lon) }; };

try {
  console.log('[1] Default flight: orbit the station');
  await sleep(3000);
  check('starts in LOITER (station orbit), not a straight heading', fcs.ap_mode === 'LOITER', fcs.ap_mode);
  let maxR = 0, minBorder = 1e9;
  for (let i = 0; i < 90; i++) { await sleep(1000); const p = pos(); maxR = Math.max(maxR, p.r); minBorder = Math.min(minBorder, p.border); }
  check(`stays near the station for 90 s (max ${(maxR / 1000).toFixed(1)} km from it, orbit radius ${STATION.radiusM / 1000} km)`, maxR < STATION.radiusM + 2500, maxR);
  check(`never closer than ${GEOFENCE_RULES.BORDER_BUFFER_NM} NM to the border (min ${minBorder.toFixed(1)} NM)`, minBorder >= GEOFENCE_RULES.BORDER_BUFFER_NM);
  check('no geofence intervention during normal patrol', alerts.length === 0 && fcs.geofence.status === 'OK', fcs.geofence);

  console.log('[2] Routes are checked before they are flown');
  const west = await post('/api/fcs/waypoints', { waypoints: [{ north: 0, east: -42000, alt_m: 4419.6 }] });
  check('route towards the border refused (409) with the reason', west.status === 409 && /border/.test(west.body.error), west.body);
  check('aircraft still orbiting after the refused route', fcs.ap_mode === 'LOITER', fcs.ap_mode);

  console.log('[3] Flying straight at the border (heading 270) -> guard returns the aircraft');
  await post('/api/fcs/mode', { mode: 'ALT_HOLD' });
  await post('/api/fcs/heading', { heading_deg: 270 });
  await sleep(2000);
  check('operator command accepted: ALT_HOLD heading west', fcs.ap_mode === 'ALT_HOLD', fcs.ap_mode);
  let minB = 1e9;
  for (let i = 0; i < 420 && !alerts.length; i++) { await sleep(1000); minB = Math.min(minB, pos().border); }
  const a = alerts[0];
  check('guard intervened before the aircraft reached the border buffer', !!a && a.borderNm >= GEOFENCE_RULES.BORDER_BUFFER_NM, a ?? `no alert; closest ${minB.toFixed(1)} NM`);
  if (a) console.log(`    intervention at ${a.lat}N ${a.lon}E, ${a.borderNm} NM from the border: ${a.reasons.join('; ')}`);
  await sleep(1500);
  check('autopilot switched back to the station orbit', fcs.ap_mode === 'LOITER' && fcs.geofence.status === 'RETURNING', [fcs.ap_mode, fcs.geofence.status]);
  for (let i = 0; i < 90; i++) { await sleep(1000); minB = Math.min(minB, pos().border); }
  check(`never inside the ${GEOFENCE_RULES.BORDER_BUFFER_NM} NM buffer (closest ${minB.toFixed(1)} NM)`, minB >= GEOFENCE_RULES.BORDER_BUFFER_NM);
  const sorties = await get('/api/database/sorties');
  const ev = await get(`/api/database/emergency/${sorties.active_sortie_id}`);
  const rows = ev.events ?? ev.rows ?? ev.data ?? [];
  check('intervention logged in emergency_events', rows.some(r => r.event_type === 'GEOFENCE_RETURN'), ev);
} catch (e) {
  check('suite ran to completion', false, e.message);
} finally {
  sock.close();
  cleanup();
  console.log(`\nRESULTS: ${passed}/${passed + failed} CHECKS PASSED`);
  process.exit(failed ? 1 : 0);
}
