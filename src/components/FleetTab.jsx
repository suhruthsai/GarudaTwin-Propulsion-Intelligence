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
    <div className="flex flex-col gap-4 w-full h-full overflow-y-auto pr-1 custom-scrollbar pb-10">
      {/* 1. Starship Fleet Overview Header Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="starship-glass-card p-4 rounded-xl border border-white/[0.08] flex items-center gap-3.5 shadow-starship-glass">
          <div className="p-3 bg-cyan-500/10 rounded-xl border border-cyan-400/40 text-cyan-300 shadow-sm">
            <Plane className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">TOTAL SWARM ASSETS</div>
            <div className="font-display font-black text-2xl text-white glow-cyan">5 MALE UAVs</div>
          </div>
        </div>

        <div className="starship-glass-card p-4 rounded-xl border border-white/[0.08] flex items-center gap-3.5 shadow-starship-glass">
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/40 text-emerald-400 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">AIRBORNE / MISSION READY</div>
            <div className="font-display font-black text-2xl text-emerald-400 glow-green">4 / 5 ACTIVE</div>
          </div>
        </div>

        <div className="starship-glass-card p-4 rounded-xl border border-white/[0.08] flex items-center gap-3.5 shadow-starship-glass">
          <div className="p-3 bg-purple-500/10 rounded-xl border border-purple-500/40 text-purple-300 shadow-sm">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">FLEET MEAN HEALTH</div>
            <div className="font-display font-black text-2xl text-purple-300 glow-purple">
              {(fleetData.reduce((acc, curr) => acc + curr.health, 0) / 5).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="starship-glass-card p-4 rounded-xl border border-white/[0.08] flex items-center gap-3.5 shadow-starship-glass">
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/40 text-amber-400 shadow-sm">
            <Wrench className="w-6 h-6" />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">SCHEDULED WORK ORDERS</div>
            <div className="font-display font-black text-2xl text-amber-400 glow-amber">2 PENDING</div>
          </div>
        </div>
      </div>

      {/* 2. Starship Swarm UAV Matrix Table */}
      <div className="starship-glass rounded-xl border border-white/[0.08] p-4 flex flex-col gap-3.5 shadow-starship-glass">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-4 h-4 text-cyan-400" />
            <h3 className="font-display font-black text-xs tracking-wider text-cyan-300 glow-cyan">
              SWARM FLEET OPERATIONAL READINESS MATRIX
            </h3>
          </div>
          <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
            CAN & SATCOM SYNC (100 HZ)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400 uppercase text-[10px]">
                <th className="py-2.5 px-3">UAV ID / Callsign</th>
                <th className="py-2.5 px-3">Engine S/N</th>
                <th className="py-2.5 px-3">Mission Status</th>
                <th className="py-2.5 px-3">Health Index</th>
                <th className="py-2.5 px-3">Predicted RUL</th>
                <th className="py-2.5 px-3">Flight Hours</th>
                <th className="py-2.5 px-3">Next Maint.</th>
                <th className="py-2.5 px-3 text-right">Select</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {fleetData.map((uav) => {
                const isSelected = selectedUav === uav.id;
                const isCrit = uav.health < 50;
                const isDeg = uav.health >= 50 && uav.health < 80;

                return (
                  <tr
                    key={uav.id}
                    onClick={() => setSelectedUav(uav.id)}
                    className={`cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-cyan-500/15 border-l-4 border-cyan-400 shadow-sm'
                        : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <td className="py-3 px-3 font-bold text-white flex items-center gap-2">
                      <Plane className={`w-3.5 h-3.5 ${isSelected ? 'text-cyan-300 animate-pulse' : 'text-slate-400'}`} />
                      <span className={isSelected ? 'text-cyan-200' : 'text-slate-200'}>{uav.callsign}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-400">{uav.engine}</td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        uav.status.includes('EMERGENCY') || uav.status.includes('GROUND')
                          ? 'bg-red-500/20 text-red-300 border border-red-500/50 glow-red'
                          : uav.status.includes('DERATED')
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 glow-amber'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 glow-green'
                      }`}>
                        {uav.status}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`font-bold ${isCrit ? 'text-red-400' : isDeg ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {uav.health.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-cyan-300 font-bold">{uav.rulHours.toFixed(1)} hrs</td>
                    <td className="py-3 px-3 text-slate-300">{uav.flightHours} hrs</td>
                    <td className="py-3 px-3 text-slate-300">
                      {uav.nextMaintenanceDays === 0 ? (
                        <span className="text-red-400 font-bold animate-pulse">IMMEDIATE</span>
                      ) : (
                        `In ${uav.nextMaintenanceDays} days`
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-all ${
                        isSelected 
                          ? 'bg-cyan-400 text-black shadow-hud-cyan' 
                          : 'bg-slate-800 text-slate-300 hover:bg-cyan-500/30 hover:text-cyan-200'
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
      <div className="starship-glass rounded-xl border border-white/[0.08] p-4 flex flex-col gap-3.5 shadow-starship-glass">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-cyan-400" />
            <h3 className="font-display font-black text-xs tracking-wider text-cyan-300 glow-cyan">
              DETAILED SUBSYSTEM HEALTH HEATMAP FOR {currentUav.callsign}
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">ENGINE TBO REMAINING: <span className="text-white font-bold">{currentUav.tboDueHours} HRS</span></span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {Object.entries(currentUav?.subsystems || {}).map(([subsystem, score]) => (
            <div key={subsystem} className="starship-glass-card p-3.5 rounded-xl border border-white/[0.08] flex flex-col gap-2">
              <div className="text-[10px] font-mono text-slate-400 uppercase font-bold tracking-wider">{subsystem}</div>
              <div className={`font-mono text-2xl font-bold ${
                score < 50 ? 'text-red-400 glow-red' : score < 80 ? 'text-amber-400 glow-amber' : 'text-emerald-400 glow-green'
              }`}>
                {score}%
              </div>
              <div className="w-full bg-slate-900/90 h-2 rounded-full overflow-hidden border border-white/[0.06]">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    score < 50 ? 'bg-gradient-to-r from-red-600 to-rose-500' : score < 80 ? 'bg-gradient-to-r from-amber-600 to-yellow-500' : 'bg-gradient-to-r from-emerald-600 to-teal-400'
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
