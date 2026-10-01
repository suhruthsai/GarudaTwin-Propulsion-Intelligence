/**
 * Engine flight recorder (SQLite).
 *
 * Every flight is recorded server-side: engine frames at 10 Hz for display, plus — flagged
 * `ai_input` — the exact frames (values and timestamps) the AI service scored, with the AI's
 * live output. Replaying those frames into a fresh AI session therefore reproduces the live
 * diagnoses exactly, which is what makes a replay trustworthy evidence.
 *
 * `truth_label` / `truth_severity` hold the injected simulator scenario or a CSV label column.
 * They are ground truth for evaluation only and are never sent to the AI.
 */
import { CHANNEL_NAMES, FRAME_SCHEMA_VERSION, normalizeFrame, parseCsv, csvCell } from './engineFrame.js';

const MAX_AUTO_RECORDINGS = 30;     // SIM/LIVE recordings kept (oldest pruned); CSV imports are kept
const MAX_IMPORT_ROWS = 200000;
const AI_MIN_SPACING_S = 0.9;       // CSV rows closer than this are display-only (AI is trained on ~1 Hz)
const SEGMENT_GAP_S = 5.0;          // larger time gaps start a new segment (fresh AI session)

export class Recorder {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS recordings (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL,
        source         TEXT    NOT NULL,           -- SIM | LIVE | CSV
        uav_id         TEXT,
        created_at     INTEGER NOT NULL,
        ended_at       INTEGER,
        duration_s     REAL    DEFAULT 0,
        frame_count    INTEGER DEFAULT 0,
        ai_frame_count INTEGER DEFAULT 0,
        segment_count  INTEGER DEFAULT 1,
        has_truth      INTEGER DEFAULT 0,
        notes          TEXT,
        schema_version INTEGER DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS engine_frames (
        recording_id   INTEGER NOT NULL,
        seq            INTEGER NOT NULL,
        t_s            REAL    NOT NULL,           -- playback time from start of recording
        segment        INTEGER NOT NULL DEFAULT 0, -- independent stretches of data (fresh AI session each)
        ai_input       INTEGER NOT NULL DEFAULT 0, -- 1 = frame scored by the AI
        ai_time_s      REAL,                       -- exact time base sent to the AI with this frame
        ${CHANNEL_NAMES.map(c => `${c} REAL`).join(',\n        ')},
        truth_label    TEXT,
        truth_severity REAL,
        live_diagnosis TEXT,
        live_health    REAL,
        live_rul       REAL,
        PRIMARY KEY (recording_id, seq)
      );
    `);
    // Migrate databases created before newer channels existed (old rows keep NULL; they are not replayable)
    const have = new Set(db.prepare(`PRAGMA table_info(engine_frames)`).all().map(c => c.name));
    for (const c of CHANNEL_NAMES) if (!have.has(c)) db.exec(`ALTER TABLE engine_frames ADD COLUMN ${c} REAL`);
    const haveRec = new Set(db.prepare(`PRAGMA table_info(recordings)`).all().map(c => c.name));
    if (!haveRec.has('schema_version')) db.exec(`ALTER TABLE recordings ADD COLUMN schema_version INTEGER DEFAULT 1`);

    const cols = ['recording_id', 'seq', 't_s', 'segment', 'ai_input', 'ai_time_s', ...CHANNEL_NAMES,
      'truth_label', 'truth_severity', 'live_diagnosis', 'live_health', 'live_rul'];
    this._cols = cols;
    this._ins = db.prepare(`INSERT INTO engine_frames (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    this._insMany = db.transaction((rows) => { for (const r of rows) this._ins.run(...cols.map(c => r[c] ?? null)); });
    this._updLive = db.prepare(`UPDATE engine_frames SET live_diagnosis=?, live_health=?, live_rul=? WHERE recording_id=? AND seq=?`);
    this.active = null;   // { id, t0, seq, buf, aiCount, frames, hasTruth, lastT }
  }

  // ── live recording ─────────────────────────────────────────
  start({ source, name, uavId }) {
    this.stop();
    const id = this.db.prepare(`INSERT INTO recordings (name, source, uav_id, created_at, schema_version) VALUES (?,?,?,?,?)`)
      .run(name, source, uavId, Date.now(), FRAME_SCHEMA_VERSION).lastInsertRowid;
    this.active = { id: Number(id), t0: null, seq: 0, segment: 0, buf: [], aiCount: 0, frames: 0, hasTruth: false, lastT: 0 };
    return this.active.id;
  }

  /** Record one frame. timeS = data time (sim/device time); returns the row seq. */
  record(timeS, frame, { aiInput = false, truthLabel = null, truthSeverity = null } = {}) {
    const a = this.active;
    if (!a) return null;
    if (a.t0 === null) a.t0 = timeS;
    const row = {
      recording_id: a.id, seq: a.seq++, t_s: timeS - a.t0, segment: a.segment,
      ai_input: aiInput ? 1 : 0, ai_time_s: aiInput ? timeS : null, ...frame,
      truth_label: truthLabel, truth_severity: truthSeverity,
    };
    a.buf.push(row);
    a.frames++;
    if (aiInput) a.aiCount++;
    if (truthLabel && truthLabel !== 'NONE') a.hasTruth = true;
    a.lastT = Math.max(a.lastT, row.t_s);
    return row.seq;
  }

  /** The live AI session was restarted (e.g. after an AI-service error): replay must restart it here too. */
  newSegment() { if (this.active) this.active.segment++; }

  /** Attach the AI's live output to a recorded AI frame. */
  setLiveResult(seq, result) {
    const a = this.active;
    if (!a || seq === null || !result) return;
    const vals = [result.health?.diagnosed_fault ?? null, result.rul?.healthIndexScore ?? null, result.rul?.rulHours ?? null];
    const buffered = a.buf.find(r => r.seq === seq);
    if (buffered) [buffered.live_diagnosis, buffered.live_health, buffered.live_rul] = vals;
    else this._updLive.run(...vals, a.id, seq);
  }

  flush() {
    const a = this.active;
    if (!a || !a.buf.length) return;
    this._insMany(a.buf);
    a.buf = [];
    this.db.prepare(`UPDATE recordings SET duration_s=?, frame_count=?, ai_frame_count=?, segment_count=?, has_truth=? WHERE id=?`)
      .run(a.lastT, a.frames, a.aiCount, a.segment + 1, a.hasTruth ? 1 : 0, a.id);
  }

  stop() {
    const a = this.active;
    if (!a) return;
    this.flush();
    this.active = null;
    if (a.aiCount < 2) { this.delete(a.id); return; }   // nothing replayable
    this.db.prepare(`UPDATE recordings SET ended_at=? WHERE id=?`).run(Date.now(), a.id);
    const old = this.db.prepare(`SELECT id FROM recordings WHERE source != 'CSV' ORDER BY id DESC LIMIT -1 OFFSET ?`)
      .all(MAX_AUTO_RECORDINGS);
    for (const { id } of old) this.delete(id);
  }

  // ── stored recordings ──────────────────────────────────────
  list() {
    return this.db.prepare(`SELECT * FROM recordings ORDER BY id DESC`).all()
      .map(r => ({ ...r, recording: this.active?.id === r.id }));
  }

  meta(id) {
    return this.db.prepare(`SELECT * FROM recordings WHERE id=?`).get(id) ?? null;
  }

  frames(id) {
    if (this.active?.id === id) this.flush();
    return this.db.prepare(`SELECT * FROM engine_frames WHERE recording_id=? ORDER BY t_s, seq`).all(id);
  }

  delete(id) {
    this.db.prepare(`DELETE FROM engine_frames WHERE recording_id=?`).run(id);
    this.db.prepare(`DELETE FROM recordings WHERE id=?`).run(id);
  }

  exportCsv(id) {
    const head = ['t_s', 'episode', 'ai_input', 'ai_time_s', ...CHANNEL_NAMES, 'label', 'severity',
      'live_diagnosis', 'live_health', 'live_rul'];
    const lines = [head.join(',')];
    for (const r of this.frames(id)) {
      lines.push([r.t_s, r.segment, r.ai_input, r.ai_time_s, ...CHANNEL_NAMES.map(c => r[c]),
        r.truth_label, r.truth_severity, r.live_diagnosis, r.live_health, r.live_rul].map(csvCell).join(','));
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Import a CSV as a recording. Required columns: a time column (t_s | time_s | timestamp_s, seconds)
   * and all 21 channels. Optional: episode (segments), label + severity (ground truth),
   * ai_input + ai_time_s (written by exportCsv; reproduces the exact AI frames).
   * The whole file is rejected if any row is invalid, so the AI never scores a stream with holes.
   */
  importCsv(text, name) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { error: 'CSV has no data rows' };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = (n) => head.indexOf(n);
    const timeCol = ['t_s', 'time_s', 'timestamp_s'].map(col).find(i => i >= 0);
    if (timeCol === undefined) return { error: 'CSV needs a time column in seconds: t_s, time_s or timestamp_s' };
    const missing = CHANNEL_NAMES.filter(c => col(c) < 0);
    if (missing.length) return { error: `CSV is missing channel columns: ${missing.join(', ')}` };
    if (rows.length - 1 > MAX_IMPORT_ROWS) return { error: `too many rows (max ${MAX_IMPORT_ROWS})` };
    const iEp = col('episode'), iLabel = col('label'), iSev = col('severity');
    const iAi = col('ai_input'), iAiT = col('ai_time_s');

    const out = [], errors = [];
    let segment = -1, segStartT = 0, segOffset = 0, prevT = null, prevEp = null, lastAiT = -Infinity, playEnd = 0;
    let hasTruth = false, aiCount = 0;
    for (let k = 1; k < rows.length; k++) {
      const r = rows[k];
      const obj = {};
      for (const c of CHANNEL_NAMES) obj[c] = r[col(c)];
      const { frame, error } = normalizeFrame(obj);
      const t = Number(r[timeCol]);
      if (error || !Number.isFinite(t)) {
        if (errors.length < 5) errors.push(`row ${k + 1}: ${error ?? `bad time '${r[timeCol]}'`}`);
        continue;
      }
      const ep = iEp >= 0 ? r[iEp] : null;
      if (prevT === null || ep !== prevEp || t < prevT || t - prevT > SEGMENT_GAP_S) {
        segment++;
        segOffset = out.length ? playEnd + 1.0 : 0;   // 1 s gap between segments on the timeline
        segStartT = t;
        lastAiT = -Infinity;
      }
      prevT = t; prevEp = ep;
      const playT = segOffset + (t - segStartT);
      playEnd = playT;
      let aiInput;
      if (iAi >= 0) aiInput = r[iAi] === '1';
      else aiInput = t - lastAiT >= AI_MIN_SPACING_S;
      if (aiInput) { lastAiT = t; aiCount++; }
      const aiT = iAiT >= 0 && r[iAiT] !== '' ? Number(r[iAiT]) : t;
      const label = iLabel >= 0 ? (r[iLabel] || '').trim() || null : null;
      if (label && label !== 'NONE') hasTruth = true;
      out.push({
        seq: out.length, t_s: playT, segment, ai_input: aiInput ? 1 : 0, ai_time_s: aiInput ? aiT : null,
        ...frame, truth_label: label, truth_severity: iSev >= 0 && r[iSev] !== '' ? Number(r[iSev]) : null,
      });
    }
    if (errors.length) return { error: `invalid rows (file rejected): ${errors.join('; ')}` };
    if (aiCount < 2) return { error: 'not enough samples for the AI (need at least 2 rows ~1 s apart)' };

    const id = Number(this.db.prepare(`INSERT INTO recordings (name, source, created_at, ended_at, duration_s, frame_count,
        ai_frame_count, segment_count, has_truth, schema_version) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(name, 'CSV', Date.now(), Date.now(), playEnd, out.length, aiCount, segment + 1, hasTruth ? 1 : 0, FRAME_SCHEMA_VERSION).lastInsertRowid);
    for (const row of out) row.recording_id = id;
    this._insMany(out);
    return { id, frames: out.length, aiFrames: aiCount, segments: segment + 1, durationS: playEnd, hasTruth };
  }
}
