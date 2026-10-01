"""
Train & evaluate the AI Health / RUL models on simulator data.

    node training/generate_dataset.mjs          # -> training/data/engine_dataset.csv
    ai_venv/Scripts/python training/train_models.py [--rebuild]

Leakage controls
  * No health score or fault label is used as an input feature (physics residuals only).
  * Train/validation/test split is by EPISODE, stratified by fault class, so rolling-window
    samples from the same run never appear on both sides of the split.
  * Anomaly threshold is calibrated on validation data; all reported metrics are on the
    untouched test episodes, using the exact decision rule the live service uses.

Stress test
  * The test episodes are re-scored with constant per-episode nuisance offsets the simulator
    never produces (bus-voltage sag, common-mode CHT/EGT shifts, calibration drift) and the
    results are reported separately. Training on such offsets was tried and rejected: it cut
    unknown-fault recall from 97 % to 75 % without fixing out-of-domain inputs.

Outputs (ai_health_rul/models/): Mahalanobis residual anomaly detector (npz), fault classifier,
severity regressor and RUL quantile regressor (XGBoost JSON), autoencoder.pt, model_card.json.
No pickled models are produced.
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import xgboost as xgb
from sklearn.covariance import LedoitWolf
from sklearn.metrics import (classification_report, confusion_matrix,
                             precision_recall_fscore_support, roc_auc_score)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ai_health_rul.config.config import (  # noqa: E402
    MODEL_DIR, FAULT_CLASSES, ANOMALY_DETECTOR_FILE, FAULT_CLASSIFIER_FILE,
    SEVERITY_REGRESSOR_FILE, RUL_REGRESSOR_FILE, MODEL_CARD_FILE, AUTOENCODER_FILE, ROLLING_WINDOW,
)
from ai_health_rul.preprocessing.validation import DataQualityGuard  # noqa: E402
from ai_health_rul.preprocessing.feature_engineering import FeatureExtractor, FEATURE_NAMES  # noqa: E402
from ai_health_rul.inference.decision import decide, persist, latch, UNCLASSIFIED  # noqa: E402
from ai_health_rul.inference.autoencoder import EngineAnomalyAutoencoder, normalise  # noqa: E402

DATA = ROOT / "training" / "data" / "engine_dataset.csv"
SEED = 42
RUL_QUANTILES = np.array([0.025, 0.5, 0.975])
SEV_BINS = [0.05, 0.15, 0.3, 0.6, 1.0]
XGB_BASE = {"tree_method": "hist", "max_depth": 6, "eta": 0.08, "subsample": 0.8,
            "colsample_bytree": 0.8, "min_child_weight": 5, "nthread": 8, "seed": SEED}

# Per-episode constant nuisance offsets (uniform ranges), applied to raw sensors
NUISANCE = {
    "gen_voltage": (-0.8, 0.3), "gen_current": (-5.0, 5.0), "cht_common": (-3.0, 12.0),
    "egt_common": (-10.0, 15.0), "oil_temp": (-3.0, 5.0), "oil_pressure": (-0.2, 0.1),
    "coolant_temp": (-3.0, 5.0), "vibration": (-0.02, 0.08), "map_bar": (-0.03, 0.03),
    "lambda": (-0.02, 0.02),
}
from ai_health_rul.config.config import SCALAR_CHANNELS as SCALAR  # noqa: E402
# dataset CSV column for each canonical channel (unit suffixes in the CSV)
CSV_COL = {"inj_pw": "inj_pw_ms", "fuel_trim": "fuel_trim_pct", "battery_current": "battery_current_a",
           "battery_soc": "battery_soc_pct", "ambient_pressure": "ambient_pressure_bar", "oat": "oat_c"}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------------------
# 1. Features: run every episode through the SAME guard + extractor as the service
# ---------------------------------------------------------------------------
def build_features(df: pd.DataFrame, aug: dict):
    """aug: episode id -> nuisance offsets (episodes not in aug stay clean)."""
    X = np.zeros((len(df), len(FEATURE_NAMES)), dtype=np.float32)
    twin_err = []
    vals = df[[CSV_COL.get(c, c) for c in SCALAR]].to_numpy()
    egts = df[["egt1", "egt2", "egt3", "egt4"]].to_numpy()
    chts = df[["cht1", "cht2", "cht3", "cht4"]].to_numpy()
    dts = df["dt_s"].to_numpy()
    eps = df["episode"].to_numpy()
    twin_js = df[["twin_egt", "twin_cht", "twin_oil_temp"]].to_numpy()
    starts = np.r_[0, np.flatnonzero(np.diff(eps)) + 1]
    ends = np.r_[starts[1:], len(df)]
    for n, (a, b) in enumerate(zip(starts, ends)):
        off = aug.get(int(eps[a]))
        guard, fx = DataQualityGuard(), FeatureExtractor()
        for i in range(a, b):
            raw = dict(zip(SCALAR, vals[i]))
            raw["egt"] = list(egts[i])
            raw["cht"] = list(chts[i])
            if off:
                for k in SCALAR:
                    raw[k] += off.get(k, 0.0)
                raw["egt"] = [v + off["egt_common"] for v in raw["egt"]]
                raw["cht"] = [v + off["cht_common"] for v in raw["cht"]]
            clean = guard.validate_and_clean_frame(raw, dt=float(dts[i]))["cleaned_frame"]
            X[i], ctx = fx.update(clean, float(dts[i]))
            if not off:
                nom = ctx["nominal"]
                twin_err.append(np.abs(np.array([nom["egt"], nom["cht"], nom["oil_temp"]]) - twin_js[i]))
        if n % 500 == 0:
            log(f"  features: episode {n}/{len(starts)}")
    return X, (np.max(np.array(twin_err), axis=0) if twin_err else np.zeros(3))


def split_episodes(df: pd.DataFrame, rng):
    """Episode-level split stratified by fault class: 70 / 15 / 15."""
    ep = df.groupby("episode")["fault_class"].first()
    split = {}
    for _, eps in ep.groupby(ep):
        ids = rng.permutation(eps.index.to_numpy())
        n_tr, n_va = int(0.7 * len(ids)), int(0.15 * len(ids))
        for i in ids[:n_tr]:
            split[i] = "train"
        for i in ids[n_tr:n_tr + n_va]:
            split[i] = "val"
        for i in ids[n_tr + n_va:]:
            split[i] = "test"
    return df["episode"].map(split).to_numpy()


def balanced_weights(y):
    counts = np.bincount(y, minlength=len(FAULT_CLASSES)).astype(float)
    w = counts.sum() / (len(FAULT_CLASSES) * np.maximum(counts, 1))
    return w[y]


def sev_mask(sev, lo, hi):
    return (sev >= lo) & (sev < hi + (1e-9 if hi == 1.0 else 0))


# ---------------------------------------------------------------------------
# 2. Evaluation of one subset of test samples (clean or augmented)
# ---------------------------------------------------------------------------
def evaluate(M, df, y, sev, eng_sev, rul, s_all, raw_flag, anom, probs, sev_hat, rq_all, ae_mse, ae_thr):
    yt, st, prof = y[M], sev[M], df.loc[M, "profile"].to_numpy()
    nom = yt == 0
    # Same decision chain as the live service (decide -> persistence -> latch), within each episode
    final = live_decisions(M, df, probs, anom)
    dec = np.array([FAULT_CLASSES.index(d) if d in FAULT_CLASSES else 99 for d in final])
    flagged = dec != 0
    a_m = anom[M]

    p_a, r_a, f_a, _ = precision_recall_fscore_support(~nom, a_m, average="binary", zero_division=0)
    anomaly = {
        "precision": round(float(p_a), 4), "recall": round(float(r_a), 4), "f1": round(float(f_a), 4),
        "roc_auc": round(float(roc_auc_score(~nom, s_all[M])), 4),
        "nominal_false_alarm_rate": round(float(a_m[nom].mean()), 5),
        "raw_single_sample_recall": round(float(raw_flag[M][~nom].mean()), 4),
        "raw_single_sample_false_alarm_rate": round(float(raw_flag[M][nom].mean()), 5),
        "note": "Fitted on nominal data only, so per-class recall is the unknown-fault detection rate. 2-sample persistence applied.",
        "recall_by_class": {FAULT_CLASSES[c]: round(float(a_m[yt == c].mean()), 4) for c in range(1, len(FAULT_CLASSES))},
        "recall_by_severity": {},
    }
    p_d, r_d, f_d, _ = precision_recall_fscore_support(~nom, flagged, average="binary", zero_division=0)
    detection = {
        "precision": round(float(p_d), 4), "recall": round(float(r_d), 4), "f1": round(float(f_d), 4),
        "nominal_false_alarm_rate": round(float(flagged[nom].mean()), 5),
        "false_alarms_per_hour_at_1hz": round(float(flagged[nom].mean() * 3600), 2),
        "nominal_false_alarm_rate_by_profile": {k: round(float(flagged[nom & (prof == k)].mean()), 5) for k in np.unique(prof)},
        "recall_by_severity": {},
    }
    labels = list(range(len(FAULT_CLASSES)))
    report = classification_report(yt, dec, labels=labels, target_names=FAULT_CLASSES, output_dict=True, zero_division=0)
    classifier = {
        "macro_f1": round(float(report["macro avg"]["f1-score"]), 4),
        "weighted_f1": round(float(report["weighted avg"]["f1-score"]), 4),
        "per_class": {c: {k: round(float(report[c][k]), 4) for k in ("precision", "recall", "f1-score", "support")} for c in FAULT_CLASSES},
        "accuracy_by_severity": {},
        "confusion_matrix": {"labels": FAULT_CLASSES + [UNCLASSIFIED],
                             "matrix": confusion_matrix(yt, dec, labels=labels + [99]).tolist()},
    }
    for lo, hi in zip(SEV_BINS[:-1], SEV_BINS[1:]):
        m = ~nom & sev_mask(st, lo, hi)
        key = f"{lo:.2f}-{hi:.2f}"
        anomaly["recall_by_severity"][key] = round(float(a_m[m].mean()), 4)
        detection["recall_by_severity"][key] = round(float(flagged[m].mean()), 4)
        classifier["accuracy_by_severity"][key] = round(float((dec[m] == yt[m]).mean()), 4)

    lat = []
    g_df = df.loc[M, ["episode", "t_s", "label", "fault_class"]].assign(flag=flagged)
    for _, g in g_df[g_df["fault_class"] != "NONE"].groupby("episode"):
        if (g["label"] == "NONE").any():
            onset = g.loc[g["label"] != "NONE", "t_s"].min()
            hits = g[(g["t_s"] >= onset) & g["flag"]]
            if len(hits):
                lat.append(hits["t_s"].min() - onset)
    detection["median_detection_latency_s"] = round(float(np.median(lat)), 2) if lat else None
    detection["p90_detection_latency_s"] = round(float(np.quantile(lat, 0.9)), 2) if lat else None

    # Health target is ENGINE severity (0 for sensor drift: the engine is healthy)
    sh, es = sev_hat[M], eng_sev[M]
    drift = yt == FAULT_CLASSES.index("SENSOR_DRIFT")
    health = {
        "health_index_mae_pct": round(float(np.mean(np.abs(sh - es)) * 100), 2),
        "health_index_mae_pct_faults_only": round(float(np.mean(np.abs(sh[~nom] - es[~nom])) * 100), 2),
        "health_index_mean_during_sensor_drift": round(float(100 * (1 - sh[drift].mean())), 2) if drift.any() else None,
    }

    F = M & np.isfinite(rul)  # engine-degradation faults only (sensor drift has no RUL)
    rt, q = rul[F], rq_all[F]
    err = np.abs(q[:, 1] - rt)
    cls = df.loc[F, "fault_class"].to_numpy()
    rul_m = {
        "target": "hours to functional failure (severity = 1) under assumed degradation priors",
        "mae_hours": round(float(err.mean()), 2),
        "median_abs_error_hours": round(float(np.median(err)), 2),
        "median_abs_pct_error": round(float(np.median(err / rt) * 100), 1),
        "interval_95_coverage": round(float(np.mean((rt >= q[:, 0]) & (rt <= q[:, 2]))), 4),
        "mae_hours_by_class": {c: round(float(err[cls == c].mean()), 2) for c in FAULT_CLASSES[1:] if (cls == c).any()},
    }
    # Flight-condition breakdown: does the twin + AI hold across altitude and outside-air temperature?
    alt, isa = df.loc[M, "altitude_ft"].to_numpy(), (df.loc[M, "oat_c"] - (15 - 0.0019812 * df.loc[M, "altitude_ft"])).to_numpy()
    sh_all = sev_hat[M]
    def cond_metrics(sel):
        f, n_ = sel & ~nom, sel & nom
        return {"samples": int(sel.sum()),
                "fault_detection_recall": round(float(flagged[f].mean()), 4) if f.any() else None,
                "classifier_accuracy_on_faults": round(float((dec[f] == yt[f]).mean()), 4) if f.any() else None,
                "nominal_false_alarms_per_hour": round(float(flagged[n_].mean() * 3600), 2) if n_.any() else None,
                "health_mae_pct": round(float(np.mean(np.abs(sh_all[sel] - eng_sev[M][sel])) * 100), 2)}
    flight_condition = {
        "by_altitude_ft": {f"{lo}-{hi}": cond_metrics((alt >= lo) & (alt < hi))
                           for lo, hi in ((0, 5000), (5000, 10000), (10000, 15000), (15000, 20000), (20000, 23001))},
        "by_isa_deviation_c": {f"{lo:+d}..{hi:+d}": cond_metrics((isa >= lo) & (isa < hi))
                               for lo, hi in ((-21, -5), (-5, 5), (5, 15), (15, 26))},
    }
    ae_flag = ae_mse[M] > ae_thr
    ae = {
        "threshold_mse": round(ae_thr, 6),
        "inputs": "RPM, throttle, EGT1-4, CHT1-4, MAP, oil pressure (no vibration/voltage/oil temp)",
        "nominal_false_alarm_rate": round(float(ae_flag[nom].mean()), 5),
        "recall": round(float(ae_flag[~nom].mean()), 4),
        "recall_by_class": {FAULT_CLASSES[c]: round(float(ae_flag[yt == c].mean()), 4) for c in range(1, len(FAULT_CLASSES))},
    }
    return {"anomaly_detector": anomaly, "detection_end_to_end": detection, "fault_classifier": classifier,
            "health_index": health, "rul": rul_m, "flight_condition": flight_condition,
            "autoencoder_legacy_endpoint": ae}


def live_decisions(idx_mask, df, probs, anom):
    """decide -> 2-sample persistence -> latch, per episode, exactly as the live service."""
    idx = np.flatnonzero(idx_mask)
    eps = df["episode"].to_numpy()
    out = np.empty(len(idx), dtype=object)
    prev_raw, last_known, since = "NONE", "NONE", 10 ** 6
    for k, i in enumerate(idx):
        if k == 0 or eps[i] != eps[idx[k - 1]]:
            prev_raw, last_known, since = "NONE", "NONE", 10 ** 6
        raw = decide(probs[i], anom[i])[0]
        d = persist(raw, prev_raw)
        d, last_known, since = latch(d, last_known, since, ROLLING_WINDOW)
        prev_raw = raw
        out[k] = d
    return out


def recovery_metrics(M, df, probs, anom):
    """After a fault is cleared: seconds until the reported diagnosis returns to NONE and stays there."""
    eps, t, phase = df["episode"].to_numpy(), df["t_s"].to_numpy(), df["phase"].to_numpy()
    times, wrong = [], 0
    n_rec = 0
    for e in np.unique(eps[M & (phase == "recovery")]):
        idx = np.flatnonzero((eps == e) & M)
        final = live_decisions((eps == e) & M, df, probs, anom)
        rec = [k for k, i in enumerate(idx) if phase[i] == "recovery"]
        clear_t = t[idx[rec[0]]]
        last_bad = max([k for k in rec if final[k] != "NONE"], default=None)
        times.append(0.0 if last_bad is None else t[idx[last_bad]] - clear_t + 1.0)
        wrong += sum(final[k] != "NONE" for k in rec)
        n_rec += len(rec)
    return {"note": "recovery samples are evaluation-only (not used for training)",
            "episodes": len(times),
            "median_seconds_to_nominal": round(float(np.median(times)), 2) if times else None,
            "p90_seconds_to_nominal": round(float(np.quantile(times, 0.9)), 2) if times else None,
            "non_nominal_fraction_during_recovery": round(wrong / max(1, n_rec), 4)}


# ---------------------------------------------------------------------------
def main():
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    log(f"Loading {DATA}")
    df = pd.read_csv(DATA, low_memory=False)
    df["label_idx"] = df["label"].map({c: i for i, c in enumerate(FAULT_CLASSES)}).astype(int)
    log(f"{len(df):,} samples, {df['episode'].nunique():,} episodes")

    part = split_episodes(df, rng)
    tr, va, te = part == "train", part == "val", part == "test"

    # Stress test only: nuisance offsets applied to a copy of the TEST episodes
    aug_rng = np.random.default_rng(SEED + 1)
    aug = {int(e): {k: float(aug_rng.uniform(*r)) for k, r in NUISANCE.items()}
           for e in sorted(df.loc[te, "episode"].unique())}

    cache = DATA.with_suffix(".features.npz")
    z = None
    if cache.exists() and cache.stat().st_mtime > DATA.stat().st_mtime and "--rebuild" not in sys.argv:
        z = np.load(cache)
    if z is not None and "X_stress" in z.files and len(z["X_stress"]) == int(te.sum()):
        log(f"Loading cached features {cache.name}")
        X, X_stress, twin_parity = z["X"], z["X_stress"], z["twin_parity"]
    else:
        log("Building physics-residual features (guard + golden twin + rolling window)")
        X, twin_parity = build_features(df, {})
        log("Building stress-test features (nuisance offsets on test episodes)")
        X_stress, _ = build_features(df.loc[te], aug)
        np.savez_compressed(cache, X=X, X_stress=X_stress, twin_parity=twin_parity)
    log(f"Golden-twin JS/Python max abs diff [egt, cht, oil_temp]: {twin_parity.round(4).tolist()}")
    y = df["label_idx"].to_numpy()
    sev = df["severity"].to_numpy(dtype=float)              # fault severity (reporting / bins)
    eng_sev = df["engine_severity"].to_numpy(dtype=float)   # engine degradation (health target)
    rul = df["rul_h"].to_numpy(dtype=float)
    is_nom = y == 0
    # Recovery samples (fault just cleared) are EVALUATION-ONLY: training on them tripled missed
    # low-severity faults (a just-cleared fault and a weak fault look alike sample-by-sample).
    recovering = (df["phase"] == "recovery").to_numpy()
    tr, va = tr & ~recovering, va & ~recovering
    eps = df["episode"].to_numpy()
    all_rows = xgb.DMatrix(X, feature_names=FEATURE_NAMES)
    log(f"Split (episodes): train {df.loc[tr, 'episode'].nunique()}, val {df.loc[va, 'episode'].nunique()}, test {df.loc[te, 'episode'].nunique()}")

    # ---- Anomaly detector: Mahalanobis distance on nominal residuals only ----
    # (IsolationForest was evaluated first: 16 % recall, near zero on 5/7 fault classes,
    #  because it cannot separate points outside the nominal training range.)
    log("Fitting Mahalanobis (Ledoit-Wolf) residual anomaly detector on nominal samples only")
    fit = tr & is_nom & ~recovering  # the detector models genuinely healthy operation only
    mu_x, sd_x = X[fit].mean(axis=0), X[fit].std(axis=0) + 1e-9
    lw = LedoitWolf().fit((X[fit] - mu_x) / sd_x)

    def score(Z):
        d = (Z - mu_x) / sd_x - lw.location_
        return np.sqrt(np.einsum("ij,jk,ik->i", d, lw.precision_, d))

    s_val_nom = score(X[va & is_nom & ~recovering])
    thr = float(np.quantile(s_val_nom, 0.999))      # 0.1 % per-sample false-alarm target
    p50 = float(np.median(s_val_nom))
    s_all = score(X)
    raw_flag = s_all > thr
    # 2-sample persistence (same rule as the live service)
    anom = raw_flag & np.r_[False, raw_flag[:-1]] & np.r_[False, eps[1:] == eps[:-1]]

    # ---- Fault classifier ----
    log("Training XGBoost fault classifier")
    clf = xgb.train({**XGB_BASE, "objective": "multi:softprob", "num_class": len(FAULT_CLASSES), "eval_metric": "mlogloss"},
                    xgb.DMatrix(X[tr], label=y[tr], weight=balanced_weights(y[tr]), feature_names=FEATURE_NAMES), 800,
                    evals=[(xgb.DMatrix(X[va], label=y[va], weight=balanced_weights(y[va]), feature_names=FEATURE_NAMES), "val")],
                    early_stopping_rounds=40, verbose_eval=False)
    probs = clf.predict(all_rows, iteration_range=(0, clf.best_iteration + 1))

    # ---- Severity regressor (health index = 100 * (1 - severity)) ----
    log("Training XGBoost severity regressor")
    sreg = xgb.train({**XGB_BASE, "eta": 0.25, "objective": "reg:squarederror", "eval_metric": "mae"},
                     xgb.DMatrix(X[tr], label=eng_sev[tr], feature_names=FEATURE_NAMES), 600,
                     evals=[(xgb.DMatrix(X[va], label=eng_sev[va], feature_names=FEATURE_NAMES), "val")],
                     early_stopping_rounds=40, verbose_eval=False)
    sev_hat = np.clip(sreg.predict(all_rows, iteration_range=(0, sreg.best_iteration + 1)), 0, 1)

    # ---- RUL quantile regressor (fault samples only, log-hours) + conformal calibration ----
    log("Training XGBoost RUL quantile regressor (2.5 / 50 / 97.5 %)")
    has_rul = np.isfinite(rul)
    f_tr, f_va = tr & has_rul, va & has_rul
    rreg = xgb.train({**XGB_BASE, "objective": "reg:quantileerror", "quantile_alpha": RUL_QUANTILES},
                     xgb.DMatrix(X[f_tr], label=np.log(rul[f_tr]), feature_names=FEATURE_NAMES), 800,
                     evals=[(xgb.DMatrix(X[f_va], label=np.log(rul[f_va]), feature_names=FEATURE_NAMES), "val")],
                     early_stopping_rounds=40, verbose_eval=False)
    q_all = np.sort(rreg.predict(all_rows, iteration_range=(0, rreg.best_iteration + 1)), axis=1)
    nonconf = np.maximum(q_all[f_va, 0] - np.log(rul[f_va]), np.log(rul[f_va]) - q_all[f_va, 2])
    cqr_margin = float(np.quantile(nonconf, 0.95 * (1 + 1 / len(nonconf))))
    q_all[:, 0] -= cqr_margin
    q_all[:, 2] += cqr_margin
    rq_all = np.exp(q_all)

    # ---- Autoencoder for legacy single-frame endpoint (clean nominal frames) ----
    log("Training PyTorch autoencoder on nominal single frames")
    raw_cols = ["rpm", "throttle", "egt1", "egt2", "egt3", "egt4", "cht1", "cht2", "cht3", "cht4", "map_bar", "oil_pressure"]
    R = normalise(df[raw_cols].to_numpy())
    torch.manual_seed(SEED)
    ae = EngineAnomalyAutoencoder()
    opt = torch.optim.Adam(ae.parameters(), lr=1e-3)
    Rtr = torch.tensor(R[tr & is_nom])
    for _ in range(40):
        ae.train()
        perm = torch.randperm(len(Rtr))
        for i in range(0, len(Rtr), 512):
            xb = Rtr[perm[i:i + 512]]
            loss = torch.mean((ae(xb)[0] - xb) ** 2)
            opt.zero_grad()
            loss.backward()
            opt.step()
    ae.eval()
    with torch.no_grad():
        Rt = torch.tensor(R)
        ae_mse = torch.mean((ae(Rt)[0] - Rt) ** 2, dim=1).numpy()
    ae_thr = float(np.quantile(ae_mse[va & is_nom], 0.999))

    # ---- Evaluation on held-out test episodes ----
    log("Evaluating on held-out test episodes")
    rec_metrics = recovery_metrics(te, df, probs, anom)
    metrics = evaluate(te & ~recovering, df, y, sev, eng_sev, rul, s_all, raw_flag, anom, probs, sev_hat, rq_all, ae_mse, ae_thr)

    log("Stress test: same test episodes with per-episode nuisance offsets")
    Xs = X.copy()
    Xs[te] = X_stress
    s_s = score(Xs)
    raw_s = s_s > thr
    anom_s = raw_s & np.r_[False, raw_s[:-1]] & np.r_[False, eps[1:] == eps[:-1]]
    dms = xgb.DMatrix(Xs, feature_names=FEATURE_NAMES)
    probs_s = clf.predict(dms, iteration_range=(0, clf.best_iteration + 1))
    sev_s = np.clip(sreg.predict(dms, iteration_range=(0, sreg.best_iteration + 1)), 0, 1)
    q_s = np.sort(rreg.predict(dms, iteration_range=(0, rreg.best_iteration + 1)), axis=1)
    q_s[:, 0] -= cqr_margin
    q_s[:, 2] += cqr_margin
    stress = evaluate(te & ~recovering, df, y, sev, eng_sev, rul, s_s, raw_s, anom_s, probs_s, sev_s, np.exp(q_s), ae_mse, ae_thr)
    stress.pop("autoencoder_legacy_endpoint")
    stress["description"] = ("Test episodes re-scored after adding constant per-episode offsets "
                             f"(ranges: {NUISANCE}) that the simulator never produces, e.g. bus-voltage sag and "
                             "common-mode CHT/EGT shifts. Quantifies sensitivity to uncalibrated sensors; a deployed "
                             "twin needs per-engine baseline calibration.")
    lo_q, hi_q = np.quantile(X[tr], 0.0005, axis=0), np.quantile(X[tr], 0.9995, axis=0)

    # ---- Save ----
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    np.savez(MODEL_DIR / ANOMALY_DETECTOR_FILE, feature_mean=mu_x, feature_std=sd_x,
             location=lw.location_, precision=lw.precision_)
    for booster, fname in ((clf, FAULT_CLASSIFIER_FILE), (sreg, SEVERITY_REGRESSOR_FILE), (rreg, RUL_REGRESSOR_FILE)):
        booster[: booster.best_iteration + 1].save_model(str(MODEL_DIR / fname))
    torch.save(ae.state_dict(), MODEL_DIR / AUTOENCODER_FILE)

    import sklearn
    card = {
        "version": "2.0.0",
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "training_data": {
            "source": "training/generate_dataset.mjs driving src/engine/EngineSimulator.js (same physics as the live gateway)",
            "samples": int(len(df)), "episodes": int(df["episode"].nunique()),
            "split": "by episode, stratified by fault class: 70/15/15 train/val/test",
            "profiles": sorted(df["profile"].unique().tolist()),
            "note": "Synthetic simulator data. Degradation-life priors are engineering assumptions. "
                    "Metrics describe performance on this simulator, not on a real engine.",
        },
        "leakage_controls": [
            "No health score or fault label used as input; features are golden-twin physics residuals",
            "Episode-level train/val/test split",
            "Anomaly threshold calibrated on validation episodes; metrics on untouched test episodes",
            "Per-UAV inference sessions (no shared state between vehicles or clients)",
        ],
        "features": FEATURE_NAMES,
        "rolling_window_samples": ROLLING_WINDOW,
        "classes": FAULT_CLASSES,
        "best_iterations": {"classifier": clf.best_iteration, "severity": sreg.best_iteration, "rul": rreg.best_iteration},
        "anomaly_calibration": {"method": "Mahalanobis distance, Ledoit-Wolf covariance", "threshold": thr,
                                "nominal_median": p50, "target_false_alarm_rate": 0.001, "persistence_samples": 2},
        "rul_quantiles": RUL_QUANTILES.tolist(),
        "rul_conformal_log_margin": cqr_margin,
        "feature_ranges": {"low": lo_q.tolist(), "high": hi_q.tolist()},
        "golden_twin_parity_max_abs_diff": twin_parity.tolist(),
        "metrics": metrics,
        "recovery_after_fault_cleared": rec_metrics,
        "stress_test_nuisance_offsets": stress,
        "library_versions": {"xgboost": xgb.__version__, "scikit-learn": sklearn.__version__, "torch": torch.__version__},
    }
    with open(MODEL_DIR / MODEL_CARD_FILE, "w") as f:
        json.dump(card, f, indent=2)
    log(f"Done in {time.time() - t0:.0f} s. Metrics written to {MODEL_DIR / MODEL_CARD_FILE}")


if __name__ == "__main__":
    main()
