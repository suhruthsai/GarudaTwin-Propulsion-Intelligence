#!/usr/bin/env node
/**
 * Cross-platform launcher (Windows / macOS / Linux).
 *
 *   npm run start:all     AI service + gateway + web UI, then verifies the live stream end to end
 *   npm run ai            AI service only
 *   npm run stop          stop anything listening on 8001 / 5002 / 5173
 *
 * Each service is only reported as up after its health check passes, and "operational" is only
 * printed once live telemetry AND AI results are actually arriving over the gateway socket.
 */
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const PORTS = { ai: 8001, gateway: 5002, web: 5173 };
const isWin = process.platform === 'win32';
const mode = process.argv[2] || 'all';
const children = [];
let startupDone = false;

const color = { ai: '\x1b[35m', gateway: '\x1b[36m', web: '\x1b[32m', err: '\x1b[31m', ok: '\x1b[32m', reset: '\x1b[0m' };
const say = (msg, c = 'reset') => console.log(`${color[c]}${msg}${color.reset}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fail(msg) {
  say(`\n✗ ${msg}`, 'err');
  shutdown(1);
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      if (isWin) execSync(`taskkill /PID ${c.pid} /T /F`, { stdio: 'ignore' });
      else c.kill('SIGTERM');
    } catch { /* already gone */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => { say('\nStopping services…'); shutdown(0); });

function pythonPath() {
  const candidates = [path.join(ROOT, 'ai_venv', 'Scripts', 'python.exe'), path.join(ROOT, 'ai_venv', 'bin', 'python')];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    fail('Python venv not found. Create it once (Python 3.12 recommended):\n' +
      (isWin ? '    py -3.12 -m venv ai_venv\n    ai_venv\\Scripts\\python -m pip install -r requirements.txt'
             : '    python3.12 -m venv ai_venv\n    ai_venv/bin/python -m pip install -r requirements.txt'));
  }
  return found;
}

const portInUse = (port) => new Promise((resolve) => {
  const srv = net.createServer().once('error', () => resolve(true)).once('listening', () => srv.close(() => resolve(false)));
  srv.listen(port, '0.0.0.0');
});

function pidsOnPort(port) {
  try {
    if (isWin) {
      return [...new Set(execSync('netstat -ano', { encoding: 'utf8' }).split('\n')
        .filter(l => l.includes('LISTENING') && new RegExp(`:${port}\\s`).test(l))
        .map(l => l.trim().split(/\s+/).pop()))];
    }
    return execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { return []; }
}

function run(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `${color[name]}[${name}]${color.reset} `;
  const pipe = (stream) => stream.on('data', d => String(d).split(/\r?\n/).filter(Boolean).forEach(l => console.log(prefix + l)));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    const msg = `${name} exited unexpectedly (code ${code}) — see the [${name}] lines above`;
    if (!startupDone) fail(msg);
    // After startup, keep the rest running (e.g. the UI shows "AI service offline")
    say(`✗ ${msg}`, 'err');
  });
  children.push(child);
  return child;
}

async function waitFor(name, url, timeoutMs, headers = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      if (r.ok) { say(`✓ ${name} ready (${((Date.now() - t0) / 1000).toFixed(1)} s)`, 'ok'); return; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  fail(`${name} did not become healthy at ${url} within ${timeoutMs / 1000} s`);
}

async function verifyLive() {
  const { io } = require('socket.io-client');
  const s = io(`http://127.0.0.1:${PORTS.gateway}`, { transports: ['websocket'], extraHeaders: { Origin: 'http://localhost:5173' } });
  let frames = 0, ai = null, aiErr = null;
  s.on('telemetry_frame', () => { frames++; });
  s.on('ai_prognostics', (r) => { ai = r; });
  s.on('ai_status', (st) => { aiErr = st.error; });
  await sleep(4000);
  s.close();
  if (frames < 20) fail(`live telemetry not flowing (${frames} frames in 4 s)`);
  if (!ai) fail(`gateway is not receiving AI results${aiErr ? `: ${aiErr}` : ''}`);
  say(`✓ live stream verified: telemetry ${(frames / 4).toFixed(0)} Hz, AI diagnosis "${ai.health.diagnosed_fault}", health ${ai.rul.healthIndexScore}`, 'ok');
}

async function main() {
  if (mode === 'stop') {
    for (const port of Object.values(PORTS)) {
      for (const pid of pidsOnPort(port)) {
        try { execSync(isWin ? `taskkill /PID ${pid} /T /F` : `kill ${pid}`, { stdio: 'ignore' }); say(`stopped PID ${pid} on :${port}`); } catch { /* ignore */ }
      }
    }
    return;
  }

  const wanted = mode === 'ai' ? ['ai'] : ['ai', 'gateway', 'web'];
  for (const svc of wanted) {
    if (await portInUse(PORTS[svc])) fail(`port ${PORTS[svc]} (${svc}) is already in use — run "npm run stop" first`);
  }

  say('GarudaTwin — starting services');
  run('ai', pythonPath(), ['ai_service.py'], { PYTHONIOENCODING: 'utf-8' });
  await waitFor('AI service', `http://127.0.0.1:${PORTS.ai}/health`, 90000);
  if (mode === 'ai') { startupDone = true; say('AI service running on http://127.0.0.1:8001 (Ctrl+C to stop)'); return; }

  run('gateway', process.execPath, ['server.js']);
  await waitFor('gateway', `http://127.0.0.1:${PORTS.gateway}/api/health`, 30000);

  run('web', process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')]);
  await waitFor('web UI', `http://localhost:${PORTS.web}/`, 60000);

  await verifyLive();
  startupDone = true;
  say('\n============================================================', 'ok');
  say('  All services operational — open http://localhost:5173', 'ok');
  say('  Ctrl+C stops everything', 'ok');
  say('============================================================\n', 'ok');
}

main().catch(err => fail(err.message));
