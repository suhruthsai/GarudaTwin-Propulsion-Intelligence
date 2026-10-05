"""
Writes training/data/test_episodes.json: the validation and held-out test episode IDs of the
episode-level split used by train_models.py (same function, same seed, so the same episodes).
training/baseline_comparison.mjs reads it to score every method on the same test samples.

Usage (after node training/generate_dataset.mjs):
    python training/export_split.py
    node training/baseline_comparison.mjs
"""

import json

import numpy as np
import pandas as pd

from train_models import DATA, ROOT, SEED, split_episodes

OUT = ROOT / "training" / "data" / "test_episodes.json"


def main():
    df = pd.read_csv(DATA, usecols=["episode", "fault_class"], low_memory=False)
    part = split_episodes(df, np.random.default_rng(SEED))   # train_models.main() makes this same first call
    by_episode = pd.Series(part, index=df["episode"]).groupby(level=0).first()
    split = {
        "seed": SEED,
        "split": "by episode, stratified by fault class, 70/15/15 (training/train_models.py split_episodes)",
        "test_episodes": sorted(int(e) for e in by_episode[by_episode == "test"].index),
        "val_episodes": sorted(int(e) for e in by_episode[by_episode == "val"].index),
    }
    OUT.write_text(json.dumps(split), encoding="utf-8")
    print(f"wrote {OUT}: {len(split['test_episodes'])} test, {len(split['val_episodes'])} validation episodes")


if __name__ == "__main__":
    main()
