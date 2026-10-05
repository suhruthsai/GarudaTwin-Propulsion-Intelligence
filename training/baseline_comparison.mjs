// Baseline comparison on the SAME held-out test samples the AI was evaluated on.
//
//   A. Fixed limits on raw readings (no model): the absolute checks of the L1 monitor
//      (EGT > 930 °C, CHT > 125 °C, oil pressure < 2.5 bar, bus < 26.5 V, battery SOC < 40 %).
//   B. Physics twin + fixed limits on the deviations (no AI): the full L1 threshold monitor
//      (thresholdHealth) on golden-twin residuals, exactly as the gateway runs it.
//   C. Twin + AI: read from ai_health_rul/models/model_card.json (same samples, same rule).
//
// Same samples: test episodes from training/train_models.py's split (seed 42, by episode),
// excluding "recovery" samples (just after a fault is cleared), as in the model card.
// Same decision rule: an alarm needs the raw flag on 2 consecutive samples of the episode.
//
// Usage: python training/export_split.py      (writes training/data/test_episodes.json)
//        node training/baseline_comparison.mjs
import { readFileSync, writeFileSync } from 'fs';
import { GoldenTwin, thresholdHealth } from '../src/engine/EngineSimulator.js';
import { CHANNELS, applyFrameToEngineState } from '../server/engineFrame.js';

const ROOT = new URL('..', import.meta.url);
const DATA = new URL('training/data/engine_dataset.csv', ROOT);
const SPLIT = JSON.parse(readFileSync(new URL('training/data/test_episodes.json', ROOT), 'utf8'));
const CARD = JSON.parse(readFileSync(new URL('ai_health_rul/models/model_card.json', ROOT), 'utf8'));
const testEps = new Set(SPLIT.test_episodes);
const SEV_BINS = [0.05, 0.15, 0.3, 0.6, 1.0];

const lines = readFileSync(DATA, 'utf8').split('\n');
const head = lines[0].trim().split(',');
const col = Object.fromEntries(head.map((h, i) => [h, i]));
for (const name of Object.keys(CHANNELS)) if (!(name in col)) throw new Error(`dataset has no column ${name}`);

const fixedLimits = (e) =>
  Math.max(...e.egt) > 930 || Math.max(...e.cht) > 125 || e.oilPressBar < 2.5 ||
  e.genVoltageV < 26.5 || e.batterySocPct < 40;

// Readings a conventional engine monitor would limit (no model), and twin residuals (no AI).
// Each value is "larger = worse"; low-side readings are negated.
const rawFeatures = (e) => ({
  egt_max: Math.max(...e.egt), cht_max: Math.max(...e.cht), oil_press_low: -e.oilPressBar,
  oil_temp: e.oilTempC, coolant: e.coolantTempC, vibration: e.vibrationGrms, map: e.mapBar,
  bus_volts_low: -e.genVoltageV, battery_soc_low: -e.batterySocPct,
});
const residualFeatures = (r) => ({
  egt: Math.max(...r.egt.map(Math.abs)), cht: Math.max(...r.cht.map(Math.abs)), map: Math.abs(r.map),
  oil_press: Math.abs(r.oilPress), oil_temp: Math.abs(r.oilTemp), vibration: Math.abs(r.vib),
  gen_volts: Math.abs(r.genV), battery_a: Math.abs(r.batteryA), inj_pct: Math.abs(r.injPct),
  fuel_trim: Math.abs(r.fuelTrimPct), coolant: Math.abs(r.coolant),
});

// One pass over test + validation episodes: raw checks for A/B, feature values for the tuned baselines
const valEps = new Set(SPLIT.val_episodes);
const methods = { A: [], B: [] };     // per scored test sample: flagged (after persistence)
const truth = [];                     // per scored test sample: { fault, label, sev }
const testRows = [];                  // per test row (incl. recovery): episode, features, scored?
const valHealthy = { raw: [], res: [] };
const fpByCheck = {};                 // which L1 checks fire on healthy test samples
let ep = null, twin = null, prevA = false, prevB = false;

for (let li = 1; li < lines.length; li++) {
  const line = lines[li];
  if (!line) continue;
  const c = line.split(',');
  const episode = +c[col.episode];
  const isTest = testEps.has(episode), isVal = valEps.has(episode);
  if (!isTest && !isVal) continue;
  if (episode !== ep) { ep = episode; twin = new GoldenTwin(); prevA = prevB = false; }

  const frame = {};
  for (const name of Object.keys(CHANNELS)) frame[name] = +c[col[name]];
  const e = { egt: [0, 0, 0, 0], cht: [0, 0, 0, 0] };
  applyFrameToEngineState(frame, e);
  const r = twin.update(e, +c[col.dt_s]).residuals;
  const label = c[col.label], recovery = c[col.phase] === 'recovery';
  const rf = rawFeatures(e), sf = residualFeatures(r);

  if (isVal) {
    if (label === 'NONE' && !recovery) { valHealthy.raw.push(rf); valHealthy.res.push(sf); }
    continue;
  }
  const th = thresholdHealth(e, r);
  const rawA = fixedLimits(e);
  const rawB = th.status !== 'NOMINAL';
  const flagA = rawA && prevA, flagB = rawB && prevB;     // 2-sample persistence within the episode
  prevA = rawA; prevB = rawB;
  testRows.push({ episode, rf, sf, scored: !recovery });

  if (recovery) continue;                                 // evaluation set = test & ~recovery
  methods.A.push(flagA); methods.B.push(flagB);
  truth.push({ fault: label !== 'NONE', label, sev: +c[col.severity] });
  if (label === 'NONE' && rawB) for (const x of th.exceedances) fpByCheck[x] = (fpByCheck[x] || 0) + 1;
}

// Tuned baselines: every limit set at the highest value seen on HEALTHY validation samples
// (the best a simple limit can do without alarming on a healthy engine), then applied to the test set.
const tuneLimits = (rows) => Object.fromEntries(Object.keys(rows[0]).map((k) => [k, Math.max(...rows.map((x) => x[k]))]));
const limRaw = tuneLimits(valHealthy.raw), limRes = tuneLimits(valHealthy.res);
const applyTuned = (key, lim) => {
  const out = []; let prev = false, prevEp = null;
  for (const row of testRows) {
    if (row.episode !== prevEp) { prev = false; prevEp = row.episode; }
    const raw = Object.entries(lim).some(([k, v]) => row[key][k] > v);
    const flag = raw && prev; prev = raw;
    if (row.scored) out.push(flag);
  }
  return out;
};
methods.A2 = applyTuned('rf', limRaw);
methods.B2 = applyTuned('sf', limRes);

const rate = (arr, sel) => { let n = 0, k = 0; arr.forEach((f, i) => { if (sel(truth[i])) { n++; if (f) k++; } }); return n ? k / n : null; };
const summarise = (flags) => {
  const tp = flags.filter((f, i) => f && truth[i].fault).length;
  const fp = flags.filter((f, i) => f && !truth[i].fault).length;
  const bySev = {};
  for (let b = 0; b < SEV_BINS.length - 1; b++) {
    const lo = SEV_BINS[b], hi = SEV_BINS[b + 1];
    bySev[`${lo.toFixed(2)}-${hi.toFixed(2)}`] = round(rate(flags, (t) => t.fault && t.sev >= lo && t.sev < hi + (hi === 1 ? 1e-9 : 0)));
  }
  const byClass = {};
  for (const cls of [...new Set(truth.filter((t) => t.fault).map((t) => t.label))].sort()) byClass[cls] = round(rate(flags, (t) => t.label === cls));
  return {
    fault_detection_recall: round(rate(flags, (t) => t.fault)),
    precision: round(tp / Math.max(1, tp + fp)),
    healthy_false_alarm_rate: round(rate(flags, (t) => !t.fault), 5),
    healthy_false_alarms: fp,
    recall_by_severity: bySev,
    recall_by_fault: byClass,
    names_the_fault: false,
  };
};
function round(v, d = 4) { return v === null ? null : Math.round(v * 10 ** d) / 10 ** d; }

const det = CARD.metrics.detection_end_to_end;
const result = {
  generated: new Date().toISOString(),
  dataset: `${CARD.training_data.samples} simulated samples, ${CARD.training_data.episodes} episodes (GarudaTwin engine simulator); model card ${CARD.version}, trained ${CARD.trained_at}`,
  evaluation_set: `held-out test episodes (${testEps.size}), split ${SPLIT.split}, seed ${SPLIT.seed}; recovery samples excluded`,
  scored_samples: truth.length,
  healthy_samples: truth.filter((t) => !t.fault).length,
  fault_samples: truth.filter((t) => t.fault).length,
  decision_rule: 'alarm when the raw flag holds on 2 consecutive samples of the same episode (as the live service)',
  A_fixed_limits_no_model: { ...summarise(methods.A), limits: 'L1 monitor absolute limits (hand-set caution values)' },
  B_twin_plus_fixed_limits_no_ai: { ...summarise(methods.B), limits: 'L1 monitor (thresholdHealth) as deployed', healthy_false_alarm_samples_by_check: fpByCheck },
  A2_tuned_limits_no_model: { ...summarise(methods.A2), limits: 'each raw reading limited at its maximum on healthy validation samples', limit_values: limRaw },
  B2_twin_plus_tuned_limits_no_ai: { ...summarise(methods.B2), limits: 'each twin deviation limited at its maximum on healthy validation samples', limit_values: limRes },
  validation_healthy_samples_for_tuning: valHealthy.raw.length,
  C_twin_plus_ai: {
    fault_detection_recall: det.recall, precision: det.precision,
    healthy_false_alarm_rate: det.nominal_false_alarm_rate,
    recall_by_severity: det.recall_by_severity,
    names_the_fault: true, fault_identification_macro_f1: CARD.metrics.fault_classifier.macro_f1,
    source: 'ai_health_rul/models/model_card.json (metrics.detection_end_to_end, same evaluation set)',
  },
};
writeFileSync(new URL('ai_health_rul/models/baseline_comparison.json', ROOT), JSON.stringify(result, null, 2));
const pct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
console.log(`scored ${result.scored_samples} samples (${result.healthy_samples} healthy, ${result.fault_samples} faulty)`);
for (const [k, m] of [['A fixed limits', result.A_fixed_limits_no_model], ['B twin + limits', result.B_twin_plus_fixed_limits_no_ai],
                      ['A2 tuned limits', result.A2_tuned_limits_no_model], ['B2 twin + tuned', result.B2_twin_plus_tuned_limits_no_ai], ['C twin + AI', result.C_twin_plus_ai]]) {
  console.log(`${k.padEnd(16)} detects ${pct(m.fault_detection_recall).padStart(6)} | precision ${pct(m.precision).padStart(6)} | healthy false-alarm rate ${pct(m.healthy_false_alarm_rate).padStart(6)} | low severity (0.05-0.15) ${pct(m.recall_by_severity['0.05-0.15']).padStart(6)}`);
}
console.log('healthy false alarms of B by check:', JSON.stringify(fpByCheck));
console.log('per fault (A | B | A2 | B2):');
for (const cls of Object.keys(result.A_fixed_limits_no_model.recall_by_fault)) console.log(`  ${cls.padEnd(24)} ${[result.A_fixed_limits_no_model, result.B_twin_plus_fixed_limits_no_ai, result.A2_tuned_limits_no_model, result.B2_twin_plus_tuned_limits_no_ai].map((m) => pct(m.recall_by_fault[cls]).padStart(6)).join(' | ')}`);
