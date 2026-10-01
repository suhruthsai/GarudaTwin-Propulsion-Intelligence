/**
 * Gateway service configuration (no user accounts: the GCS is open to anyone who can reach it).
 *
 *   GCS_ALLOWED_ORIGINS  browser origins allowed to call the gateway (CORS allowlist)
 *   GCS_INTERNAL_KEY     gateway -> AI service shared key
 *   GCS_INGEST_KEY       key a test rig / CAN bridge must send (X-Ingest-Key) to push live engine data
 * Otherwise the keys are created once in <dataDir>/service.json (the AI service and the CAN bridge read it).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export function loadServiceConfig({ dataDir, env = process.env }) {
  const file = path.join(dataDir, 'service.json');
  let stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  let changed = false;
  if (!env.GCS_INTERNAL_KEY && !stored.internalKey) { stored = { ...stored, internalKey: crypto.randomBytes(32).toString('hex') }; changed = true; }
  if (!env.GCS_INGEST_KEY && !stored.ingestKey) { stored = { ...stored, ingestKey: crypto.randomBytes(32).toString('hex') }; changed = true; }
  if (changed) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
  }
  const origins = (env.GCS_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(s => s.trim()).filter(Boolean);
  return {
    internalKey: env.GCS_INTERNAL_KEY || stored.internalKey,
    ingestKey: env.GCS_INGEST_KEY || stored.ingestKey,
    allowedOrigins: new Set(origins),
  };
}
