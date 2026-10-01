"""
Diagnosis decision rule shared by training evaluation and live inference,
so the reported metrics describe exactly what the service does.
"""

from typing import Dict, Tuple

from ..config.config import FAULT_CLASSES, FAULT_PROB_THRESHOLD, MEL_THRESHOLD_SCORE, SENSOR_FAULT_CLASSES

UNCLASSIFIED = "UNCLASSIFIED_ANOMALY"


def decide(probs, anomaly_flag: bool) -> Tuple[str, float]:
    """
    probs: classifier posteriors ordered as FAULT_CLASSES.
    Returns (diagnosis, confidence).
      - a known fault class when its posterior >= FAULT_PROB_THRESHOLD
      - UNCLASSIFIED_ANOMALY when the unsupervised detector fires but no class is confident
        (covers fault modes that were never in the training data)
      - NONE otherwise
    """
    idx = int(max(range(len(probs)), key=lambda i: probs[i]))
    label, p = FAULT_CLASSES[idx], float(probs[idx])
    if label != "NONE" and p >= FAULT_PROB_THRESHOLD:
        return label, p
    if anomaly_flag:
        return UNCLASSIFIED, 1.0 - float(probs[0])
    return "NONE", float(probs[0])


def persist(diagnosis: str, previous_raw: str) -> str:
    """
    2-sample persistence: a fault is reported only when the same raw diagnosis was made on the
    previous sample too. Measured on held-out episodes: false alarms 5.5/h -> 0.23/h, for ~1.2 s
    extra detection latency.
    """
    if previous_raw is None:  # one-shot (single-frame) assessment: persistence does not apply
        return diagnosis
    return diagnosis if diagnosis == "NONE" or diagnosis == previous_raw else "NONE"


def latch(diagnosis: str, last_known: str, samples_since_known: int, window: int) -> Tuple[str, str, int]:
    """
    Hysteresis after a known fault: while the rolling window may still hold samples from that fault
    (fewer than `window` samples since it was last reported), an UNCLASSIFIED_ANOMALY is attributed to
    it instead of flickering to "unknown". Returns (reported diagnosis, last_known, samples_since_known).
    """
    if diagnosis in FAULT_CLASSES and diagnosis != "NONE":
        return diagnosis, diagnosis, 0
    samples_since_known += 1
    if diagnosis == UNCLASSIFIED and last_known != "NONE" and samples_since_known <= window:
        return last_known, last_known, samples_since_known
    return diagnosis, last_known, samples_since_known


def severity_level(diagnosis: str, health_index: float) -> str:
    if diagnosis == "NONE":
        return "NOMINAL"
    if diagnosis in SENSOR_FAULT_CLASSES:
        return "ELEVATED"  # instrumentation needs attention; engine health is unaffected
    return "CRITICAL" if health_index < MEL_THRESHOLD_SCORE else "ELEVATED"
