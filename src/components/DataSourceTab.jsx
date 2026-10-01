import React, { useCallback, useEffect, useState } from 'react';
import { Database, Play, Pause, Upload, Download, Trash2, Radio, Cpu, RotateCcw, AlertTriangle, CheckCircle2, Square } from 'lucide-react';
import { useTelemetry } from '../context/TelemetryContext';
import { GATEWAY_URL, gatewayFetch } from '../api/gateway';

const SPEEDS = [0.5, 1, 2, 5, 10];

const fmtT = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

async function api(path, { method = 'GET', body, csv } = {}) {
  const headers = csv !== undefined ? { 'Content-Type': 'text/csv' } : body ? { 'Content-Type': 'application/json' } : undefined;
  const r = await gatewayFetch(path, { method, headers, body: csv ?? (body ? JSON.stringify(body) : undefined) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const Panel = ({ title, icon: Icon, right, children }) => (
  <div className="gcs-panel rounded-lg border border-slate-200 p-3.5 shadow-xs bg-white">
    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200 gap-2">
      <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase flex items-center gap-2">
        <Icon className="w-4 h-4 text-sky-600" /> {title}
      </h3>
      {right}
    </div>
    {children}
  </div>
);

const Btn = ({ onClick, disabled, active, danger, children, title }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`px-2.5 py-1.5 rounded-md border text-xs font-mono font-semibold flex items-center gap-1.5 shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? 'bg-sky-600 border-sky-600 text-white'
        : danger ? 'bg-white border-red-200 text-red-700 hover:bg-red-50'
        : 'bg-white border-slate-300 text-slate-800 hover:bg-slate-50'
    }`}
  >
    {children}
  </button>
);

export function DataSourceTab() {
  const { telemetry, aiPrognostics } = useTelemetry();
  const src = telemetry?.source || { mode: 'SIM' };
  const replay = src.replay;
  const [recordings, setRecordings] = useState([]);
  const [message, setMessage] = useState(null);   // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);
  const [seekValue, setSeekValue] = useState(null);

  const refresh = useCallback(() => {
    api('/api/recordings').then(setRecordings).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (fn, okText) => {
    setBusy(true);
    setMessage(null);
    try {
      const out = await fn();
      if (okText) setMessage({ kind: 'ok', text: typeof okText === 'function' ? okText(out) : okText });
      refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const setMode = (mode) => run(() => api('/api/source', { method: 'POST', body: { mode } }));
  const control = (action, value) => run(() => api('/api/replay/control', { method: 'POST', body: { action, value } }));
  const load = (id) => run(() => api('/api/replay/load', { method: 'POST', body: { id } }), 'Recording loaded — press Play.');
  const remove = (r) => {
    if (!window.confirm(`Delete recording #${r.id} "${r.name}"? This cannot be undone.`)) return;
    run(() => api(`/api/recordings/${r.id}/delete`, { method: 'POST' }), `Recording #${r.id} deleted.`);
  };
  const exportCsv = (r) => window.open(`${GATEWAY_URL}/api/recordings/${r.id}/export.csv`, '_blank');
  const importCsv = async (file) => {
    if (!file) return;
    const text = await file.text();
    run(() => api(`/api/recordings/import?name=${encodeURIComponent(file.name)}`, { method: 'POST', csv: text }),
      (o) => `Imported "${file.name}": ${o.frames} frames, ${o.aiFrames} AI samples, ${o.segments} segment(s), ${fmtT(o.durationS)}${o.hasTruth ? ', with ground-truth labels' : ''}.`);
  };
  const commitSeek = () => {
    if (seekValue === null) return;
    const v = seekValue;
    setSeekValue(null);
    control('seek', v);
  };

  const live = src.live;
  const dx = aiPrognostics?.diagnosed_fault ?? 'NONE';
  const stats = replay?.stats;
  const confusion = stats ? Object.entries(stats.confusion).filter(([k]) => { const [a, b] = k.split('->'); return a !== b; })
    .sort((a, b) => b[1] - a[1]).slice(0, 6) : [];

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-3 pb-6 pr-1">
      {message && (
        <div role="alert" className={`px-3 py-2 rounded-md text-xs font-mono border ${message.kind === 'error' ? 'bg-red-50 border-red-300 text-red-800' : 'bg-emerald-50 border-emerald-300 text-emerald-800'}`}>
          {message.text}
        </div>
      )}

      {/* 1. Source selector */}
      <Panel title="Engine data source" icon={Database}
        right={<span className="text-[11px] font-mono text-slate-500">Everything downstream (golden twin, AI, alarms, every tab) reads the selected source</span>}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
          <div className={`rounded-md border p-3 ${src.mode === 'SIM' ? 'border-sky-400 bg-sky-50' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-xs font-bold text-slate-900 flex items-center gap-1.5"><Cpu className="w-3.5 h-3.5" /> SIMULATOR</span>
              {src.mode === 'SIM' ? <span className="text-[10px] font-mono font-bold text-sky-700">ACTIVE</span>
                : <Btn onClick={() => setMode('SIM')} disabled={busy}>Use</Btn>}
            </div>
            <p className="text-[11px] text-slate-600 leading-snug">Built-in physics engine model. Fault injection works only here. Every flight is recorded automatically (10 Hz + the exact samples the AI scored).</p>
            {src.mode === 'SIM' && src.recordingId && <p className="text-[11px] font-mono text-red-600 mt-1.5">● recording #{src.recordingId}</p>}
          </div>

          <div className={`rounded-md border p-3 ${src.mode === 'LIVE' ? 'border-sky-400 bg-sky-50' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-xs font-bold text-slate-900 flex items-center gap-1.5"><Radio className="w-3.5 h-3.5" /> LIVE INGEST (TEST RIG / CAN)</span>
              {src.mode === 'LIVE' ? <span className="text-[10px] font-mono font-bold text-sky-700">ACTIVE</span>
                : <Btn onClick={() => setMode('LIVE')} disabled={busy}>Use</Btn>}
            </div>
            {src.mode === 'LIVE' && live ? (
              <div className="text-[11px] font-mono space-y-0.5">
                <div className={live.connected ? 'text-emerald-700 font-bold' : 'text-amber-700 font-bold'}>
                  {live.connected ? '● RECEIVING' : live.lastFrameAgeMs === null ? '○ WAITING FOR FIRST FRAME' : `○ NO DATA (${(live.lastFrameAgeMs / 1000).toFixed(0)} s)`}
                </div>
                <div className="text-slate-600">frames accepted {live.frames} · rejected {live.rejected}</div>
                {live.lastError && <div className="text-red-700 break-words">last rejection: {live.lastError}</div>}
                {src.recordingId && <div className="text-red-600">● recording #{src.recordingId}</div>}
              </div>
            ) : (
              <p className="text-[11px] text-slate-600 leading-snug">Frames pushed to <code>POST /api/ingest/frames</code> (key in data/service.json) by a test rig or the CAN bridge. No data for 2 s shows NO_DATA, never NOMINAL.</p>
            )}
          </div>

          <div className={`rounded-md border p-3 ${src.mode === 'REPLAY' ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-mono text-xs font-bold text-slate-900 flex items-center gap-1.5"><RotateCcw className="w-3.5 h-3.5" /> REPLAY</span>
              {src.mode === 'REPLAY' && <span className="text-[10px] font-mono font-bold text-amber-700">ACTIVE</span>}
            </div>
            <p className="text-[11px] text-slate-600 leading-snug">A recorded flight or imported CSV played through the same golden twin and AI (separate AI session). Pick one from the list below.</p>
          </div>
        </div>
        {src.mode === 'LIVE' && (
          <div className="mt-2.5 text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-md p-2.5 text-slate-700 space-y-1">
            <div className="font-bold text-slate-800">CAN bridge (decodes with tools/can/garudatwin_engine.dbc):</div>
            <div>No hardware — virtual engine rig on a software CAN bus:</div>
            <code className="block bg-white border border-slate-200 rounded px-2 py-1 select-all">ai_venv\Scripts\python tools\can\can_bridge.py --interface virtual --set-live --demo-csv ai_health_rul\tests\fixtures\sim_episodes.csv --episode 58</code>
            <div>Real adapter (example):</div>
            <code className="block bg-white border border-slate-200 rounded px-2 py-1 select-all">ai_venv\Scripts\python tools\can\can_bridge.py --interface pcan --channel PCAN_USBBUS1 --bitrate 500000 --set-live</code>
          </div>
        )}
      </Panel>

      {/* 2. Replay deck */}
      {src.mode === 'REPLAY' && replay && (
        <Panel title={`Replay — ${replay.name}`} icon={RotateCcw}
          right={<Btn onClick={() => setMode('SIM')} disabled={busy} title="Stop the replay and return to the simulator"><Square className="w-3 h-3" /> Stop replay</Btn>}>
          {replay.error && (
            <div className="mb-2.5 px-3 py-2 rounded-md text-xs font-mono bg-amber-50 border border-amber-300 text-amber-800 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {replay.error}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-2.5">
            {replay.playing
              ? <Btn onClick={() => control('pause')} disabled={busy}><Pause className="w-3.5 h-3.5" /> Pause</Btn>
              : <Btn onClick={() => control('play')} disabled={busy}><Play className="w-3.5 h-3.5" /> {replay.ended ? 'Replay again' : 'Play'}</Btn>}
            <div className="flex items-center gap-1">
              {SPEEDS.map(s => <Btn key={s} active={replay.speed === s} onClick={() => control('speed', s)} disabled={busy}>{s}×</Btn>)}
            </div>
            <span className="font-mono text-xs text-slate-700 tabular-nums ml-auto">
              {fmtT(seekValue ?? replay.t_s)} / {fmtT(replay.duration_s)}
              {replay.aiQueue > 0 && <span className="text-slate-400"> · AI queue {replay.aiQueue}</span>}
            </span>
          </div>
          <input
            type="range" min={0} max={replay.duration_s} step={0.1}
            value={seekValue ?? replay.t_s}
            onChange={(e) => setSeekValue(Number(e.target.value))}
            onPointerUp={commitSeek} onKeyUp={commitSeek}
            aria-label="Replay position"
            className="w-full accent-sky-600"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 mt-3">
            <div className="rounded-md border border-slate-200 p-2.5">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Recording label (ground truth)</div>
              <div className="font-mono text-sm font-bold text-slate-900">{replay.truth ?? (replay.hasTruth ? 'NONE' : 'no labels')}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Shown for evaluation only — never sent to the AI.</div>
            </div>
            <div className="rounded-md border border-slate-200 p-2.5">
              <div className="text-[10px] font-mono text-slate-500 uppercase">AI diagnosis (replay session)</div>
              <div className={`font-mono text-sm font-bold flex items-center gap-1.5 ${replay.truth && replay.truth !== dx ? 'text-amber-700' : 'text-slate-900'}`}>
                {replay.truth && (replay.truth === dx ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertTriangle className="w-3.5 h-3.5" />)}
                {dx}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Health {aiPrognostics?.engine_health_index?.toFixed?.(1) ?? '—'} · RUL {aiPrognostics?.rul_hours_mean?.toFixed?.(1) ?? '—'} h</div>
            </div>
            <div className="rounded-md border border-slate-200 p-2.5">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Agreement with labels (per sample)</div>
              <div className="font-mono text-sm font-bold text-slate-900">{stats?.truthN ? `${pct(stats.truthAgree, stats.truthN)} (${stats.truthAgree}/${stats.truthN})` : '—'}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Includes detection delay (~1–2 s) and ~8 s to clear after a fault ends.</div>
            </div>
            <div className="rounded-md border border-slate-200 p-2.5">
              <div className="text-[10px] font-mono text-slate-500 uppercase">Reproduces live AI diagnoses</div>
              <div className={`font-mono text-sm font-bold ${stats?.liveN && stats.liveAgree === stats.liveN ? 'text-emerald-700' : 'text-slate-900'}`}>
                {stats?.liveN ? `${stats.liveAgree}/${stats.liveN} identical` : '—'}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {!replay.hasLive ? 'Not applicable: this data has no live AI results (imported file).'
                  : stats?.firstLiveMismatch ? `first mismatch at ${fmtT(stats.firstLiveMismatch.t_s)}: live ${stats.firstLiveMismatch.live}, replay ${stats.firstLiveMismatch.replay}`
                  : replay.exact ? 'Same samples, same AI, fresh session: must match exactly.' : 'Checked from a recorded session start (suspended after a seek).'}
              </div>
            </div>
          </div>
          {confusion.length > 0 && (
            <div className="mt-2.5 text-[11px] font-mono text-slate-600">
              Disagreements (label → AI): {confusion.map(([k, n]) => <span key={k} className="mr-3">{k.replace('->', ' → ')} ×{n}</span>)}
            </div>
          )}
        </Panel>
      )}

      {/* 3. Recordings */}
      <Panel title="Flight recordings & imported data" icon={Database}
        right={
          <label className={`px-2.5 py-1.5 rounded-md border text-xs font-mono font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer bg-white border-slate-300 text-slate-800 hover:bg-slate-50 ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
            <Upload className="w-3.5 h-3.5" /> Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { importCsv(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        }>
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5 pr-2">#</th><th className="pr-2">Name</th><th className="pr-2">Source</th><th className="pr-2">Duration</th>
                <th className="pr-2">AI samples</th><th className="pr-2">Segments</th><th className="pr-2">Labels</th><th className="pr-2">Created</th><th></th>
              </tr>
            </thead>
            <tbody>
              {recordings.length === 0 && <tr><td colSpan={9} className="py-3 text-slate-500">No recordings yet.</td></tr>}
              {recordings.map(r => (
                <tr key={r.id} className={`border-b border-slate-100 ${replay?.id === r.id ? 'bg-amber-50' : ''}`}>
                  <td className="py-1.5 pr-2 text-slate-500">{r.id}</td>
                  <td className="pr-2 text-slate-900">{r.name}{r.recording && <span className="text-red-600 ml-1.5">● recording</span>}</td>
                  <td className="pr-2">{r.source}</td>
                  <td className="pr-2 tabular-nums">{fmtT(r.duration_s)}</td>
                  <td className="pr-2 tabular-nums">{r.ai_frame_count}</td>
                  <td className="pr-2 tabular-nums">{r.segment_count}</td>
                  <td className="pr-2">{r.has_truth ? 'yes' : '—'}</td>
                  <td className="pr-2 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="py-1 flex gap-1 justify-end">
                    {(r.schema_version ?? 1) < 2
                      ? <span className="text-[10px] text-slate-500" title="Recorded before the 25-channel format; kept for export, not replayable with the current models">old format</span>
                      : <Btn onClick={() => load(r.id)} disabled={busy || r.ai_frame_count < 2} title="Replay through the twin and AI"><Play className="w-3 h-3" /> Replay</Btn>}
                    <Btn onClick={() => exportCsv(r)} title="Download as CSV (re-importable)"><Download className="w-3 h-3" /></Btn>
                    <Btn danger onClick={() => remove(r)} disabled={busy || r.recording || replay?.id === r.id} title="Delete recording"><Trash2 className="w-3 h-3" /></Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 mt-2.5 leading-snug">
          CSV import: a time column (<code>t_s</code>, seconds) and all 25 channel columns —{' '}
          <code>rpm, throttle, egt1–egt4, cht1–cht4, map_bar, oil_pressure, oil_temp, vibration, fuel_flow, lambda, gen_voltage, gen_current, coolant_temp, inj_pw_ms, fuel_trim_pct, battery_current_a, battery_soc_pct, ambient_pressure_bar, oat_c</code>{' '}
          (units: rpm, %, °C, bar, g-RMS, L/h, V, A, ms).Optional: <code>episode</code> (independent stretches), <code>label</code> + <code>severity</code> (ground truth for scoring).
          A file with any invalid row is rejected so the AI never scores a stream with holes. Bundled data is simulator data; real engine data uses the same path,
          but the models have only been validated on simulator data.
        </p>
      </Panel>
    </div>
  );
}

export default DataSourceTab;
