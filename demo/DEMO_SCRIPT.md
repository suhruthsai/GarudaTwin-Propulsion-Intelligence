# GarudaTwin — Demo Script (≈ 7 min)

**Expected values** below were measured in the rehearsal (`node demo/rehearse.mjs`, log in `demo/rehearsal_log.txt`), using the same severities as the inject buttons. Live values vary slightly with sensor noise.

## Before the judges arrive (5 min)

Tab hotkeys: 1 Blueprint · 2 AI Prognostics · 3 Telemetry · 4 RTB Planner · 5 Fleet · 6 Data & Replay · 7 Flight Controller · 8 What-If Bench · 9 Debrief (demo).

1. Start everything:
   ```bash
   npm run start:all
   ```
   Open http://localhost:5173.
2. Header checks:
   - Header shows **SIMULATOR** and **NOMINAL**.
   - **Tab 2** shows the AI as online, not `AI OFFLINE`.
3. Reset the sortie (Tab 7 · 6-DOF Flight Controller → **RESET**). Wait ~30 s for the AI to settle at `NONE`.
4. Select **Vahak-1** in Tab 1. In the component inspector, select **CYL 3** so the inject buttons are visible.
5. Keep `demo/VALIDATION_AND_LIMITATIONS.md` open in a second window.

> **Rule for every step:** after **Clear All (Nominal)**, wait until the AI has shown `NONE` for ~10 s before injecting the next fault. The AI's 8-sample window must flush first. In the rehearsal, injecting immediately after the oil-cavitation clear produced a wrong class (`PRGB_DEGRADATION`) for ~4 s, and clearing a sensor drift briefly flickered back to `SENSOR_DRIFT`. Talk over the gap.

## 0:00 – 0:45 · The problem and the idea (no clicking)

> "A MALE UAV is lost when its single engine fails over hostile terrain. GarudaTwin is a digital twin of the Rotax 915 iS. A physics model — ISA air data, turbo limit, cooling, ECU fuel trim, injection, alternator and battery — predicts what every sensor *should* read. Our AI models look only at the difference between measured and predicted (residuals), so they detect, identify and size faults across altitude and temperature, and estimate remaining useful life with a 95 % interval. Everything you will see is computed live; the data is from our simulator, not a real engine — I'll be explicit about that at the end."

## 0:45 – 1:30 · Tab 3 · Live Telemetry (nominal)

Point at the three panels:
- **Engine:** EGT/CHT ×4, MAP, oil, vibration.
- **Injection:** injection time ≈ 14.4 ms, ECU fuel trim 0 %.
- **Electrical and air data:** bus 28.4 V, battery +1 A charging, SOC ≈ 98 %; ambient pressure and OAT at 14,500 ft.

> "The AI says NONE with ~97 % confidence and health 100. These are 25 channels, the same ones we accept from a CSV, a live ingest API or a CAN bus via our DBC file."

## 1:30 – 2:45 · Tab 1 · 3D Blueprint → inject **Cyl 3 Clog**

Click **Cyl 3 Clog**.

**Say:** "I've injected a cylinder-3 injector clog. Notice the grey *INJECTED (truth)* badge appears immediately, but no component lights up yet — the 3D model shows only what the AI has detected."

**What happens (~2 s):**
- **AI:** `CYL3_INJECTOR`, 100 %.
- **3D model:** CYL 3 and the fuel rail turn red.
- **Telemetry:** cylinder 3 EGT is ~137 °C hotter than the median. The ECU richens all cylinders (fuel trim +15 %, injection time 14.4 → 16.5 ms).
- **Thrust:** 93 % (lean cylinder loses power); the autopilot holds altitude.

**Then switch to Tab 2 · AI Prognostics & XAI:**
- **Top cause (TreeSHAP):** "hottest cylinder 3 +137 °C vs median".
- **Health / RUL:** health ≈ 10, RUL ≈ 4–6 h with its 95 % interval.

> "The explanation is in engineering units, not a black box."

Click **Clear All (Nominal)**. The AI is back to `NONE` in ~5 s; the rule allows up to ~12 s.

## 2:45 – 3:45 · Gen Failure (alternator)

Click **Gen Failure**.

**What happens (~2 s):**
- **AI:** `GENERATOR_FAILURE`.
- **Electrical (Tab 3):** bus 28.4 → 23.8 V. Battery current goes from +1 A to **−30 A** (discharging), and SOC is visibly falling.
- **Thrust:** stays **100 %**.

> "An electrical fault drains the battery but does not reduce propeller thrust — the twin keeps propulsion and electrical separate. The operator sees battery endurance, not a false engine alarm."

Click **Clear All (Nominal)**.

## 3:45 – 4:45 · Oil Cavitation → Tab 4 · RTB Contingency Planner

Click **Oil Cavitation**.

**What happens (~2 s):**
- **AI:** `OIL_PUMP_CAVITATION`. Oil pressure is ~2 bar below the twin, with fluctuation.
- **Health / RUL:** health < 20, RUL ≈ 1.5–2 h.

**Then Tab 4 shows:**
- **Decision:** **EMERGENCY DIVERT TO NEAREST AIRFIELD**, AFS Jaisalmer, ~31 NM.
- **Profile:** 58 % throttle, −350 fpm.
- **Reasons on screen:** "health < 40 %; RUL < 2 h; diagnosis OIL_PUMP_CAVITATION".

> "Low oil pressure doesn't reduce power by itself — the engine still runs at 100 % — but it will fail. The planner is deterministic and its rules are printed on screen: the same rule set runs in the GCS, the planner service and the fallback, checked on 315 cases."

Click **Clear All (Nominal)**.

## 4:45 – 5:30 · Sensor Drift (CHT2) — the "broken gauge" case

Click **Sensor Drift (CHT2)**.

**What happens (~6 s; the bias ramps up over 20 s):**
- **AI:** `SENSOR_DRIFT`; the CYL 2 sensor is highlighted.
- **Health / RUL:** health stays **100**, RUL unchanged.
- **Thrust:** stays 100 %.
- **Simple threshold monitor (L1):** goes **DEGRADED**.

> "A simple threshold system would have aborted the mission for a broken gauge. The AI tells you the engine is fine and the sensor needs replacing."

Click **Clear All (Nominal)**.

## 5:30 – 6:15 · Tab 6 · Data Source & Replay, then Tab 5 · Fleet

**Tab 6:**
- Load the rehearsal recording (or import `demo/backup_sortie.csv`).
- Press play at 5×.

> "Every flight is recorded with the exact frames the AI scored. Replay reproduces the live diagnoses exactly — verified frame-for-frame. The same path accepts real engine data: CSV, an HTTP ingest API, or CAN."

**Tab 5:**

> "Vahak-2 to 4 each run their own engine, twin and AI session; Vahak-5 is in the hangar. Flight hours drive the TBO-based remaining life."

## 6:15 – 7:00 · Validation and honesty (`demo/VALIDATION_AND_LIMITATIONS.md`)

> "On held-out simulator episodes: 100 % precision, 96.5 % recall, 0 false alarms in 15,225 healthy samples, macro F1 0.98, 95.8–97 % accuracy at every altitude and temperature band. What it is **not**: it has never seen a real engine. When we add calibration offsets the simulator doesn't produce, F1 drops to 0.50 — so the next step is test-cell data from a 915 iS to calibrate the twin per engine. The physics constants are stated assumptions; the debrief tab is a hand-authored demo; the planner is rule-based, not reinforcement learning."

---

## If something goes wrong

| Problem | Fix |
| :--- | :--- |
| AI shows `AI OFFLINE` | The L1 threshold monitor and the GCS keep running. Say so, then restart the stack: `npm run stop` then `npm run start:all` (~20 s). |
| Live fault behaves unexpectedly | Tab 6: import `demo/backup_sortie.csv` and replay it. It contains the whole sequence above (rehearsal of 1 Oct 2026) with the original AI results. |
| UI frozen | Reload the browser. The gateway keeps state. |
| Laptop fails | Use the screen recording of this script (record it yourself on the demo laptop after a final rehearsal). |

## Likely questions — honest answers

- **"Is this real engine data?"** No. It's a physics-based simulator; the constants are engineering assumptions. The data path for real data (CSV, ingest API, CAN DBC) is built and tested.
- **"Health is 9 % but thrust is 100 %?"** Health is how far the *diagnosed fault* has progressed toward functional failure (0 = failed), not available power. An oil pump near failure still delivers full power until it seizes.
- **"Why does health jump around at high severity?"** Each second is an independent estimate. At high severity the per-sample health swings by ±10–15 points, e.g. 2–27 during the alternator failure. Overall test MAE is 1.5 points; RUL and the planner rules are the stable signals.
- **"Is the RTB planner AI / reinforcement learning?"** No, deterministic rules (shown on screen), deliberately: they must be auditable.
- **"How fast does it detect?"** Median 1.2 s (p90 1.4 s) on test data; 2–6 s in this live rehearsal. Sensor drift ramps in over 20 s.
- **"What about faults you never trained on?"** A Mahalanobis detector trained on healthy data only flags them as `UNCLASSIFIED_ANOMALY` (it never saw a fault in training, yet catches 91.9 % of test fault samples with 100 % precision).
- **"What happens right after a fault is cleared?"** The diagnosis returns to `NONE` in a median 8 s (p90 12 s). During that window a different class can flicker briefly, because the rolling window still holds the old fault's samples. We saw `PRGB_DEGRADATION` for ~4 s after clearing oil cavitation. It's documented; a production version would need a transition-aware window.
- **"DO-178C / MIL-STD?"** Not done. It's the target process for a production version; nothing here is certified.
