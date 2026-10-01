import React, { useState } from 'react';
import { useTelemetry } from '../context/TelemetryContext';
import { X, Cpu, Activity, Brain, ShieldAlert, CheckCircle2, BarChart2, Layers, Search, ListFilter } from 'lucide-react';

export const FeaturesInspectorModal = ({ isOpen, onClose }) => {
  const { telemetry, aiPrognostics } = useTelemetry();
  const [activeTab, setActiveTab] = useState('RAW_SENSORS');
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen || !telemetry) return null;

  const eng = telemetry.engine || {};
  const res = telemetry.residuals || {};

  // Raw sensor channels sent to the AI service (no health score or fault label is an input)
  const egt = eng.egt || [];
  const cht = eng.cht || [];
  const rawSensors = [
    { key: 'rpm', name: 'Engine RPM', value: eng.rpm, unit: 'RPM' },
    { key: 'throttle', name: 'Throttle Position', value: eng.throttlePct, unit: '%' },
    ...egt.map((v, i) => ({ key: `egt[${i}]`, name: `EGT Cylinder ${i + 1}`, value: v, unit: '°C' })),
    ...cht.map((v, i) => ({ key: `cht[${i}]`, name: `CHT Cylinder ${i + 1}`, value: v, unit: '°C' })),
    { key: 'map_bar', name: 'Manifold Absolute Pressure', value: eng.mapBar, unit: 'bar' },
    { key: 'oil_pressure', name: 'Oil Pressure', value: eng.oilPressBar, unit: 'bar' },
    { key: 'oil_temp', name: 'Oil Temperature', value: eng.oilTempC, unit: '°C' },
    { key: 'vibration', name: 'Engine Vibration', value: eng.vibrationGrms, unit: 'g-RMS' },
    { key: 'fuel_flow', name: 'Fuel Flow', value: eng.fuelFlowLph, unit: 'L/h' },
    { key: 'lambda', name: 'Lambda', value: eng.lambda, unit: '' },
    { key: 'gen_voltage', name: 'Generator Voltage', value: eng.genVoltageV, unit: 'V' },
    { key: 'gen_current', name: 'Generator Current', value: eng.genCurrentA, unit: 'A' },
    { key: 'coolant_temp', name: 'Coolant Temperature', value: eng.coolantTempC, unit: '°C' },
  ];

  // Actual engineered feature vector scored by the model (returned by the AI service)
  const featureCols = Object.entries(aiPrognostics.model_features || {}).map(([name, value]) => ({
    name,
    value: Number(value).toFixed(4),
    type: name.endsWith('_rmean') ? 'Rolling mean (8 samples)' : name.endsWith('_rstd') ? 'Rolling std (8 samples)' : 'Golden-twin residual',
    unit: ''
  }));
  const meta = aiPrognostics.modelMetadata || {};

  const filteredFeatures = featureCols.filter(f => 
    f.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono">
        
        {/* Modal Header */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-50 border border-sky-200 text-sky-600 shadow-2xs">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-display font-bold text-slate-900 tracking-wider uppercase">
                AI HEALTH & RUL FEATURE INSPECTOR
              </h2>
              <p className="text-[11px] font-mono text-slate-500">
                SCIKIT-LEARN & XGBOOST MODEL INPUT VECTOR & FEATURE ATTRIBUTION ENGINE
              </p>
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="p-1.5 rounded-md bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shadow-2xs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Sub-Header Status Stats */}
        <div className="bg-slate-100/60 border-b border-slate-200 px-6 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-2.5 rounded-lg border border-slate-200 bg-white shadow-2xs">
            <span className="text-slate-500 text-[10px] font-bold">ANOMALY SCORE:</span>
            <div className={`font-bold text-sm tabular-nums mt-0.5 ${aiPrognostics.is_anomaly ? 'text-rose-600' : 'text-emerald-600'}`}>
              {(aiPrognostics.anomaly_score * 100).toFixed(1)}% ({aiPrognostics.is_anomaly ? 'ANOMALOUS' : 'NOMINAL'})
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-slate-200 bg-white shadow-2xs">
            <span className="text-slate-500 text-[10px] font-bold">DIAGNOSED FAULT:</span>
            <div className="font-bold text-sm text-slate-900 mt-0.5 truncate">
              {aiPrognostics.diagnosed_fault ? aiPrognostics.diagnosed_fault.replace(/_/g, ' ') : 'NOMINAL BASELINE'}
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-slate-200 bg-white shadow-2xs">
            <span className="text-slate-500 text-[10px] font-bold">RUL FLIGHT HOURS:</span>
            <div className="font-bold text-sm text-amber-600 tabular-nums mt-0.5">
              {aiPrognostics.rul_hours_mean ? aiPrognostics.rul_hours_mean.toFixed(1) : '842.0'} HOURS
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-slate-200 bg-white shadow-2xs">
            <span className="text-slate-500 text-[10px] font-bold">TOTAL FEATURE SPACE:</span>
            <div className="font-bold text-sm text-sky-600 tabular-nums mt-0.5">
              {featureCols.length || meta.num_features || '—'} FEATURES
            </div>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-1.5 flex gap-1.5 overflow-x-auto">
          {[
            { id: 'RAW_SENSORS', label: `RAW SENSOR INPUTS (${rawSensors.length})`, icon: Activity },
            { id: 'ALL_FEATURES', label: `ALL ${featureCols.length} FEATURES`, icon: Layers },
            { id: 'SHAP_ATTRIBUTION', label: 'TREESHAP EXPLAINABILITY', icon: BarChart2 },
            { id: 'MODEL_ARTIFACTS', label: 'TRAINED ML MODELS', icon: Cpu }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-1.5 px-3 text-xs font-mono flex items-center gap-2 rounded-md transition-all ${
                  isActive
                    ? 'bg-white text-sky-700 border border-sky-300 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Modal Main Content Area */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          
          {/* TAB 1: RAW SENSOR INPUTS */}
          {activeTab === 'RAW_SENSORS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono">
              {rawSensors.map(s => (
                <div key={s.key} className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-1 shadow-2xs">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-slate-800">{s.name}</span>
                    <span className="text-[10px] font-mono text-slate-400">[{s.key}]</span>
                  </div>
                  <div className="flex items-baseline justify-between mt-1">
                    <span className="text-lg font-bold text-slate-900 tabular-nums">
                      {typeof s.value === 'number' ? s.value.toFixed(2) : s.value} <span className="text-xs text-slate-500">{s.unit}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 2: ENGINEERED FEATURES (live values scored by the model) */}
          {activeTab === 'ALL_FEATURES' && (
            <div className="flex flex-col gap-4 font-mono">
              {/* Search Bar */}
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-300 px-3.5 py-2 rounded-lg shadow-inner">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter feature by name (e.g., egt, rmean, rstd, oil)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-transparent border-none outline-none text-xs text-slate-800 w-full placeholder:text-slate-400 font-mono"
                />
                <span className="text-xs text-sky-700 whitespace-nowrap font-bold tabular-nums">{filteredFeatures.length} / {featureCols.length} features</span>
              </div>

              {/* Feature Grid Table */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredFeatures.map((f, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex justify-between items-center text-xs shadow-2xs">
                    <div className="flex flex-col">
                      <span className="text-slate-800 font-bold text-[11px]">{f.name}</span>
                      <span className="text-[9px] text-slate-500">{f.type}</span>
                    </div>
                    <span className="font-bold text-slate-900 tabular-nums">{f.value} <span className="text-[10px] text-slate-500">{f.unit}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: TREESHAP EXPLAINABILITY */}
          {activeTab === 'SHAP_ATTRIBUTION' && (
            <div className="flex flex-col gap-4 font-mono">
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 shadow-xs">
                <h4 className="text-xs font-bold text-slate-800 mb-3 uppercase">TREESHAP FEATURE ATTRIBUTION WEIGHTS (%)</h4>
                <div className="flex flex-col gap-3">
                  {Object.entries(aiPrognostics.feature_attributions || {})
                    .sort((a, b) => b[1] - a[1])
                    .map(([featName, pct], idx) => (
                      <div key={idx} className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-xs text-slate-700">
                          <span className="font-bold">{featName.replace(/_/g, ' ')}</span>
                          <span className="font-bold text-slate-900 tabular-nums">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden border border-slate-300">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              pct > 20 ? 'bg-rose-500' : pct > 10 ? 'bg-amber-500' : 'bg-sky-500'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: TRAINED ML MODELS & VERIFICATION */}
          {activeTab === 'MODEL_ARTIFACTS' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-2.5 shadow-xs">
                <div className="font-bold text-slate-800 uppercase">LOADED MODEL ARTIFACTS</div>
                {[
                  ['anomaly_detector.npz', 'Mahalanobis residual detector (nominal-only)'],
                  ['fault_classifier.json', 'XGBoost, 8 classes'],
                  ['severity_regressor.json', 'XGBoost → health index'],
                  ['rul_quantile_regressor.json', 'XGBoost 2.5/50/97.5 % + conformal'],
                  ['model_card.json', 'metrics & calibration'],
                ].map(([file, desc]) => (
                  <div key={file} className="flex justify-between py-1.5 border-b border-slate-200">
                    <span className="text-slate-600">{file}</span>
                    <span className="text-slate-800 font-bold">{desc}</span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-2.5 shadow-xs">
                <div className="font-bold text-slate-800 uppercase">HELD-OUT TEST METRICS (SIMULATOR DATA)</div>
                <div className="flex justify-between py-1.5 border-b border-slate-200">
                  <span className="text-slate-600">Detection precision / recall:</span>
                  <span className="text-slate-800 font-bold tabular-nums">
                    {((meta.anomaly_precision ?? 0) * 100).toFixed(1)}% / {((meta.anomaly_recall ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200">
                  <span className="text-slate-600">RUL MAE:</span>
                  <span className="text-slate-800 font-bold tabular-nums">{(meta.validation_mae_hours ?? 0).toFixed(1)} h</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200">
                  <span className="text-slate-600">Training data:</span>
                  <span className="text-slate-800 font-bold">{meta.training_dataset || '—'}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-slate-200">
                  <span className="text-slate-600">REST API Endpoint:</span>
                  <span className="text-sky-700 font-mono font-bold">POST /api/health-rul/predict</span>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs font-mono">
          <div className="text-slate-600 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Full metrics: ai_health_rul/models/model_card.json</span>
          </div>

          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded-md hover:bg-slate-100 transition-all shadow-xs"
          >
            CLOSE INSPECTOR
          </button>
        </div>

      </div>
    </div>
  );
};
