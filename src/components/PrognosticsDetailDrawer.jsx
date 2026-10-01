import React from 'react';
import { 
  X, 
  Cpu, 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  Layers, 
  Sliders, 
  CheckCircle2, 
  Clock, 
  Database,
  ExternalLink,
  Brain
} from 'lucide-react';

export const PrognosticsDetailDrawer = ({ isOpen, onClose, modelMetadata }) => {
  if (!isOpen) return null;
  const m = modelMetadata || {};
  const pct = (v) => (v != null ? `${(v * 100).toFixed(1)}%` : '—');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-all duration-300">
      <div className="w-full max-w-xl h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col font-mono text-xs overflow-hidden animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5 text-sky-600">
            <Brain className="w-4 h-4 text-sky-600" />
            <h2 className="font-display font-bold text-sm tracking-wider text-slate-900 uppercase">
              PROGNOSTICS MODEL CARD
            </h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shadow-xs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar text-slate-700">
          
          {/* Notice Banner */}
          <div className="p-3.5 rounded-lg border border-sky-200 bg-sky-50/80 text-slate-800 flex items-start gap-3 shadow-xs">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-sky-600" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-bold text-sky-700">HOW THE NUMBERS ARE MADE: </span>
              Diagnosis, health index and RUL are computed every second by the trained models from golden-twin physics residuals.
              The values below are read from the AI service's model card (held-out simulator test episodes), not typed into the UI.
              {!m.live && <span className="font-bold text-amber-700"> AI service offline: model card not available.</span>}
            </div>
          </div>

          {/* Model Architecture & Provenance */}
          <div>
            <h3 className="text-slate-900 font-display font-bold tracking-wider uppercase mb-3 flex items-center gap-2 border-b border-slate-100 pb-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-600" /> 1. MODELS & DATA
            </h3>
            <div className="grid grid-cols-2 gap-2.5 p-3.5 rounded-lg border border-slate-200 bg-slate-50 shadow-xs">
              <div className="col-span-2">
                <span className="text-slate-500 block text-[10px] font-semibold">MODELS (v{m.version ?? '—'}):</span>
                <span className="font-bold text-slate-900">{m.name ?? '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 block text-[10px] font-semibold">TRAINING DATA:</span>
                <span className="font-bold text-slate-900">{m.dataset ?? '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 block text-[10px] font-semibold">FEATURES:</span>
                <span className="font-bold text-slate-900">{m.featuresCount ?? '—'} · {m.featureEngineering ?? '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">ENGINE:</span>
                <span className="font-bold text-slate-900">Rotax 915 iS (turbocharged flat-four)</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] font-semibold">TBO USED FOR RUL (ASSUMPTION):</span>
                <span className="font-bold text-slate-900 tabular-nums">{m.tboHours ?? '—'} h</span>
              </div>
            </div>
          </div>

          {/* Validation Metrics */}
          <div>
            <h3 className="text-slate-900 font-display font-bold tracking-wider uppercase mb-3 flex items-center gap-2 border-b border-slate-100 pb-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> 2. HELD-OUT TEST RESULTS (SIMULATOR)
            </h3>
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Detection precision / recall</div>
                <div className="text-lg font-display font-bold text-emerald-600 tabular-nums">{pct(m.detectionPrecision)} / {pct(m.detectionRecall)}</div>
                <div className="text-[9px] text-slate-500">End-to-end, as served</div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] text-slate-500 font-bold uppercase">RUL MAE</div>
                <div className="text-lg font-display font-bold text-emerald-600 tabular-nums">{m.rulMaeHours != null ? `${m.rulMaeHours} h` : '—'}</div>
                <div className="text-[9px] text-slate-500">Hours to functional failure</div>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-white text-center shadow-xs">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Inference latency</div>
                <div className="text-lg font-display font-bold text-slate-900 tabular-nums">{m.latencyMs != null ? `${Math.round(m.latencyMs)} ms` : '—'}</div>
                <div className="text-[9px] text-slate-500">Last request, measured</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 mt-1.5">Full metrics (per class, by altitude and temperature, stress test): ai_health_rul/models/model_card.json and the README.</div>
          </div>

          {/* Centralized Advisory State Machine */}
          <div>
            <h3 className="text-slate-900 font-display font-bold tracking-wider uppercase mb-3 flex items-center gap-2 border-b border-slate-100 pb-1.5">
              <Sliders className="w-3.5 h-3.5 text-sky-600" /> 3. CENTRALISED ADVISORY DECISION MATRIX
            </h3>
            <div className="space-y-1.5 p-3.5 rounded-lg border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-emerald-700 font-bold">LEVEL A: CONTINUE MONITORING</span>
                <span className="text-[10px] text-slate-500 font-medium">EDI &lt; 10 | RUL &gt; Mission × 4</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-sky-700 font-bold">LEVEL B: INSPECTION ADVISED</span>
                <span className="text-[10px] text-slate-500 font-medium">EDI 10–28 | Incipient drift</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-amber-700 font-bold">LEVEL C: MAINTENANCE REQUIRED</span>
                <span className="text-[10px] text-slate-500 font-medium">EDI 28–48 | RUL &lt; Mission × 2</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                <span className="text-amber-600 font-bold">LEVEL D: MISSION RESTRICTION</span>
                <span className="text-[10px] text-slate-500 font-medium">EDI 48–68 | Negative mission margin</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-red-700 font-bold">LEVEL E: ENGINEERING REVIEW</span>
                <span className="text-[10px] text-slate-500 font-medium">EDI &gt; 68 or Critical fault active</span>
              </div>
            </div>
          </div>

          {/* Statutory Engineering Disclaimer */}
          <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200 text-[11px] leading-relaxed text-slate-700 shadow-xs">
            <div className="font-bold text-amber-900 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              PROTOTYPE DISCLAIMER
            </div>
            {m.disclaimer} The models were trained on simulator data and have not been validated on a real engine. All maintenance and return-to-service decisions must follow the Rotax 915 iS maintenance manual and the applicable airworthiness authority.
          </div>

        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-slate-100 text-xs font-mono font-bold transition-all shadow-xs"
          >
            CLOSE
          </button>
        </div>

      </div>
    </div>
  );
};

