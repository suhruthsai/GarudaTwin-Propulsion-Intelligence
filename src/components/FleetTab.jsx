import React, { useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { 
  Users, 
  Plane, 
  Activity, 
  Clock, 
  Wrench, 
  ShieldCheck, 
  AlertTriangle, 
  Calendar,
  CheckCircle2,
  Cpu
} from 'lucide-react';

export const FleetTab = () => {
  const { telemetry, aiPrognostics } = useTelemetry();
  const [selectedUav, setSelectedUav] = useState('Vahak-1');

  // Swarm Fleet Data Matrix (Vahak-1 to Vahak-5)
  const activeUav = {
    id: 'Vahak-1',
    callsign: 'Vahak-1 (ACTIVE TESTBED)',
    engine: 'Rotax 915 iS (S/N: RTX-0842)',
    status: telemetry.health.status === 'CRITICAL' ? 'EMERGENCY RTB' : telemetry.health.status === 'DEGRADED' ? 'DERATED LOITER' : 'ON STATION',
    health: aiPrognostics.engine_health_index || 100.0,
    rulHours: aiPrognostics.rul_hours_mean || 2000.0,
    flightHours: 342.5,
    tboDueHours: 857.5,
    nextMaintenanceDays: (aiPrognostics.engine_health_index || 100.0) < 40 ? 0 : 28,
    subsystems: {
      combustion: (aiPrognostics.dominant_root_cause_feature || '').includes('EGT') ? 35 : 99,
      lubrication: (aiPrognostics.dominant_root_cause_feature || '').includes('Oil') ? 28 : 98,
      induction: (aiPrognostics.dominant_root_cause_feature || '').includes('MAP') ? 52 : 99,
      cooling: (aiPrognostics.dominant_root_cause_feature || '').includes('CHT') ? 42 : 98,
      vibration: (aiPrognostics.dominant_root_cause_feature || '').includes('Vibration') ? 30 : 97
    }
  };

  const DEFAULT_FLEET = [
    {
      id: 'Vahak-2',
      callsign: 'Vahak-2 (ESCORT LEAD)',
      engine: 'Rotax 915 iS (S/N: RTX-0819)',
      status: 'ON STATION',
      health: 96.2,
      rulHours: 785.0,
      flightHours: 415.0,
      tboDueHours: 785.0,
      subsystems: { combustion: 98, lubrication: 95, induction: 97, cooling: 96, vibration: 95 }
    },
    {
      id: 'Vahak-3',
      callsign: 'Vahak-3 (RELAY ORBIT)',
      engine: 'Rotax 916 iS (S/N: RTX-0902)',
      status: 'CLIMB TO CRUISE',
      health: 99.1,
      rulHours: 1120.0,
      flightHours: 80.0,
      tboDueHours: 1120.0,
      subsystems: { combustion: 100, lubrication: 99, induction: 98, cooling: 99, vibration: 100 }
    },
    {
      id: 'Vahak-4',
      callsign: 'Vahak-4 (PERIMETER PATROL)',
      engine: 'Rotax 915 iS (S/N: RTX-0754)',
      status: 'DERATED CRUISE',
      health: 84.5,
      rulHours: 420.0,
      flightHours: 780.0,
      tboDueHours: 420.0,
      subsystems: { combustion: 88, lubrication: 82, induction: 85, cooling: 86, vibration: 80 }
    },
    {
      id: 'Vahak-5',
      callsign: 'Vahak-5 (HANGAR RESERVE)',
      engine: 'Rotax 915 iS (S/N: RTX-0699)',
      status: 'MAINTENANCE HOLD',
      health: 38.0,
      rulHours: 120.0,
      flightHours: 1080.0,
      tboDueHours: 120.0,
      subsystems: { combustion: 42, lubrication: 35, induction: 50, cooling: 45, vibration: 30 }
    }
  ];

  const rawFleet = (telemetry?.fleetState && telemetry.fleetState.length > 0)
    ? telemetry.fleetState
    : DEFAULT_FLEET;

  const simulatedFleet = rawFleet.map(uav => ({
    ...uav,
    nextMaintenanceDays: uav.health < 40 ? 0 : Math.round(uav.rulHours / 24)
  }));

  const fleetData = [activeUav, ...simulatedFleet];

  const currentUav = fleetData.find(u => u.id === selectedUav) || fleetData[0];

  return (
    <div className="flex flex-col gap-3 w-full h-full overflow-y-auto pr-1 custom-scrollbar pb-8 select-none text-slate-900">
      {/* 1. Tactical Fleet Overview Header Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 shadow-xs">
          <div className="p-2.5 bg-sky-50 rounded-md border border-sky-200 text-sky-600 shadow-2xs">
            <Plane className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">TOTAL SQUADRON ASSETS</div>
            <div className="font-mono font-bold text-xl text-slate-900 tabular-nums">5 MALE UAVs</div>
          </div>
        </div>

        <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 shadow-xs">
          <div className="p-2.5 bg-emerald-50 rounded-md border border-emerald-200 text-emerald-600 shadow-2xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">AIRBORNE / MISSION READY</div>
            <div className="font-mono font-bold text-xl text-emerald-600 tabular-nums">4 / 5 ACTIVE</div>
          </div>
        </div>

        <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 shadow-xs">
          <div className="p-2.5 bg-slate-100 rounded-md border border-slate-200 text-slate-700 shadow-2xs">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">FLEET MEAN HEALTH</div>
            <div className="font-mono font-bold text-xl text-slate-900 tabular-nums">
              {(fleetData.reduce((acc, curr) => acc + curr.health, 0) / 5).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 shadow-xs">
          <div className="p-2.5 bg-amber-50 rounded-md border border-amber-200 text-amber-600 shadow-2xs">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">SCHEDULED WORK ORDERS</div>
            <div className="font-mono font-bold text-xl text-amber-600 tabular-nums">2 PENDING</div>
          </div>
        </div>
      </div>

      {/* 2. Swarm UAV Matrix Table */}
      <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col gap-3 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-600" />
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase">
              SQUADRON OPERATIONAL READINESS MATRIX
            </h3>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-semibold">
            CAN & SATCOM SYNC (100 HZ)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase text-[10px] font-bold">
                <th className="py-2.5 px-3">UAV ID / Callsign</th>
                <th className="py-2.5 px-3">Engine S/N</th>
                <th className="py-2.5 px-3">Mission Status</th>
                <th className="py-2.5 px-3">Health Index</th>
                <th className="py-2.5 px-3">Predicted RUL</th>
                <th className="py-2.5 px-3">Flight Hours</th>
                <th className="py-2.5 px-3">Next Maint.</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fleetData.map((uav) => {
                const isSelected = selectedUav === uav.id;
                const isCrit = uav.health < 50;
                const isDeg = uav.health >= 50 && uav.health < 80;

                return (
                  <tr
                    key={uav.id}
                    onClick={() => setSelectedUav(uav.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-sky-50/60 border-l-2 border-sky-600'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-semibold text-slate-900 flex items-center gap-2">
                      <Plane className={`w-3.5 h-3.5 ${isSelected ? 'text-sky-600' : 'text-slate-400'}`} />
                      <span className={isSelected ? 'text-sky-800 font-bold' : 'text-slate-800 font-medium'}>{uav.callsign}</span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 tabular-nums">{uav.engine}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        uav.status.includes('EMERGENCY') || uav.status.includes('GROUND') || uav.status.includes('HOLD')
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : uav.status.includes('DERATED')
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {uav.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`font-bold tabular-nums ${isCrit ? 'text-red-600' : isDeg ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {uav.health.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-900 font-bold tabular-nums">{uav.rulHours.toFixed(1)} hrs</td>
                    <td className="py-2.5 px-3 text-slate-600 tabular-nums">{uav.flightHours} hrs</td>
                    <td className="py-2.5 px-3 text-slate-700 tabular-nums font-medium">
                      {uav.nextMaintenanceDays === 0 ? (
                        <span className="text-red-700 font-bold">IMMEDIATE</span>
                      ) : (
                        `In ${uav.nextMaintenanceDays} days`
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button className={`px-2.5 py-1 rounded-md text-[10px] font-mono font-bold transition-colors shadow-xs ${
                        isSelected 
                          ? 'bg-sky-600 text-white' 
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                      }`}>
                        {isSelected ? 'ACTIVE' : 'SELECT'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Bottom Subsystem Heatmap for Selected Asset */}
      <div className="gcs-panel rounded-lg border border-slate-200 bg-white p-3.5 flex flex-col gap-3 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-sky-600" />
            <h3 className="font-mono text-xs font-bold tracking-wider text-slate-900 uppercase">
              SUBSYSTEM INTEGRITY MATRIX // {currentUav.callsign}
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500 font-medium">ENGINE TBO REMAINING: <span className="text-slate-900 font-bold tabular-nums">{currentUav.tboDueHours} HRS</span></span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {Object.entries(currentUav?.subsystems || {}).map(([subsystem, score]) => (
            <div key={subsystem} className="gcs-card p-3 rounded-lg border border-slate-200 bg-white flex flex-col gap-1.5 shadow-2xs">
              <div className="text-[10px] font-mono text-slate-500 uppercase font-bold tracking-wider">{subsystem}</div>
              <div className={`font-mono text-xl font-bold tabular-nums ${
                score < 50 ? 'text-red-600' : score < 80 ? 'text-amber-600' : 'text-emerald-600'
              }`}>
                {score}%
              </div>
              <div className="w-full bg-slate-100 h-1.5 rounded overflow-hidden border border-slate-200">
                <div
                  className={`h-full transition-all duration-300 rounded ${
                    score < 50 ? 'bg-red-500' : score < 80 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${score}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
