/**
 * Labelled dataset generator for the AI Health & RUL models.
 *
 * Drives the SAME EngineSimulator used by the live gateway, so training data and the
 * live digital twin share one physics source. Each episode is sampled at ~1 Hz with
 * jittered intervals (matching the UI's 1 Hz inference calls).
 *
 * Fault episodes are snapshots of a synthetic degradation trajectory:
 *   severity s(t) = (t / L)^p,  L ~ LogNormal(median life per fault), p ~ U(1.5, 3)
 *   RUL = L - t  (hours until functional failure, s = 1)
 * The life priors below are engineering assumptions, not fleet data.
 *
 * SENSOR_DRIFT is a measurement fault: the engine is healthy, so engine_severity = 0 and it has
 * no RUL label. SENSOR_FAILURE (stuck sensor) is handled by the data-quality layer, not the ML
 * models, so it is not generated here.
 *
 * Usage: node training/generate_dataset.mjs [--out path] [--seed N] [--scale F]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EngineSimulator, GoldenTwin, FAULT_TYPES, SENSOR_CHANNELS, seededRng } from '../src/engine/EngineSimulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const OUT = arg('out', path.join(__dirname, 'data', 'engine_dataset.csv'));
const SEED = Number(arg('seed', 20260930));
const SCALE = Number(arg('scale', 1));

const N_NOMINAL = Math.round(1000 * SCALE);
const N_PER_FAULT = Math.round(400 * SCALE);

// Median hours from detectable onset to functional failure (assumed priors)
const MEDIAN_LIFE_H = {
  CYL3_INJECTOR: 120, BLOW_BY: 300, OIL_PUMP_CAVITATION: 60, TURBO_WASTEGATE_STUCK: 200,
  COOLING_DEGRADATION: 150, GENERATOR_FAILURE: 180, PRGB_DEGRADATION: 250,
  MISFIRE: 80, COMBUSTION_INSTABILITY: 100, INJECTOR_COKING: 500,
};
// Fault classes the ML models learn (SENSOR_FAILURE is detected by data-quality rules instead)
const ML_FAULTS = FAULT_TYPES.filter(f => f !== 'NONE' && f !== 'SENSOR_FAILURE');

const rng = seededRng(SEED);
const U = (a, b) => a + (b - a) * rng();
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const pick = arr => arr[Math.floor(rng() * arr.length)];

const randomPoint = () => ({ rpm: U(3000, 5800), throttle: U(30, 100) });

/** Operating profile: returns a function(sim, t) applied before each physics step */
function makeProfile() {
  const kind = pick(['LOITER', 'LOITER', 'FIXED', 'TRANSIENTS']);
  if (kind === 'LOITER') return { kind, init: null, apply: () => {} };
  if (kind === 'FIXED') return { kind, init: randomPoint(), apply: () => {} };
  // Rapid throttle transitions: new operating point every 10–40 s
  let nextChange = U(10, 40);
  return {
    kind,
    init: randomPoint(),
    apply: (sim, t) => {
      if (t >= nextChange) {
        const p = randomPoint();
        sim.manual.rpm = p.rpm;
        sim.manual.throttle = p.throttle;
        nextChange = t + U(10, 40);
      }
    },
  };
}

const HEADER = [
  'episode', 'sample', 't_s', 'dt_s', 'profile', 'phase', 'label', 'fault_class', 'severity', 'engine_severity',
  'rul_h', 'life_h', 'fault_param',
  'rpm', 'throttle', 'egt1', 'egt2', 'egt3', 'egt4', 'cht1', 'cht2', 'cht3', 'cht4',
  'map_bar', 'oil_pressure', 'oil_temp', 'vibration', 'fuel_flow', 'lambda',
  'gen_voltage', 'gen_current', 'coolant_temp',
  // JS golden-twin nominal values, used by the Python parity test
  'twin_egt', 'twin_cht', 'twin_oil_temp',
];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const out = fs.createWriteStream(OUT);
out.write(HEADER.join(',') + '\n');

function runEpisode(ep, faultClass) {
  const faultState = { activeFault: 'NONE', severity: 0 };
  const sim = new EngineSimulator({ rng, fault: faultState });
  sim.time = U(0, 600); // random phase of the scripted loiter sine
  const profile = makeProfile();
  if (profile.init) { sim.manual.rpm = profile.init.rpm; sim.manual.throttle = profile.init.throttle; }
  sim.settleThermal();

  // Randomised fault parameters so the models learn the physics, not one cylinder or channel
  let params, paramLabel = '';
  if (faultClass === 'MISFIRE') {
    params = { cylinder: Math.floor(rng() * 4) };
    paramLabel = `cyl${params.cylinder + 1}`;
  } else if (faultClass === 'INJECTOR_COKING') {
    params = { pattern: [0, 1, 2, 3].map(() => U(0.4, 1.4)) };
    paramLabel = params.pattern.map(v => v.toFixed(2)).join('/');
  } else if (faultClass === 'SENSOR_DRIFT') {
    params = { channel: pick(SENSOR_CHANNELS), sign: rng() < 0.5 ? -1 : 1 };
    paramLabel = `${params.channel}${params.sign > 0 ? '+' : '-'}`;
  }
  faultState.params = params;

  // Fault trajectory snapshot
  let severity = 0, rul = NaN, life = NaN;
  if (faultClass === 'SENSOR_DRIFT') {
    severity = U(0.05, 1.0); // bias magnitude; engine itself is not degrading
  } else if (faultClass !== 'NONE') {
    life = MEDIAN_LIFE_H[faultClass] * Math.exp(0.35 * normal());
    const p = U(1.5, 3.0);
    const uMin = Math.pow(0.05, 1 / p);           // start where severity >= 0.05
    const u = U(uMin, 0.995);
    severity = Math.pow(u, p);
    rul = life * (1 - u);
  }
  // Half the fault episodes start mid-stream (onset inside the rolling window)
  const onset = faultClass !== 'NONE' && rng() < 0.5 ? U(5, 30) : 0;
  // 30 % of fault episodes are cleared again (repair / transient fault), so the models also learn
  // the recovery transition (rolling window still holding fault samples while sensors are healthy)
  const clearAt = faultClass !== 'NONE' && rng() < 0.3 ? onset + U(15, 35) : Infinity;

  // Warm-up so noise and the scripted profile are running before sampling starts
  const warm = U(3, 10);
  const t0 = sim.time;
  let t = 0;
  while (t < warm) { profile.apply(sim, t); sim.step(0.01); t += 0.01; }

  const twin = new GoldenTwin();
  const nSamples = Math.round(U(50, 90));
  let lastSampleT = t;
  let nextSample = t;
  for (let k = 0; k < nSamples; k++) {
    const epT = nextSample - warm;
    if (faultClass !== 'NONE' && epT >= onset && epT < clearAt) {
      faultState.activeFault = faultClass;
      faultState.severity = severity;
    } else if (epT >= clearAt) {
      faultState.activeFault = 'NONE';
      faultState.severity = 0;
    }
    while (t < nextSample) { profile.apply(sim, t); sim.step(0.01); t += 0.01; }
    const dt = k === 0 ? 1.0 : t - lastSampleT;
    lastSampleT = t;
    const e = sim.engine;
    const tw = twin.update(e, dt).nominal;
    const active = faultState.activeFault !== 'NONE';
    const phase = faultClass === 'NONE' ? 'nominal' : active ? 'fault' : epT >= clearAt ? 'recovery' : 'pre';
    const row = [
      ep, k, (sim.time - t0).toFixed(2), dt.toFixed(3), profile.kind, phase,
      active ? faultClass : 'NONE', faultClass,
      active ? severity.toFixed(4) : 0,
      active && faultClass !== 'SENSOR_DRIFT' ? severity.toFixed(4) : 0,
      active && Number.isFinite(rul) ? rul.toFixed(3) : '', Number.isFinite(life) ? life.toFixed(2) : '', paramLabel,
      e.rpm.toFixed(1), e.throttlePct.toFixed(2), ...e.egt, ...e.cht,
      e.mapBar, e.oilPressBar, e.oilTempC, e.vibrationGrms, e.fuelFlowLph, e.lambda,
      e.genVoltageV, e.genCurrentA, e.coolantTempC,
      tw.egt.toFixed(3), tw.cht.toFixed(3), tw.oilTemp.toFixed(3),
    ];
    out.write(row.join(',') + '\n');
    nextSample = t + U(0.95, 1.4); // UI calls the AI service at ~1 Hz with network jitter
  }
}

let ep = 0;
const t0 = Date.now();
for (let i = 0; i < N_NOMINAL; i++) runEpisode(ep++, 'NONE');
for (const f of ML_FAULTS) for (let i = 0; i < N_PER_FAULT; i++) runEpisode(ep++, f);
out.end(() => console.log(`Wrote ${ep} episodes to ${OUT} in ${((Date.now() - t0) / 1000).toFixed(1)} s (seed ${SEED})`));
