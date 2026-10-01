# GarudaTwin — Validation & Limitations (one page)

**What it is.** An AI digital twin for health monitoring and remaining-useful-life (RUL) prediction of the Rotax 915 iS engine on a MALE UAV.
- **Physics:** an engine physics model (ISA air data, turbo limit, cooling, ECU fuel trim, injection, alternator/battery) acts as a "golden twin". It predicts what every sensor *should* read.
- **AI:** models trained on the residuals (measured − twin) detect, classify and size faults, and estimate RUL with a 95 % interval.
- **Prototype status:** everything below was measured on simulator data. **No real engine data has been used.**

## What was validated, and how

| Claim | Evidence (held-out test episodes, never seen in training) |
| :--- | :--- |
| Detects engine faults | Precision 100.0 %, recall 96.5 %; median latency 1.19 s (p90 1.39 s) |
| No false alarms on a healthy engine | 0 in 15,225 healthy test samples (≈ 4.2 h at 1 Hz). This is zero *observed*, not a guarantee |
| Identifies which fault (12 classes) | Macro F1 0.981; 96.0 % accuracy even at low severity (0.05–0.15) |
| Works across the flight envelope | Accuracy 95.8–97.0 % in every altitude band (0–23,000 ft) and ISA band (−20…+25 °C); 0 false alarms in each |
| Health index | MAE 1.51 points; a drifting *sensor* does not lower *engine* health (mean 99.5) |
| RUL | MAE 22.9 h; 95 % interval covers the truth 94.5 % of the time |
| Unknown faults | Detector trained on healthy data only: recall 91.9 %, precision 100 %, ROC-AUC 0.9975 |
| Explainable | Every diagnosis reports its top TreeSHAP contributors (sensor group and residual) |

**How leakage was prevented:**
- Labels and health scores are never model inputs; a regression test enforces this.
- The train/test split is by episode, so overlapping windows never straddle the two sets.
- Thresholds were calibrated on validation data and metrics reported on test data, using the exact decision rule the live service runs.

**System checks:**

| Check | Result |
| :--- | :--- |
| Replay of a recorded flight | Reproduces the live AI diagnoses exactly (e.g. 1,484 / 1,484) |
| CAN encode/decode (DBC, 25 channels) | 99.96 % identical diagnoses |
| JavaScript ↔ Python twin parity | < 0.011 °C |
| Shared RTB rules in UI, service and fallback | 315 cases, all agree |
| Automated test suites | 7, all passing: pytest 23, AI/physics 6, flight controller 5, security 13, data 21, fleet 19, geofence 11 |

## Limitations (stated, not hidden)

1. **Simulator data only.**
   - The physics constants are engineering assumptions, not Rotax data. No thermostat or ignition timing is modelled.
   - Simulator sensor noise is small relative to the fault signatures, which makes the task easier than on a real engine.
2. **Not robust to calibration offsets.** Adding sensor offsets the simulator never produces drops classifier macro F1 to **0.50**. A deployed twin needs a per-engine baseline calibration and real data.
3. **Hard cases.**
   - Weak sensor drift (below ~5–10 % of full scale) can be missed.
   - After a fault is cleared, the diagnosis takes a median 8.2 s (p90 12.4 s) to return to normal.
4. **Fault severity is set by the scenario**, not grown from usage. RUL uses assumed degradation-life priors.
5. **Validated envelope:** 0–23,000 ft, ISA −20…+25 °C. Outside it the GCS shows a warning.
6. **What is real-time AI and what is not:**
   - **Real-time AI:** Vahak-1, and each of Vahak-2..4. Each runs its own simulator, twin and AI session; Vahak-5 is grounded.
   - **Rule-based:** the RTB planner (not reinforcement learning).
   - **Hand-authored demo:** the Mission Debrief tab and its assistant.
   - **Not done:** DO-178C / MIL-STD compliance; it is the target process only.
7. **Hardware.** CAN was tested on a virtual bus (python-can + DBC), not a physical adapter. The Indo-Pak border geofence uses an approximate border polyline.

## Path to deployment

1. Test-cell or flight data from a 915 iS, used to calibrate the twin per engine.
2. Retrain and validate on that data, including a real-noise stress test.
3. A physical CAN adapter, then hardware-in-the-loop testing.
4. Usage-based degradation for RUL.
5. Certification-oriented development (DO-178C process).
