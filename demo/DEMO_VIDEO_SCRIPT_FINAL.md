# GarudaTwin: "Three Tests", final demo video script (SIH 2026 Grand Finale)

**6:53**, 1920x1080, 30 fps, H.264 + AAC. File: `demo/GarudaTwin_Demo_Final.mp4`. All 9 modules appear. Voice: Windows en-IN (Microsoft Heera).

**Spine:** every engine monitor must pass three tests: catch a real fault, ignore a lying sensor, and never mistake silence for health. The cold open states today's problem with our own measured numbers; the payoff returns to the same numbers (2,110 -> 0).

Every frame carries **RECORDED DEMO / SIMULATED DATA**. RTB Planner and 6-DOF are shown as operator decision support on a simulated aircraft model, not automatic. Remaining-life figures on screen are tagged *research in progress, not claimed*.

## Scenes

### 01 - THE PROBLEM (0:00-0:36)

**Visual:** Animated cold open on a dark grid: 'Fixed limits on engine readings', 'Faults caught: about 1 in 4 (26.3 %)', '2,110' counting up in red, then 'We built something better. Here is the proof.'

**Voice:** The usual way to watch an aircraft engine is fixed limits: too hot, too low, raise an alarm. We tested that on our data. Fixed limits caught about one fault in four, and raised two thousand one hundred and ten false alarms on healthy engines. Fourteen thousand feet up, a missed fault can cost the aircraft, and a false alarm can end the mission. We built something better. In the next seven minutes, we will prove it.

### 02 - THE TWIN (0:36-1:10)

**Visual:** 3D CAD Blueprint [1]: the engine twin rotated by hand, title panel (GarudaTwin / Expected. Observed. Explained.), then a box on the inspector: 'delta = observed - expected (the residual)'.

**Voice:** This is GarudaTwin, by Team GarudaAstra, for problem statement SIH26054. It runs two engines. The real one: a Rotax 915 iS class engine on a medium-altitude drone. And a physics twin that computes what every reading should be, from throttle, engine speed, altitude and air temperature. The gap between the two, the residual, is what our AI reads.

### 03 - THE TWIN (1:10-1:32)

**Visual:** Data Source & Replay [6], then Blueprint cylinder 3 with the label 'healthy: within 2 C of the twin'.

**Voice:** Twenty-five readings arrive from the simulator, a live CAN bus, or a recorded flight, all through one path. On this healthy engine, expected and observed agree within two degrees. Everything you will see is our working prototype, running on simulated data.

### 03b - THE TWIN (1:32-1:52)

**Visual:** Live Telemetry [3]: gauges, cylinder spread, 28 V bus, fuel injection, CAN frames.

**Voice:** The Live Telemetry view shows the whole engine at once: speed, temperatures, oil, fuel and vibration, the spread across all four cylinders, the twenty-eight volt electrical bus, fuel injection, and the raw CAN frames.

### 04 - TEST 1 (1:52-2:16)

**Visual:** TEST 1/3 stamp. Blueprint, oil system: click 'Oil Cavitation'; on-screen stopwatch stops at 1.5 s; boxes 'AI named it' and 'ground truth, demo only'.

**Voice:** Test one: catch a real fault. Watch the clock. We inject oil-pump cavitation in the simulator, and the AI is not told. In this run: one and a half seconds, and it names the oil pump. The grey badge is ground truth, shown only for this demo.

### 05 - TEST 1 (2:16-2:43)

**Visual:** AI Prognostics & XAI [2] > Diagnostics: evidence rows light up one by one (oil pressure, vibration, oil temperature); label '3 coupled readings together -> the signature of cavitation'.

**Voice:** And it shows why. Oil pressure: the twin expects 3.85 bar, and the sensor reads far below. Vibration: up. Oil temperature: up. One reading alone could be a bad sensor. Three coupled readings moving together are the signature of cavitation. The system explains. The operator decides.

### 06 - TEST 2 (2:43-3:07)

**Visual:** TEST 2/3 stamp. Blueprint cylinder 2: 'simple monitor: DEGRADED', 'CHT-2: about +24 C', 'EGT-2: within 1 C'; then a logic card from the recorded inspector: EGT-2 delta +0.10 C matches the twin, CHT-2 delta +23.30 C only this one moved.

**Voice:** Test two: ignore a lying sensor. Cylinder two's head temperature climbs about twenty-four degrees, and the simple monitor declares the engine degraded. Now look at the same cylinder's exhaust: within one degree of the twin. A truly hot cylinder heats both. Only one moved.

### 07 - TEST 2 (3:07-3:24)

**Visual:** Split screen built from recorded frames: SIMPLE LIMIT MONITOR (Health 36.6 %, DEGRADED) vs GARUDATWIN (Sensor drift, health 99/100, urgency SENSOR CROSS-CHECK); verdict 'Cross-check the sensor. Don't abandon a healthy engine.'

**Voice:** GarudaTwin's answer: the sensor is drifting, and the engine is fine, ninety-nine out of a hundred. Cross-check the sensor. Don't abandon a healthy engine.

### 08 - TEST 3 (3:24-3:42)

**Visual:** TEST 3/3 stamp. Blueprint with LIVE INGEST from the project's CAN bridge (virtual rig, simulated misfire); boxes 'live CAN input', 'AI: MISFIRE'.

**Voice:** Test three: never mistake silence for health. The input is now live: CAN frames, decoded and fed to the same twin and AI. A virtual rig plays a simulated misfire, and the AI catches it.

### 09 - TEST 3 (3:42-3:59)

**Visual:** The feed stops: screen greys, health STALE, NO DATA; label 'SILENCE != HEALTHY'.

**Voice:** Now we cut the wire. Within two seconds: NO DATA, never NOMINAL. Every stale value greys out, and the AI stops scoring. A silent sensor never looks like a healthy engine.

### 10 - PROOF (3:59-4:19)

**Visual:** Data Source & Replay [6]: the 16:30 flight replayed at 10x; box '947 / 947 identical'.

**Voice:** Every flight is recorded, so every claim can be checked. We replay this sixteen-and-a-half-minute flight through a fresh twin and AI: 947 decisions out of 947, identical.

### 11 - PROOF (4:19-4:51)

**Visual:** Animated results card: rows appear in step with the voice; false alarms count down 2,110 -> 137 -> 5 -> 0; faults caught 26.3 / 68.3 / 93.1 / 96.5 %.

**Voice:** Now, remember those numbers. Fixed limits: 2,110 false alarms. Even with limits tuned on healthy data: 137. Add the physics twin: 5. Add the AI: zero, on more than fifteen thousand healthy samples, while catching 96.5 percent of faults, and naming the fault.

### 12 - PROOF (4:51-5:20)

**Visual:** AI Prognostics frame with labels lighting up: 45 features, built on physics residuals, anomaly detector (Mahalanobis), XGBoost classifier, TreeSHAP, trained on simulator data; model-card panel.

**Voice:** Under the hood: forty-five features, built mainly from the twin's residuals, feed two models. An anomaly detector says something is wrong. An XGBoost classifier says what, and TreeSHAP shows which readings drove it. The AI was trained on three hundred and seventy-eight thousand simulated samples, and scored on test episodes it had never seen.

### 13 - TOOLKIT (5:20-5:44)

**Visual:** Fleet Health [5], then What-If Test Bench [8] (Profile D -> OIL PUMP CAVITATION, CRITICAL: OPERATOR REVIEW).

**Voice:** Around this core sits the operator's toolkit. Fleet Health runs the same twin and AI for every aircraft; here, Vahak-4 is flagged for gearbox inspection. The What-If bench tests any condition: a lubrication-collapse profile is named oil-pump cavitation, for operator review.

### 14 - TOOLKIT (5:44-6:06)

**Visual:** RTB Contingency Planner [4]: contingency preview route; box on the Engage button 'not pressed: the operator decides'.

**Voice:** On a simulated aircraft model, the rule-based RTB planner previews a return route to Air Force Station Uttarlai, with its glide reach. Nothing changes unless a human presses Engage. This is operator decision support, not automation.

### 15 - TOOLKIT (6:06-6:25)

**Visual:** 6-DOF Flight Controller [7], then Mission Debrief [9] (hand-authored demo scenario).

**Voice:** Behind it, a six-degree-of-freedom flight simulation with autopilot modes tests those routes, in simulation only. And the Mission Debrief walks through a full sortie, clearly labelled as a hand-authored demo scenario.

### 16 - CLOSE (6:25-6:53)

**Visual:** Rotating engine, then the closing card: Shown / Not yet shown / Next, and 'GarudaTwin: It knows what your engine should be saying.'

**Voice:** Three tests, passed end to end, on simulated data. What we have not shown yet is a real engine. That is our next step: real Rotax 915 iS test-bench data, through the same CAN path. GarudaTwin. It knows what your engine should be saying. Team GarudaAstra. Thank you.

## Every number and its source

| Number | Source |
|---|---|
| Fixed limits: 26.3 % caught, 2,110 false alarms; tuned limits 68.3 % / 137; twin 93.1 % / 5; twin + AI 96.5 % / 0; macro F1 0.98; 810 test episodes; 48,920 samples (15,225 healthy) | `ai_health_rul/models/baseline_comparison.json`, `model_card.json` |
| 25 readings per frame | `server/engineFrame.js` CHANNELS |
| Twin inputs: throttle, engine speed, ambient pressure (altitude), outside air temperature | `src/engine/EngineSimulator.js` GoldenTwin |
| Healthy cylinder 3 within 2 C (recorded: EGT delta -0.7 to -1.7 C, CHT delta +0.2 to +0.4 C) | recorded frames |
| AI named the oil-pump fault 1.5 s after the click (this run) | recorder marks (inject 9.98 s, AI 11.47 s) |
| Oil pressure expected 3.85 bar; vibration and oil temperature up; weight = TreeSHAP share | recorded evidence table |
| CHT-2 about +24 C (recorded +23.3 to +24.6), EGT-2 within 1 C (recorded +0.1 to +0.9); AI health 99/100; SENSOR CROSS-CHECK | recorded frames |
| Live CAN: 67 frames accepted, 0 rejected; NO_DATA after 2 s without frames; stale frames not re-scored | CAN bridge log; `server.js`; `test_data_source.mjs` |
| Replay of a 16:30 flight: 947/947 identical; label agreement 98.3 % | recorded frame |
| 45 features; Mahalanobis anomaly detector + XGBoost classifier; TreeSHAP; 378,618 samples; 5,400 episodes; split by episode 70/15/15 | `model_card.json`; app labels |

## How it was made

Real screen recording of the running prototype (headless Microsoft Edge, visible cursor, real clicks), faults injected in the simulator, the live scene through the project's CAN bridge with its virtual rig. Annotations, stopwatch, split screen and cards were added with Python (Pillow) and ffmpeg; every annotated value comes from a recorded frame or the files above. No on-screen value was edited.

To record with a human voice: read the *Voice* lines over the same video; keep the 'simulated data' statement.
