# GarudaTwin — End-to-End Verification Report (SIH 2026 finale review)

Tested on Windows 11, Node 24.13, Python 3.12, commit `0ee7897`. Every finding below was reproduced against the running system (gateway :5002, AI service :8001, Vite UI :5173), not inferred from code alone.

> **Update 9 — injection timing, battery/alternator and altitude/temperature are now real signals; models retrained; geofence.** *Physics* (`src/engine/EngineSimulator.js`, mirrored in Python, parity < 0.011 °C): ECU closed-loop lambda trim (±15 %, ~1 s) and injection time (ms); alternator capacity vs. electrical load with a 17 Ah battery and 28.4 V regulated bus; ISA air data from the 6-DOF altitude (turbo MAP limit above ~20,000 ft at loiter, cooling ∝ density^-0.8, EGT with intake temperature). Original calibration preserved exactly at 14,500 ft ISA; constants are stated assumptions (no thermostat, no ignition timing). 6 new channels (25 total) through recorder (DB migration; older recordings refused for replay), CSV, live ingest, CAN (0x320, 0x330) and the UI, which previously showed fixed 18.2° / 98.4 % / "185 bar common rail" values. *Retrain* (378,618 samples, 0–23,000 ft, ISA −20…+25): macro F1 0.981, detection 100 % precision / 96.5 % recall, 0 false alarms in 15,225 healthy test samples, every altitude and temperature band 95.8–97.0 % accuracy, health MAE 1.51, RUL MAE 22.9 h (95 % coverage 94.5 %). Clearing after a fault p90 12.4 s (worse than the previous 8.5 s; ECU trim unwind + window). A first retrain had 7.8 false alarms/h and 31 s clearing — traced to two physics assumptions (alternator droop too small vs. noise, trim too slow), corrected and re-measured. *Found and fixed while verifying:* battery SOC reading could exceed 100 %; unit/CAN tests sent only the old channels (a client omitting air data gets 14,500 ft ISA, flagged as imputed — documented); the what-if bench's cylinder-3 profile reflected the old physics; **any critical electrical exceedance cut propeller thrust** (flight model used the overall threshold index; now propulsion-only — verified: alternator failure holds altitude, oil-pump fault still derates); **Vahak-1 flew across the border** (started in altitude-hold on heading 000 with no orbit; flight log: crossed ≈ 27.45 N after ~25 min) — now orbits its station and a 2 Hz geofence (5 NM border buffer, 2-min look-ahead, operating box) returns it, logs `GEOFENCE_RETURN` and refuses routes into the buffer; the what-if bench injected its profiles into the live aircraft by default (caused a 3,500 ft altitude loss during testing) — now off by default. CAN quantisation with all channels: 4,836/4,838 diagnoses identical (99.96 %). Tests: pytest 23/23, AI/physics 6/6, FCS 5/5, security 13/13, data 21/21, fleet/planner/bench 19/19, geofence 11/11.
>
> **Update 8 — verification of the planner, fleet and bench changes found two more defects (fixed).** (1) *RTB planner:* the screen showed "power derate commanded" for a degraded escort while commanding 78 % throttle, level cruise, to the primary base — the GCS, the planner service and the gateway fallback each had their own thresholds (RUL < 20 h vs < 50 h, different derate RPM) and the service never received the AI diagnosis. Now one rule set (`src/planner/rtbRules.js`, mirrored in `ai_service.py`, imported by the gateway fallback); the UI sends the diagnosis, Vahak-1's fuel (escorts: not monitored) and the operating point; the screen states which component produced the plan and whether it agrees. Parity test: 315/315 cases identical in status, action, airfield and throttle for both the service and the fallback; all three modes clicked for a healthy and a degraded vehicle in the browser. (2) *What-If bench:* clicking a fault profile once returned NONE (2-sample persistence) and earlier profiles leaked through the 8-sample window (oil-pump profile diagnosed as blow-by; nominal profile diagnosed as turbo after a turbo profile); the AI diagnosis was not displayed at all and its "model posterior" read a non-existent field. Now each what-if request is a true single-frame assessment (fresh session, no persistence): all 5 profiles correct in any order, nominal result identical before/after faults; the diagnosis and real classifier posterior are shown. Tests: fleet/planner/bench 19/19, AI/physics 6/6, pytest 23/23, FCS 5/5, security 13/13, data 21/21.
>
> **Update 7 — fake fleet replaced by a real one; misleading labels corrected.** *Fleet:* Vahak-2..4 previously were hard-coded numbers in six places, including invented engine values, XAI explanations and reasoning per vehicle; each now runs its own engine simulator, golden twin, L1 monitor and AI session on the gateway (`server/fleet.js`), Vahak-5 is grounded with no data, and faults are injectable per vehicle. `npm run test:fleet` 15/15 (Vahak-4's gearbox scenario found by its own AI, health 79.4 vs 75; misfire on Vahak-3 diagnosed at health 40.2 vs 40 with no effect on other vehicles). *Found and fixed:* a healthy high-hours engine was reported "Degrading" with an INSPECTION advisory because health/TBO was treated as a degradation rate (now 0 when no engine fault is diagnosed); the planner's derate command always commanded Vahak-1 even when an escort was selected; the bench's offline fallback and status were driven by the chosen fault label. *Relabelled:* "RL replanner" → rule-based RTB contingency planner (fake survivability / cycle-life metrics removed, triggering rule shown, glide reach from the flight controller's L/D model); "Swarm fleet" → Fleet Health; "HIL acceptance bench (MIL-STD-810H/STANAG)" → What-If Test Bench; debrief "reasoning kernel" → scripted assistant on a hand-authored demo scenario; "DO-178C certified airworthiness dossier" → demo-scenario PDF report; header MIL-STD-1472H / DO-178C badges → "SIH 2026 prototype · simulator data"; "Bayesian" confidences → data quality / classifier posterior / conformal interval; FL280/FL300 presets → FL220/FL230 (service ceiling ~23,000 ft); legacy autoencoder marked legacy-only; status tray shows measured frame rate and frame age instead of fixed "100 Hz / 4.2 ms". All suites pass: pytest 23/23, AI/physics 6/6, FCS 5/5, security 13/13, data 21/21, fleet 15/15.
>
> **Update 6 — engine data sources, flight recorder and replay (M7 fixed; problem-statement section E).** The gateway now has one engine data source at a time — `SIM` (built-in simulator), `REPLAY` (a recorded flight or imported CSV, 0.5–10×, pause/seek) or `LIVE` (frames pushed by a test rig / CAN bridge via key-protected `POST /api/ingest/frames`); the golden twin, L1 monitor, AI and every tab read the selected source. Every SIM/LIVE flight is recorded to SQLite (10 Hz frames + the exact samples the AI scored with its live answer; ~8.8 MB per recorded hour). Replay feeds those samples to a fresh, separate AI session, so it must reproduce the live diagnoses exactly — **verified: 115/115 (simulator flight with three injected faults), 85/85 (live ingest), 64/64 (CAN)**; a CSV of 20 unseen episodes replayed through the gateway gave **1,484/1,484** diagnoses identical to scoring the same rows directly in Python (health/RUL difference 0.0). CAN: `tools/can/garudatwin_engine.dbc` is the single layout (new frame 0x310 carries generator V/A and coolant, which were missing; the wrong oil-temperature comment, M8, corrected); `tools/can/can_bridge.py` decodes any `python-can` bus — demonstrated without hardware on a virtual bus (injector coking diagnosed, health 45.4 vs truth 45.6). CAN quantisation leaves all 4,911 fixture diagnoses unchanged (health mean change 0.10). Live safety: no frame for 2 s → `NO_DATA`, never `NOMINAL`; stale frames are not re-scored; all 19 channels are required (no silent "nominal" imputation); fault injection only in SIM. Also fixed: the mission replanner's vehicle status used the injected fault label (now the AI diagnosis, or the L1 monitor when the AI is offline). Tests: `npm run test:data` 21/21, `pytest tools/can` 6/6, plus all earlier suites. Limitations: all data is simulator data; a real ECU needs its own DBC; the ingest endpoint needs TLS beyond localhost.
>
> **Update 5 — missing fault modes added (M4 fixed), models retrained.** The simulator now injects `MISFIRE`, `COMBUSTION_INSTABILITY`, `INJECTOR_COKING` ("coding degradation" in the problem statement read as coking), `SENSOR_DRIFT` and `SENSOR_FAILURE`; each is a physical signature (e.g. misfire = one cylinder intermittently cold + RPM jitter; instability = cycle-to-cycle fluctuation, seen in rolling std; coking = unequal partial blockage, fuel flow ↓), verified sample-by-sample, and the original 7 faults reproduce byte-identically. Features 32 → 41 (cold-cylinder spreads, crank-speed jitter); classifier 8 → 12 classes; dataset 5,400 episodes / 377,877 samples with 30 % of fault episodes cleared mid-flight. Sensor drift is an ML class with engine severity 0 (health stays ~100, advisory = inspect the named suspect channel); sensor failure (stuck channel) is a data-quality rule with thresholds measured from nominal data (`training/measure_noise_floor.py`). A 2-sample persistence and an 8-sample latch were added to the decision chain and applied identically in training evaluation. **Held-out:** macro F1 0.980, end-to-end precision 99.99 % / recall 96.4 %, 0.68 false alarms/h, median latency 1.19 s, health MAE 1.24, RUL MAE 25.3 h (95 % coverage 95.5 %), sensor-drift recall 0.917, detector-only recall for instability/coking ~0.65. **Live (gateway → AI at 1 Hz):** misfire, instability and coking diagnosed in 2 s with health within 4 points of truth; sensor drift in 3 s (suspect "CHT cylinder 2", health 100, while the L1 threshold monitor wrongly reports DEGRADED); stuck oil-pressure sensor in 19 s; coking at 0.8 is missed by the L1 threshold monitor but caught by the AI. Tests: pytest 17/17, AI/physics 6/6, FCS 5/5, gateway security 13/13. Remaining: ~8 s to return to NONE after clearing, with an occasional brief wrong-class flicker during that window.
>
> **Update 4 — user login removed at the team's request.** Login, accounts, roles and the audit log were taken out; the GCS opens directly. Kept (no user-facing friction): CORS/origin allowlist incl. WebSocket origin check, 127.0.0.1 binding, AI-service internal key, server-side 1 Hz AI loop, input validation and security headers — `npm run test:security` now 13/13. **Consequence:** anyone who can reach the gateway port can command the twin, so keep `HOST=127.0.0.1` for demos.
>
> **Update 3 — authentication and CORS (C8) fixed.** *(authentication since removed, see Update 4)* Gateway login with scrypt-hashed accounts and signed, revocable 8 h tokens; `viewer` / `operator` roles enforced on every REST route and every Socket.IO command; exact origin allowlist that also refuses foreign-origin WebSocket upgrades; AI service bound to 127.0.0.1, wildcard CORS removed, requires the gateway's internal key and fails closed; login brute-force throttling; audit log of logins, denials and operator commands. Also fixed an integrity gap found while doing this: every open browser tab used to feed frames into the live AI session (3 tabs ⇒ window covered 3 s instead of 8 s, and any client could inject fake frames) — the gateway now runs live inference itself at 1 Hz and broadcasts it; client predictions go to a per-user sandbox session. Verified by `npm run test:security` (50/50: unauthenticated access, forged/`alg:none`/expired/foreign-secret tokens, role escalation, foreign-origin REST + WebSocket, logout revocation, brute force, gateway→AI key and session pinning), `pytest` AI-service access tests (5/5), and in the browser (viewer command rejected, operator accepted). Remaining: no TLS — required before binding beyond localhost.
>
> **Update 2 — leakage removed and models retrained.** Sections below the line describe the original baseline. Status after the fix:

| Finding | Status | What changed |
|---|---|---|
| C1 `health_index` decides diagnosis | **Fixed** | Removed from inputs everywhere. Regression tests assert a `health_index` or fault label in the payload changes nothing. |
| C2 models out-of-domain | **Fixed** | No training code existed. New pipeline: `training/generate_dataset.mjs` drives the *same* `src/engine/EngineSimulator.js` the gateway runs (now 377,877 labelled samples, 5,400 episodes incl. rapid throttle transitions — see Update 5); `training/train_models.py` trains, calibrates and evaluates on held-out episodes. |
| M4 required fault modes missing | **Fixed (Update 5)** | Misfire, combustion instability, injector coking, sensor drift, sensor failure injectable and diagnosed. |
| M7 engine telemetry never stored / no real replay | **Fixed (Update 6)** | Server-side flight recorder; replay through the twin + AI with exact reproduction; CSV import; live ingest + CAN bridge. |
| M8 CAN docs vs code | **Fixed (Update 6)** | Layout defined once in a DBC; gateway bytes tested against it. |
| C3 gateway health is an oracle | **Fixed** | Health/status from golden-twin residual exceedances only (`thresholdHealth`). Offline: 0 false alarms in 30 min incl. 30–100 % throttle steps. |
| C4 UI shows injected label as diagnosis | **Fixed** | "Probable Fault" / "AI DIAGNOSIS" = model output; injected scenario shown separately as ground truth. |
| C5 untrained PyTorch models | **Fixed / removed** | Autoencoder trained on nominal simulator frames, weights shipped. Untrained Bi-LSTM removed; legacy `/predict-rul` uses the trained RUL model. |
| C6 overstated README metrics | **Fixed** | README table generated from `model_card.json` (held-out test), limitations and stress test stated. |
| C7 fake SHAP / "PINN" labels | **Fixed** | Exact TreeSHAP from XGBoost `pred_contribs`; misleading "PINN", "Validated vs Rotax dataset", "Historical flight log", hard-coded "Physics Correlation 100 %" labels corrected. "RL" renamed rule-based. |
| M2 loop rates / sim-time drift | **Fixed** | Physics stepped by elapsed wall-clock time: sim time now 0.999× real time (was 0.64×). |
| M5 shared AI state across clients | **Fixed** | Per-`uav_id` sessions (rolling window, golden twin, anomaly persistence). |

**Held-out test results at Update 2 (8 classes; superseded by Update 5 numbers above and `ai_health_rul/models/model_card.json`):**

| Model | Result |
|---|---|
| Mahalanobis residual detector (nominal-only ⇒ unknown-fault detector) | recall 96.7 % (every class ≥ 94 %), 0.008 % false alarms/sample. IsolationForest tried first: 16 % recall — rejected. |
| Full diagnosis as served | precision 99.98 %, recall 99.1 %, 1.6 false alarms/hour at 1 Hz, detection on the first post-onset sample |
| XGBoost fault classifier | macro F1 0.995; 99.0 % accuracy even at severity 0.05–0.15 |
| Health index (severity regressor) | MAE 1.05 points |
| RUL (quantile XGBoost + conformal) | MAE 21.5 h, median error 28 %, 95 % interval coverage 93.2 % |
| Latency | ~17 ms per prediction in-process (was 63 ms p50 over HTTP) |

**Live end-to-end at Update 2** (gateway stream → AI service at 1 Hz, exactly as the UI calls it; new fault modes: see Update 5):

| Scenario | AI diagnosis | Time to correct diagnosis | Health (true) | Gateway L1 monitor |
|---|---|---|---|---|
| Nominal loiter, 100 %/5800 rpm and 40 %/3500 rpm throttle transients | NONE, 100 % of samples | — | 99.6–100 (100) | 100 % NOMINAL |
| All 7 faults @ 0.85 | correct class, 100 % after onset | 1 s (first post-injection sample) | 13.6–15.5 (15) | 100 % alarmed |
| BLOW_BY / COOLING / GENERATOR @ 0.30 | correct class, 100 % | 1 s | 69.5–70.6 (70) | 75–100 % (threshold monitor misses part of the low-severity blow-by; the AI does not) |
| Fault cleared | returns to NONE | 4–7 s (window flush) | ~100 | 100 % NOMINAL |

**Honest limitations:** simulator sensor noise is small relative to fault signatures (the task is easier than a real engine); a stress test with uncalibrated sensor offsets drops classifier macro F1 to 0.58 — a deployed twin needs per-engine baseline calibration and real data; RUL relies on assumed degradation-life priors; after a fault clears the diagnosis takes 5–7 s to return to NONE (8-sample window flush). Judges Sandbox benchmark profiles were hand-authored with signatures that contradicted the simulator (e.g. blow-by with a voltage sag → diagnosed as generator failure); they are now generated from the simulator and all 5 are diagnosed correctly. The sandbox also read the RUL interval from non-existent fields (`rulLower95`), showing an interval that excluded its own estimate; fixed.

---

## Architecture as built

```
React GCS (Vite :5173) ──socket.io 20 Hz──▶ Node gateway (:5002)
   │  1 Hz POST /api/health-rul/predict        ├─ scripted engine sim (setInterval 10 ms)
   ▼                                            ├─ 6-DOF + TECS/L1 autopilot + FADEC interlock
FastAPI AI service (:8001)                      └─ SQLite WAL (FCS rows only)
   ├─ ai_health_rul (baseline): IsolationForest + fault classifier + RUL regressor (sklearn/xgboost pickles)
   └─ legacy PyTorch autoencoder / Bi-LSTM (untrained) + rule-based "RL" replanner
```

## What works well (credit)

- **6-DOF flight model + TECS autopilot are genuinely good.** Independent test: +2000 ft step climbs at ~620 fpm, captures 5029.2 m with 0.0 m error, IAS held within 2.5 kt; heading 000→090 captured in ~60 s.
- Builds cleanly; UI loads without runtime errors; 3D engine twin, alert banner, fault propagation to every tab work.
- All 7 injectable faults produce the expected physical signatures and alerts.
- SQLite WAL logging, CSV export, parameterised queries (SQL injection attempt harmless).
- Offline mission predictor computes ISA density correctly (1.225 kg/m³ SL; 1.022 kg/m³ at 2000 ft/48 °C).
- Project test suites pass: pytest 3/3, AI/physics suite 6/6, FCS suite 5/5.

## Critical findings (a technical judge will find these)

| # | Finding | Evidence |
|---|---|---|
| C1 | **The ML fault diagnosis is decided by the `health_index` input, not by sensors.** Every fault profile → `lubrication` at health_index 0.30, `none` at 0.98. *Nominal* sensors + health_index 0.45 → "CRITICAL lubrication". The UI sends the gateway's scripted health score as this field, so the "AI" echoes the rule engine. | `ml_probe` §2–3; `health_predictor.py:98-106`, `TelemetryContext.jsx:482` |
| C2 | **Raw classifier is out-of-domain on the project's own simulator**: on nominal telemetry it predicts `sensor_drift` 62%, `none` 0.5%; IsolationForest flags nominal as anomalous. The `health_index ≥ 0.95 → force "none"` gate hides this. | `ml_probe` §4 |
| C3 | **Health status is an oracle.** Gateway computes CRITICAL/DEGRADED only `if (activeFault !== 'NONE')`. Injecting a fault at severity 0 (sensors perfectly nominal) → DEGRADED, health 68.7. Real sensor excursions with no label → always NOMINAL. | `server.js` broadcast loop; gw_test |
| C4 | **UI "Probable Fault" shows the injected label** (`telFault`) ahead of the model output. | `PrognosticsTab.jsx:126` |
| C5 | **PyTorch autoencoder & Bi-LSTM have random weights** — no weight file exists, no `load_state_dict`. Zeroing all LSTM weights leaves RUL unchanged (842.0 h); RUL is `842 / deg_factor`. README metrics for these models cannot come from this code. | `ai_service.py:110-119, 414` |
| C6 | **README overstates metrics.** Anomaly model recall = **0.0607**, F1 = **0.11** (in `anomaly_metrics.json`) but README shows only precision/ROC-AUC. RUL MAE "63.62 s (~1.06 hrs)" — 63.62 s is ~1 minute. Latency claimed <14.5 ms; measured p50 **63 ms**, p95 **121 ms**. | `models/*.json`, latency probe |
| C7 | **"RL replanner" is if/else rules**; no policy, training or environment exists. "SHAP/TreeSHAP" attributions are % deviation from constants, so the injector fault is attributed 89.7% to vibration and 3.6% to EGT (its primary signature). "PINN" label: no PINN in repo. | `ai_service.py:472+`, `health_rul_service.py:207` |
| C8 | **(CORS fixed; login added in Update 3, removed in Update 4 by request)** **No authentication anywhere.** Any host on the network can inject faults, reset, change autopilot mode, load waypoints. CORS reflects any origin with credentials. Problem statement asks for *secure telemetry architecture*. | gw_test |
| C9 | **One malformed request corrupted the flight model (FIXED).** `POST /api/fcs/altitude {"alt_ft":"abc"}` → entire 6-DOF state NaN permanently, NULL rows written to SQLite. | gw_test2 |

## Major findings

- **M1 Engine and airframe are decoupled.** Engine throttle 78.9% vs autopilot throttle 31.5% simultaneously; engine RPM is a scripted sine. Engine physics ignores altitude and ambient temperature, so the live twin can't show high-altitude or hot-weather behaviour (those exist only in the offline MissionPredictor).
- **M2 Loop rates overstated.** Measured 64 Hz engine / 32 Hz FCS / 16 Hz broadcast on Windows (claimed 100/50/20). Fixed `dt` means sim time runs at 0.64× wall-clock. Status bar values "SYNCED (100 Hz)", "4.2 ms", "50 Hz" are hardcoded strings (`App.jsx:430-441`).
- **M3 Required parameters faked**: injection timing constant 18.2/18.5°, battery SOC/SOH constant 98.4/96.5%.
- **M4 Required fault modes missing from the live sim**: misfire, sensor drift/failure, combustion instability, coking — none injectable.
- **M5 AI service holds global state across all callers** (rolling history + Kalman filter): same nominal frame returns RUL 1012 h, then 2.0 h after another client sends fault frames. Fleet-level use is impossible.
- **M6 Prognostics contradictions on screen**: stress factor 897× next to "severe = 3.8–7.5×"; health 12% (below 50% MEL) but "2.0 h until MEL"; identical 96.3% risk at 1/4/8/24 h; evidence rows `null null null`; "100% BAYESIAN sensor confidence" during a critical fault.
- **M7 Persistence gaps**: engine telemetry never stored (only FCS rows); `emergency_events` table never written.
- **M8 CAN docs vs code**: 0x200/0x210 EGT/CHT encoded ×10, 0x300 oil temp encoded (T+50)×100; header comment says otherwise.
- **M9 OOD guard unreachable via API** (rpm=7000 → 200; DataQualityGuard clips first). sklearn pickles emit version-mismatch warnings; requirements are unpinned.
- **M10 Domain**: FL280/FL300 scenario presets exceed the Rotax 915 iS service ceiling (~23,000 ft); advisory text says "squawk 7700" for an unmanned aircraft.
- **M11 Test quality**: FCS Test 2 started from the wrong altitude and passed vacuously (FIXED). Unit test fault fixture sets `health_index: 0.45`, i.e. feeds the answer (C1).
- **M12** `npm audit --omit=dev`: engine.io (high), qs, dompurify (moderate). 2.08 MB single JS chunk.

## Fixes applied in this review (verified)

| File | Fix | Verification |
|---|---|---|
| `server.js` | Validate/clamp all FCS inputs (alt 0–7010 m, IAS 60–240 kt, heading, loiter, FBW, waypoints); reject unknown flight modes | `alt_ft:"abc"` → 400, state stays finite; bad mode → 400; 400 kt → clamped 240 |
| `server.js` | Fault whitelist, severity clamped to [0,1], REST severity 0 honoured (was `|| 0.85`) | fake fault rejected; severity 50 → 1; 0 → 0 |
| `server.js` | Sandbox RPM/throttle override now persists (was overwritten within 10 ms); cleared on reset | RPM 3000 → reads 3003 |
| `test_flight_controller.js` | Test 2 starts from real altitude, asserts ±15 m capture | now a real climb: 0.0 m error, 5/5 |
| `AtmosphericPhysicsEngine.js` | `deltaIsaC` = ambient − ISA(h) (was ambient) | SL 15 °C → 0 |
| `PrognosticsTab.jsx` | Anomaly card no longer says "Within Nominal" at 0.81 | screenshot |
| `TelemetryContext.jsx` | Flight recorder / fallback used stale mount-time prognostics & mission demand (closure) | code review |

Gateway harness: **18/34 → 25/34** pass. Remaining failures are C3, C8, M1, M2, M3, M8 — architectural, listed above.

## Recommended before the finale (priority order)

1. **Remove `health_index` from ML inputs** (it is the label) and retrain classifier/IF on data generated by *your own* simulator; report honest confusion matrix including recall.
2. Derive gateway health status from residuals, not `activeFault`; show model output in "Probable Fault" and the injected label separately as "ground truth".
3. Either train the autoencoder/LSTM and ship weights, or remove them and the related README claims. Rename "RL" → "rule-based replanner" unless you add a policy.
4. Correct README numbers (recall, RUL units, latency, loop rates) — a judge checking one number and finding it wrong discounts all of them.
5. Add token auth on socket + REST, restrict CORS origin, bind to localhost by default; mention TLS/DTLS for telemetry in the roadmap.
6. Couple engine sim to autopilot throttle and atmosphere; add misfire, sensor drift and combustion-instability injection; make injection timing and battery SoC dynamic.
7. Per-UAV state in the AI service (keyed by `uav_id`); persist engine telemetry for mission replay; use measured `Date.now()` deltas as `dt`.

## Reproduce

```
npm install
py -3.12 -m venv ai_venv && ai_venv\Scripts\pip install -r requirements.txt
node server.js            # :5002
ai_venv\Scripts\python ai_service.py   # :8001
npm run dev               # :5173
node test_flight_controller.js
ai_venv\Scripts\python -m pytest ai_health_rul/tests
```
