import React from 'react';
import { X, Keyboard, Command, Monitor, Sliders, ShieldCheck } from 'lucide-react';

export const KeyboardShortcutsModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const hotkeyGroups = [
    {
      group: 'PRIMARY VIEWPORT SELECTION',
      icon: Monitor,
      items: [
        { key: '1', label: '3D CAD Blueprint & Digital Twin', desc: 'Rotax 915 iS airframe & engine assembly' },
        { key: '2', label: 'Live Telemetry Annunciator', desc: '25 engine, electrical, injection and air-data channels' },
        { key: '3', label: 'AI Prognostics & XAI Engine', desc: 'XGBoost diagnosis, health and RUL with TreeSHAP explanations' },
        { key: '4', label: 'RTB Contingency Planner', desc: 'Rule-based divert decision, airfield distances, glide reach' },
        { key: '5', label: 'Fleet Health', desc: 'Per-vehicle engine simulator + AI health, RUL and diagnosis' },
        { key: '6', label: 'What-If Test Bench', desc: 'Manual engine inputs and simulator-generated profiles → one-shot AI assessment' },
        { key: '7', label: 'Mission Debrief (demo scenario)', desc: 'Hand-authored 8-phase sortie, scripted assistant, demo PDF' },
        { key: '8', label: '6-DOF Flight Control System', desc: 'TECS, PFD, L1 guidance & control surfaces' },
        { key: '9', label: 'Data Source & Replay', desc: 'Simulator / live ingest / CAN, flight recordings, CSV import & replay' },
      ]
    },
    {
      group: 'GCS MULTI-VIEWPORT & OPERATIONAL CONTROLS',
      icon: Command,
      items: [
        { key: 'D', label: 'Toggle Split-Screen Dual Dock', desc: 'Side-by-side comparative monitoring' },
        { key: 'K / ?', label: 'Operator Keybindings Matrix', desc: 'Display this shortcut list' },
        { key: 'ESC', label: 'Dismiss Active Overlay / Modal', desc: 'Close open inspection dialogues' },
      ]
    },
    {
      group: 'STANDARDS (DESIGN REFERENCES ONLY, NOT ASSESSED OR CERTIFIED)',
      icon: ShieldCheck,
      items: [
        { key: 'MIL-STD-1472H', label: 'Human engineering', desc: 'Reference for high-contrast symbology; no compliance assessment done' },
        { key: 'DO-178C', label: 'Airborne software', desc: 'Target process for a production version; no objectives executed' },
        { key: 'STANAG 4586', label: 'UAV interoperability', desc: 'Not implemented; reference only' },
      ]
    }
  ];

  return (
    <div 
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div 
        className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl flex flex-col shadow-2xl overflow-hidden font-mono text-slate-800"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-sky-50 border border-sky-200 text-sky-700">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold tracking-wider text-slate-900 uppercase">
                  OPERATOR KEYBOARD SHORTCUTS MATRIX
                </h2>
              </div>
              <p className="text-[11px] text-slate-500">
                GarudaTwin MALE UAV ground control station
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[75vh] flex flex-col gap-5">
          {hotkeyGroups.map((grp, gIdx) => {
            const GroupIcon = grp.icon;
            return (
              <div key={gIdx} className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700 tracking-wider uppercase border-b border-slate-100 pb-1.5">
                  <GroupIcon className="w-3.5 h-3.5 text-sky-600" />
                  <span>{grp.group}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {grp.items.map((item, iIdx) => (
                    <div 
                      key={iIdx}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800">{item.label}</span>
                        <span className="text-[10px] text-slate-500">{item.desc}</span>
                      </div>
                      <kbd className="shrink-0 px-2 py-1 rounded bg-white border border-slate-300 text-sky-700 font-bold font-mono text-[11px] shadow-xs">
                        {item.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-2.5 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>FCS & CAN TELEMETRY BUS 100 Hz ACTIVE</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
          >
            CLOSE [ESC]
          </button>
        </div>
      </div>
    </div>
  );
};
