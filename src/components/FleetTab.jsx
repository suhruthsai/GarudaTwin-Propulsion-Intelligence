import React, { useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { Users, Plane, Activity, Wrench, ShieldCheck, Cpu, Zap, RotateCcw } from 'lucide-react';

// Faults that can be injected into a fleet vehicle's simulator (same set as Vahak-1)
const FAULTS = [
  'CYL3_INJECTOR', 'MISFIRE', 'COMBUSTION_INSTABILITY', 'INJECTOR_COKING', 'BLOW_BY', 'OIL_PUMP_CAVITATION',
  'TURBO_WASTEGATE_STUCK', 'COOLING_DEGRADATION', 'GENERATOR_FAILURE', 'PRGB_DEGRADATION', 'SENSOR_DRIFT', 'SENSOR_FAILURE',
];
const SUBSYSTEM_LABEL = {
  combustion: 'Combustion / cylinders', lubrication: 'Lubrication', induction: 'Induction / turbo', cooling: 'Cooling',
  gearbox: 'Reduction gearbox', electrical: 'Electrical', sensors: 'Sensors',
};

const statusClass = (s) =>
  s === 'CRITICAL' ? 'bg-red-50 text-red-700 border-red-200'
    : s === 'CAUTION' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : s === 'ON STATION' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-100 text-slate-600 border-slate-300';
const healthClass = (h) => (h == null ? 'text-slate-400' : h < 50 ? 'text-red-600' : h < 80 ? 'text-amber-600' : 'text-emerald-600');

export const FleetTab = () => {
  const { telemetry, injectFault, clearFault } = useTelemetry();
  const [selectedUav, setSelectedUav] = useState('Vahak-1');
  const [fault, setFault] = useState('MISFIRE');
  const [severity, setSeverity] = useState(0.6);

  const fleet = telemetry?.fleetState || [];
  const current = fleet.find(u => u.id === selectedUav) || fleet[0];
  const airborne = fleet.filter(u => u.airborne);
  const withAi = airborne.filter(u => u.ai?.health != null);
  const meanHealth = withAi.length ? withAi.reduce((a, u) => a + u.ai.health, 0) / withAi.length : null;
  const attention = fleet.filter(u => u.status === 'CAUTION' || u.status === 'CRITICAL');
  const canInject = current?.airborne && (current.id !== 'Vahak-1' || (telemetry.source?.mode ?? 'SIM') === 'SIM');

  if (!fleet.length) {
    return <div className="h-full flex items-center justify-center font-mono text-xs text-slate-400">[WAITING FOR FLEET DATA FROM THE GATEWAY...]</div>;
  }

  return (
    <div className="flex flex-col gap-3 w-full h-full overflow-y-auto pr-1 custom-scrollbar pb-8 select-none text-slate-900">
      {/* 1. Summary cards (computed from the live fleet) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {[
          { icon: Plane, tone: 'bg-sky-50 border-sky-200 text-sky-600', label: 'VEHICLES', value: `${fleet.length} MALE UAVs` },
          { icon: ShieldCheck, tone: 'bg-emerald-50 border-emerald-200 text-emerald-600', label: 'AIRBORNE (LIVE ENGINE DATA)', value: `${airborne.length} / ${fleet.length}` },
          { icon: Activity, tone: 'bg-slate-50 border-slate-200 text-slate-600', label: 'MEAN AI HEALTH (AIRBORNE)', value: meanHealth == null ? '—' : `${meanHealth.toFixed(1)}%` },
          { icon: Wrench, tone: 'bg-amber-50 border-amber-200 text-amber-600', label: 'NEED ATTENTION (AI)', value: attention.length ? attention.map(u => u.id).join(', ') : 'none' },
        ].map(({ icon: Icon, tone, label, value }) => (
          <div key={label} className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 shadow-xs">
            <div className={`p-2.5 rounded-md border shadow-2xs ${tone}`}><Icon className="w-5 h-5" /></div>
            <div>
              <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">{label}</div>
              <div className="font-mono font-bold text-lg text-slate-900 tabular-nums">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 2. Fleet table */}
      <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col gap-3 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-600" />
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase">Fleet engine health</h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500">
            Each airborne vehicle: own engine simulator, golden twin and AI session, scored once per second
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase text-[10px] font-bold">
                <th className="py-2 px-3">Vehicle</th>
                <th className="py-2 px-3">Engine</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">AI diagnosis</th>
                <th className="py-2 px-3">AI health</th>
                <th className="py-2 px-3">RUL (95% interval)</th>
                <th className="py-2 px-3">L1 threshold</th>
                <th className="py-2 px-3">Engine hours</th>
                <th className="py-2 px-3">Advisory</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fleet.map(u => {
                const sel = selectedUav === u.id;
                return (
                  <tr key={u.id} onClick={() => setSelectedUav(u.id)}
                    className={`cursor-pointer transition-colors ${sel ? 'bg-sky-50/60' : 'hover:bg-slate-50/80'}`}>
                    <td className="py-2 px-3 font-semibold">
                      <span className={sel ? 'text-sky-800 font-bold' : 'text-slate-800'}>{u.callsign}</span>
                      {u.id === 'Vahak-1' && u.dataSource && u.dataSource !== 'SIM' && <span className="ml-1.5 text-[9px] text-amber-700">[{u.dataSource}]</span>}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{u.engine}</td>
                    <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusClass(u.status)}`}>{u.status}</span></td>
                    <td className="py-2 px-3">{u.ai ? u.ai.diagnosis.replace(/_/g, ' ') : '—'}</td>
                    <td className={`py-2 px-3 font-bold tabular-nums ${healthClass(u.ai?.health)}`}>{u.ai?.health == null ? '—' : `${u.ai.health.toFixed(1)}%`}</td>
                    <td className="py-2 px-3 tabular-nums">
                      {u.ai?.rulHours == null ? '—' : `${u.ai.rulHours.toFixed(1)} h`}
                      {u.ai?.rulLower95 != null && <span className="text-slate-400"> ({u.ai.rulLower95.toFixed(0)}–{u.ai.rulUpper95.toFixed(0)})</span>}
                    </td>
                    <td className="py-2 px-3">{u.l1 ? `${u.l1.status}` : '—'}</td>
                    <td className="py-2 px-3 tabular-nums text-slate-600">{u.flightHours} h</td>
                    <td className="py-2 px-3 text-slate-700">{u.ai?.action ?? (u.airborne ? '—' : 'ON GROUND')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] font-mono text-slate-500">
          RUL with no diagnosed fault = scheduled TBO (2,000 h) minus engine hours. Station position/altitude of Vahak-2..5 are assigned
          orbit parameters (only Vahak-1 has a 6-DOF flight model). All engine data is simulator data.
        </p>
      </div>

      {/* 3. Selected vehicle: subsystems + scenario control */}
      {current && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="xl:col-span-2 gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col gap-3 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-600" />
                <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase">Subsystems // {current.callsign}</h3>
              </div>
              <span className="text-[10px] font-mono text-slate-500">from the AI diagnosis (fixed fault → subsystem mapping)</span>
            </div>
            {!current.airborne ? (
              <p className="text-xs font-mono text-slate-600">{current.note}</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {Object.entries(current.subsystems || {}).map(([k, v]) => (
                  <div key={k} className={`p-2.5 rounded-lg border ${v.status === 'FAULT' ? 'border-red-300 bg-red-50' : v.status === 'INSPECT' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-[10px] font-mono text-slate-500 uppercase font-bold">{SUBSYSTEM_LABEL[k] ?? k}</div>
                    <div className={`font-mono text-sm font-bold ${v.status === 'FAULT' ? 'text-red-700' : v.status === 'INSPECT' ? 'text-amber-700' : v.status === 'OK' ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {v.status === 'OK' ? 'No fault' : v.status === 'UNKNOWN' ? 'No AI data' : v.status === 'INSPECT' ? 'Inspect' : `${v.health?.toFixed?.(0) ?? '—'}%`}
                    </div>
                    {v.diagnosis && <div className="text-[9px] font-mono text-slate-600 mt-0.5">{v.diagnosis.replace(/_/g, ' ')}</div>}
                  </div>
                ))}
              </div>
            )}
            {current.ai?.topCause && <p className="text-[11px] font-mono text-slate-600">Top explanation (TreeSHAP): {current.ai.topCause}</p>}
            {current.ai?.suspectSensor && <p className="text-[11px] font-mono text-amber-700">Suspect sensor: {current.ai.suspectSensor}</p>}
          </div>

          <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col gap-2.5 shadow-xs">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
              <Zap className="w-4 h-4 text-amber-600" />
              <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase">Test scenario // {current.id}</h3>
            </div>
            <div className="text-[11px] font-mono text-slate-600">
              Injected scenario (ground truth): <span className="font-bold text-slate-900">{current.injectedFault ?? '—'}</span>
              {current.injectedFault && current.injectedFault !== 'NONE' && ` @ ${current.injectedSeverity}`}
            </div>
            {canInject ? (
              <>
                <select value={fault} onChange={e => setFault(e.target.value)} className="text-xs font-mono border border-slate-300 rounded px-2 py-1.5 bg-white">
                  {FAULTS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <label className="text-[11px] font-mono text-slate-600 flex items-center gap-2">
                  Severity {severity.toFixed(2)}
                  <input type="range" min={0.05} max={1} step={0.05} value={severity} onChange={e => setSeverity(Number(e.target.value))} className="flex-1 accent-sky-600" />
                </label>
                <div className="flex gap-2">
                  <button onClick={() => injectFault(fault, severity, current.id)} className="flex-1 px-2.5 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-xs font-mono font-bold hover:bg-amber-100">Inject</button>
                  <button onClick={() => clearFault(current.id)} className="flex-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-slate-800 text-xs font-mono font-bold hover:bg-slate-50 flex items-center justify-center gap-1"><RotateCcw className="w-3 h-3" /> Clear</button>
                </div>
                <p className="text-[10px] font-mono text-slate-500">The AI is not told what was injected; it has to find it from this vehicle's sensors.</p>
              </>
            ) : (
              <p className="text-[11px] font-mono text-slate-500">
                {!current.airborne ? 'Vehicle on the ground: nothing to inject.' : 'Vahak-1 is not on the simulator data source; switch to SIM in Data Source & Replay.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
