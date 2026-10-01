/**
 * Gateway CORS / origin / service-isolation test suite.
 * Starts an isolated gateway (temp data dir, random port) and a stub AI service.
 * Run: npm run test:security
 */
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { io } from 'socket.io-client';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED = 'http://localhost:5173';
const EVIL = 'http://evil.example';
const INTERNAL_KEY = crypto.randomBytes(32).toString('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0, failed = 0;
const check = (name, ok, info = '') => {
  ok ? passed++ : failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && info ? `  -> ${info}` : ''}`);
};

// Stub AI service: records what the gateway sends
const aiCalls = [];
const aiStub = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    aiCalls.push({ path: req.url, key: req.headers['x-internal-key'], body: body ? JSON.parse(body) : null });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ health: { diagnosed_fault: 'NONE' }, rul: { rulHours: 1 } }));
  });
});
await new Promise(r => aiStub.listen(0, '127.0.0.1', r));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'garuda-sec-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const B = `http://127.0.0.1:${port}`;
const gw = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', GCS_DATA_DIR: tmp,
    GCS_INTERNAL_KEY: INTERNAL_KEY, GCS_ALLOWED_ORIGINS: ALLOWED,
    AI_SERVICE_URL: `http://127.0.0.1:${aiStub.address().port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('gateway did not start')), 15000);
  gw.stdout.on('data', d => { if (String(d).includes('Running on')) { clearTimeout(t); resolve(); } });
  gw.on('exit', c => reject(new Error(`gateway exited ${c}`)));
});

const req = (method, p, { body, origin, raw } = {}) => fetch(B + p, {
  method,
  headers: {
    ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}),
    ...(origin ? { Origin: origin } : {}),
  },
  body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
});
const connect = (extraHeaders) => new Promise((resolve) => {
  const s = io(B, { transports: ['websocket'], reconnection: false, extraHeaders });
  const frames = [];
  s.on('telemetry_frame', f => frames.push(f));
  s.on('connect', () => resolve({ s, ok: true, frames }));
  s.on('connect_error', e => resolve({ s, ok: false, error: e.message, frames }));
});

try {
  console.log('\n[1] Open access from the GCS');
  let r = await req('GET', '/api/database/sorties', { origin: ALLOWED });
  check('allowed origin can read data (no login)', r.status === 200 && r.headers.get('access-control-allow-origin') === ALLOWED);
  r = await req('POST', '/api/faults/inject', { origin: ALLOWED, body: { faultType: 'BLOW_BY', severity: 0.85 } });
  check('allowed origin can inject faults', r.status === 200);
  await req('POST', '/api/faults/clear', { origin: ALLOWED, body: {} });
  let c = await connect({ Origin: ALLOWED });
  await sleep(400);
  check('allowed origin receives the telemetry stream', c.ok && c.frames.length > 0, c.error);
  c.s.close();

  console.log('\n[2] CORS & origin enforcement');
  r = await fetch(B + '/api/database/sorties', { method: 'OPTIONS', headers: { Origin: EVIL, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  check('preflight from foreign origin refused, no ACAO header', r.status === 403 && !r.headers.get('access-control-allow-origin'), `HTTP ${r.status}`);
  r = await req('POST', '/api/faults/inject', { origin: EVIL, body: { faultType: 'BLOW_BY' } });
  check('fault injection from a foreign web page refused (403)', r.status === 403);
  r = await req('GET', '/api/database/sorties', { origin: EVIL });
  check('data read from a foreign web page refused (403)', r.status === 403);
  r = await fetch(B + '/api/fcs/mode', { method: 'OPTIONS', headers: { Origin: ALLOWED, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  check('preflight from allowed origin: ACAO echoes it, credentials not allowed',
    r.status === 204 && r.headers.get('access-control-allow-origin') === ALLOWED && !r.headers.get('access-control-allow-credentials'));
  c = await connect({ Origin: EVIL });
  check('WebSocket from foreign Origin refused', !c.ok, c.error);
  c.s.close();
  r = await req('GET', '/api/health');
  check('security headers present', r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'DENY' && !r.headers.get('x-powered-by'));

  console.log('\n[3] Gateway -> AI service');
  await sleep(1300);
  const live = aiCalls.filter(a => a.path === '/api/health-rul/predict' && a.body?.uav_id === 'Vahak-1');
  check('gateway runs live inference itself with the internal key', live.length > 0 && live.every(a => a.key === INTERNAL_KEY));
  aiCalls.length = 0;
  r = await req('POST', '/api/health-rul/predict', { origin: ALLOWED, body: { uav_id: 'Vahak-1', rpm: 4800, egt: [999, 999, 999, 999] } });
  const proxied = aiCalls.find(a => a.path === '/api/health-rul/predict' && a.body?.egt?.[0] === 999);
  check('client predictions go to the sandbox session (cannot write to the live vehicle)', r.status === 200 && proxied?.body.uav_id === 'SANDBOX', proxied?.body.uav_id);

  console.log('\n[4] Input robustness');
  r = await req('POST', '/api/faults/inject', { raw: '{not json' });
  check('malformed JSON -> 400 JSON error (no stack trace)', r.status === 400 && (r.headers.get('content-type') || '').includes('application/json'));
  r = await req('POST', '/api/fcs/altitude', { body: { alt_ft: 'abc' } });
  check('non-numeric FCS input rejected', r.status === 400);
} catch (err) {
  failed++;
  console.error('  ✗ suite error:', err);
} finally {
  gw.kill();
  aiStub.close();
  await new Promise(r => gw.once('exit', r));
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nRESULTS: ${passed}/${passed + failed} CHECKS PASSED`);
process.exit(failed ? 1 : 0);
