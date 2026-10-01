"""
Measures two data-derived constants from healthy simulator data:

 1. STD_NOISE_FLOOR (feature_engineering.py): median rolling std of each rolling-std feature in
    nominal operation (full 8-sample windows only).
 2. STUCK_SAMPLES (validation.py): 2 x the longest run of exactly identical consecutive readings
    per channel within an episode, ignoring readings pinned at the transducer's full-scale limit
    (saturation is a real extreme value, not a frozen sensor). Real (noisy) sensors never repeat
    that long, so a longer run means the sensor is frozen.

    ai_venv/Scripts/python training/measure_noise_floor.py
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from ai_health_rul.preprocessing.feature_engineering import FeatureExtractor, FEATURE_NAMES, STD_FEATURES  # noqa: E402
from ai_health_rul.preprocessing.validation import DataQualityGuard  # noqa: E402

DATA = ROOT / "training" / "data" / "engine_dataset.csv"
df = pd.read_csv(DATA, low_memory=False)
episode = df["episode"].to_numpy()

# ---- 1. longest identical run per channel, excluding values at the full-scale limit ----
channels = {"egt": [f"egt{i}" for i in range(1, 5)], "cht": [f"cht{i}" for i in range(1, 5)],
            "oil_temp": ["oil_temp"], "oil_pressure": ["oil_pressure"], "coolant_temp": ["coolant_temp"],
            "map_bar": ["map_bar"], "vibration": ["vibration"], "lambda": ["lambda"], "rpm": ["rpm"],
            "fuel_flow": ["fuel_flow"], "gen_voltage": ["gen_voltage"], "gen_current": ["gen_current"]}
full_scale = DataQualityGuard.SENSOR_FULL_SCALE
print("Longest run of identical consecutive readings (within an episode, excluding full-scale values):")
for ch, cols in channels.items():
    longest, repeats, pairs = 0, 0, 0
    lo, hi = full_scale.get(ch, (-np.inf, np.inf))
    for col in cols:
        v = df[col].to_numpy(dtype=float)
        same = (v[1:] == v[:-1]) & (episode[1:] == episode[:-1]) & (v[1:] > lo) & (v[1:] < hi)
        valid = (episode[1:] == episode[:-1])
        repeats += same.sum()
        pairs += valid.sum()
        run = best = 0
        for s in same:
            run = run + 1 if s else 0
            best = max(best, run)
        longest = max(longest, best)
    print(f"  {ch:14s} longest run {longest:4d}  P(repeat) {repeats / pairs:.3f}  -> 2x = {2 * max(longest, 3)}")

# ---- 2. median rolling std of each STD feature in nominal operation ----
nom = df[df["fault_class"] == "NONE"]
scalar = ["rpm", "throttle", "map_bar", "oil_pressure", "oil_temp", "vibration", "fuel_flow",
          "lambda", "gen_voltage", "gen_current", "coolant_temp"]
rows = []
for _, g in nom.groupby("episode"):
    guard, fx = DataQualityGuard(), FeatureExtractor()
    for i, r in enumerate(g.to_dict("records")):
        raw = {c: r[c] for c in scalar}
        raw["egt"] = [r["egt1"], r["egt2"], r["egt3"], r["egt4"]]
        raw["cht"] = [r["cht1"], r["cht2"], r["cht3"], r["cht4"]]
        clean = guard.validate_and_clean_frame(raw, dt=r["dt_s"])["cleaned_frame"]
        _, ctx = fx.update(clean, r["dt_s"])
        if i >= 7:
            rows.append([ctx["rstd"][f] for f in STD_FEATURES])
X = np.array(rows)
print("\nMedian nominal rolling std (raw, before any floor):")
for j, f in enumerate(STD_FEATURES):
    print(f"  {f:18s} median {np.median(X[:, j]):.4f}   p5 {np.quantile(X[:, j], 0.05):.4f}")
