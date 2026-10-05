# GarudaTwin: 7-minute demo video script (SIH 2026 Grand Finale)

Screen recording of the running prototype, with voice-over and captions. **6:52**, 1920×1080, 30 fps, H.264 + AAC. File: `demo/GarudaTwin_Demo_Video.mp4`.

Covers all 9 modules. The order follows the review comments: data source → expected vs observed → explain the deviation → missing data → what it proves. The RTB Contingency Planner and 6-DOF Flight Controller (about 40 s) are presented as *operator decision support on a simulated aircraft model, not automatic*.

Every frame carries **RECORDED DEMO · SIMULATED DATA**. Remaining-life (RUL) figures that appear on screen are tagged *research in progress, not claimed*. Each number in the narration was read from the screen during the recording run (or from `ai_health_rul/models/baseline_comparison.json` for the results card).

## Scenes

### 01. 0:00–0:26 · [1] 3D CAD BLUEPRINT

**Screen:** 3D CAD Blueprint [1], the engine twin rotated by hand

**Caption:** GarudaTwin: AI digital twin for aero piston-engine health. Recorded from the running prototype; every engine reading is simulated.

**Narration:** This is GarudaTwin, an AI digital twin for the health of an aircraft piston engine of the Rotax 915 iS class, as used on medium-altitude drones. Team GarudaAstra, problem statement SIH26054. Everything in this recording runs on our working prototype, and every engine reading is simulated.

### 02. 0:26–0:51 · [6] DATA SOURCE & REPLAY

**Screen:** Data Source & Replay [6]: simulator, live ingest, replay; flight recordings

**Caption:** Data source: simulator today; a live test rig / CAN bus, or a recorded or imported flight, use the same twin and AI. Every flight is recorded.

**Narration:** Step one, the data source. This tab chooses what feeds the system: the built-in engine simulator, a live test rig or CAN bus, or the replay of a recorded or imported flight. All three go through the same golden twin and the same AI. Every flight is recorded automatically, with the exact samples the AI scored.

### 03. 0:51–1:26 · [1] 3D CAD BLUEPRINT

**Screen:** 3D CAD Blueprint [1], cylinder 3 selected, healthy engine

**Caption:** Expected vs observed: the physics twin predicts every reading. Healthy engine, cylinder 3: EGT Δ −1.7 °C, CHT Δ +0.2 °C, anomaly score 0.

**Narration:** Step two, expected versus observed. The golden twin is a physics model of the engine. For the current throttle, engine speed, altitude and air temperature, it computes what every sensor should read. In the 3D blueprint, the inspector shows each reading with its difference from the twin. On this healthy engine the differences stay within about two degrees, and the anomaly score is zero. Remaining-life figures on screen are research in progress; we do not claim them.

### 04. 1:26–1:46 · [3] LIVE TELEMETRY

**Screen:** Live Telemetry [3]

**Caption:** Live telemetry: engine speed, temperatures, oil, fuel, vibration, cylinder spread, 28 V bus, fuel injection and the CAN frames.

**Narration:** The Live Telemetry tab shows the full engine picture: speed, temperatures, oil pressure, fuel flow and vibration, the spread between the four cylinders, the electrical bus, fuel injection, and the raw CAN frames in the project's CAN message layout.

### 05. 1:46–2:08 · [1] 3D CAD BLUEPRINT

**Screen:** 3D CAD Blueprint [1], oil system; oil-pump cavitation injected

**Caption:** Fault injected in the simulator: oil-pump cavitation. The AI is not told (grey badge = ground truth, demo only). AI named it 1.5 s after the click.

**Narration:** Now we inject a fault in the simulator: oil-pump cavitation. The AI is not told. The grey injected badge is ground truth, shown only for this demo. In this run the AI named the oil-pump fault one and a half seconds after the click, and the simple limit monitor turned CRITICAL.

### 06. 2:08–2:48 · [2] AI PROGNOSTICS & XAI

**Screen:** AI Prognostics & XAI [2] > Diagnostics & Advisory, oil-pump cavitation

**Caption:** Explain the deviation: expected oil pressure 3.85 bar, observed far below; vibration and oil temperature also up. Most consistent with oil-pump cavitation.

**Narration:** Step three, explain the deviation. The AI Prognostics tab shows the evidence. The twin expects about 3.85 bar of oil pressure; the sensor reads far below that. Vibration and oil temperature are also above the twin, and the weight column shows how much each reading drove the decision. One residual alone could be a failed sensor or a model error. Here three coupled readings move together, so the pattern is most consistent with oil-pump cavitation. The advisory leaves the decision to the operator; nothing is applied automatically.

### 07. 2:48–3:20 · [1] BLUEPRINT → [2] AI

**Screen:** Blueprint [1] cylinder 2, then AI Prognostics [2]; CHT-2 sensor drift injected

**Caption:** Harder case, CHT-2 sensor drift: CHT Δ about +24 °C but EGT within 1 °C of the twin. Simple monitor: DEGRADED. AI: sensor drift, health 100/100, sensor cross-check.

**Narration:** A harder case: a drifting temperature sensor on cylinder 2. Its head temperature reads about 24 degrees above the twin, and the simple monitor marks the engine DEGRADED. But the exhaust temperature of the same cylinder agrees with the twin within one degree; a cylinder that is really overheating would heat both. The AI names a likely sensor drift, keeps engine health at 100 out of 100, and asks for a sensor cross-check.

### 08. 3:20–3:38 · [5] FLEET HEALTH

**Screen:** Fleet Health [5]

**Caption:** Fleet health: the same twin and AI for every airborne vehicle. Vahak-4: gearbox (PRGB) degradation, inspection. Vahak-5: grounded. Simulated fleet.

**Narration:** The Fleet Health tab runs the same twin and AI for every airborne vehicle. Here Vahak-4 is flagged for reduction-gearbox degradation and inspection, and Vahak-5 is on the ground. All of this fleet data is simulated.

### 09. 3:38–3:58 · [8] WHAT-IF TEST BENCH

**Screen:** What-If Test Bench [8], Profile D (lubrication collapse)

**Caption:** What-if test bench: load a simulator-generated profile or set readings by hand; the AI scores each frame. Profile D → oil-pump cavitation, for operator review.

**Narration:** The What-If Test Bench lets an engineer load a simulator-generated profile or set readings by hand, and the AI scores each frame on its own. Profile D, a lubrication collapse, is named oil-pump cavitation, and the result is shown for the operator to review.

### 10. 3:58–4:19 · [4] RTB CONTINGENCY PLANNER

**Screen:** RTB Contingency Planner [4], contingency preview

**Caption:** Operator decision support on a simulated aircraft model, not automatic: the rule-based planner previews a return route; nothing changes unless the operator presses Engage.

**Narration:** The RTB Contingency Planner is rule-based operator decision support on a simulated aircraft model. It previews a return route, here to Air Force Station Uttarlai, with its glide reach, but nothing changes unless the operator presses Engage. It is not automatic.

### 11. 4:19–4:37 · [7] 6-DOF FLIGHT CONTROLLER

**Screen:** 6-DOF Flight Controller [7]

**Caption:** Operator decision support on a simulated aircraft model, not automatic: a 6-DOF aircraft simulation with autopilot modes and envelope protections, used to test the planner's routes.

**Narration:** The 6-DOF Flight Controller is a simulated model of the aircraft, with autopilot modes and envelope protections, used to test those routes. It is a simulation for testing, not a flight controller for a real aircraft.

### 12. 4:37–5:02 · [1] 3D CAD BLUEPRINT

**Screen:** Blueprint [1], LIVE source fed by the project's CAN bridge (virtual rig, simulated misfire episode)

**Caption:** Live input: CAN frames → DBC decode → same twin and AI. A virtual CAN rig replays a simulated misfire episode. AI: MISFIRE.

**Narration:** Step four, live input and missing data. Here the source is switched to live: the project's CAN bridge decodes CAN messages with a DBC file and sends them in. For this demo a virtual CAN rig replays a simulated misfire episode. The same twin and AI flag a misfire; cylinder one's exhaust runs far below the twin.

### 13. 5:02–5:18 · [1] BLUEPRINT → [3] TELEMETRY

**Screen:** The CAN feed stops: NO DATA, screen greyed, health STALE

**Caption:** Feed stopped → NO DATA within 2 s, never NOMINAL. Values greyed and marked stale; health shows STALE. The AI stops scoring until fresh data arrives.

**Narration:** Then the feed stops. Within two seconds the status becomes NO DATA, never NOMINAL. The screen turns grey, health shows STALE, and the AI stops scoring until fresh data arrives.

### 14. 5:18–5:43 · [6] DATA SOURCE & REPLAY

**Screen:** Data Source & Replay [6], replay of this demo's simulator flight (16:30) at 10x

**Caption:** Replay: this demo's simulator flight through a fresh twin and AI session. 947 / 947 AI diagnoses identical to live; label agreement 98.3 %, disagreements listed.

**Narration:** Every run is recorded. Here the simulator flight from this demo, sixteen and a half minutes long, is replayed through a fresh twin and AI session. All 947 of 947 AI diagnoses match the live ones, and the disagreements with the injected labels are listed on screen, not hidden.

### 15. 5:43–5:57 · [9] MISSION DEBRIEF

**Screen:** Mission Debrief [9], hand-authored demo scenario

**Caption:** Mission debrief: a hand-authored demo scenario, labelled as such, to explain a sortie timeline. Real flights and AI results are in the replay tab.

**Narration:** The Mission Debrief tab is a hand-authored demo scenario, labelled as such, used to explain a full sortie timeline. Real flights and real AI results are in the replay tab.

### 16. 5:57–6:32 · Card

**Screen:** Card: measured comparison (ai_health_rul/models/baseline_comparison.json)

**Caption:** What it proves: the twin cuts false alarms; the AI adds detection and names the fault. Simulated data only.

**Narration:** Step five, what it proves. On the same 810 held-out simulated test episodes, simple limits tuned on healthy data catch 68 percent of fault samples, with 137 false alarms. Adding the physics twin: 93 percent, with 5. Twin plus AI: 96.5 percent, with zero false alarms, and it also names the fault. These are simulator results, not yet real-engine results.

### 17. 6:32–6:52 · Card

**Screen:** Card: shown / not yet shown / next

**Caption:** Next: real Rotax 915 iS test-bench data through the same CAN path.

**Narration:** So the full chain works end to end on simulated data. Accuracy on a real engine is not yet shown, and remaining-life prediction is still research in progress. Next, we bring real Rotax 915 iS test-bench data through the same CAN path. Thank you.

## Values quoted and where they come from

| Value | Source |
|---|---|
| Healthy cylinder 3: EGT Δ −1.7 °C, CHT Δ +0.2 °C, anomaly 0 % | scene 03 screen |
| AI named oil-pump cavitation 1.5 s after the injection click | scene 05, measured by the recorder |
| Expected oil pressure 3.85 bar (golden twin) | scene 06 evidence table |
| CHT-2 drift: CHT Δ about +24 °C, EGT Δ +0.9 °C; AI health 100/100; urgency SENSOR CROSS-CHECK | scene 07 screens |
| Vahak-4 PRGB degradation / inspection; Vahak-5 grounded | scene 08 Fleet table |
| Profile D → OIL PUMP CAVITATION, CRITICAL: OPERATOR REVIEW | scene 09 What-If panel |
| Planner preview to AFS Uttarlai; ENGAGE button not pressed | scene 10 |
| Live CAN bridge: 67 frames accepted, 0 rejected (virtual rig, simulated MISFIRE episode 47) | `tools/can/can_bridge.py` log |
| No frame for 2 s → NO_DATA, never NOMINAL; stale frame not re-scored | `server.js`; `test_data_source.mjs` |
| Replay: 947/947 identical to live; label agreement 98.3 % (931/947) | scene 14 screen (recording “Sortie #58 simulator 06:17:48”, 16:30) |
| 68.3 % / 137, 93.1 % / 5, 96.5 % / 0 false alarms (15,225 healthy samples), macro F1 0.98 | `baseline_comparison.json`, `model_card.json` |

## How it was made

1. `npm run start:all`; a script drove the real UI in headless Microsoft Edge (visible cursor, real clicks and drags) and captured every screen update per scene.
2. Faults were injected through the simulator; the live scene used the project's CAN bridge with its virtual rig.
3. Narration: Windows en-IN voice (Microsoft Heera). Captions and the step bar were added with ffmpeg; no on-screen value was edited.
4. To record with your own voice, read the narration above over the same screens; keep the “simulated data” statement at the start.
