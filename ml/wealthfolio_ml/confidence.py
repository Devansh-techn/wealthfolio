"""Prediction confidence. Deliberately NOT just the model probability.

Components (weights in config.CONFIDENCE_WEIGHTS):
  data_completeness   share of non-null features for this stock today
  history_depth       how many price rows this stock has (1.0 at >= 2 years)
  training_size       how many labelled rows the model was trained on (1.0 at >= 50k)
  model_quality       held-out evidence: AUC edge over 0.5 and calibration error from the TEST split
  model_agreement     do independent model families (logistic / forest / boosting) agree on this stock?
  in_distribution     are today's feature values inside the range the model was trained on?
  prediction_stability does the estimate stay put when recomputed on the previous 1-2 weeks of data?
Hard caps: very incomplete data or <1y of history => "low"; out-of-distribution inputs => at most "medium".
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import CONFIDENCE_THRESHOLDS, CONFIDENCE_WEIGHTS, FEATURES


def training_stats(train: pd.DataFrame) -> dict:
    s = {}
    for f in FEATURES:
        v = train[f].dropna()
        if len(v) < 50:
            s[f] = None
            continue
        q01, q50, q99 = np.quantile(v, [0.01, 0.5, 0.99])
        s[f] = {"q01": float(q01), "median": float(q50), "q99": float(q99)}
    return s


def in_distribution(row: pd.Series, stats: dict, margin: float = 0.10) -> float:
    ok = n = 0
    for f in FEATURES:
        st, v = stats.get(f), row.get(f)
        if st is None or v is None or pd.isna(v):
            continue
        span = max(st["q99"] - st["q01"], 1e-9)
        n += 1
        ok += st["q01"] - margin * span <= v <= st["q99"] + margin * span
    return ok / n if n else 0.0


def model_quality(test_clf_metrics: dict | None) -> float:
    if not test_clf_metrics:
        return 0.0
    auc, ece = test_clf_metrics.get("roc_auc"), test_clf_metrics.get("ece")
    if auc is None or ece is None or np.isnan(auc) or np.isnan(ece):
        return 0.0
    return float(0.5 * np.clip((auc - 0.5) / 0.10, 0, 1) + 0.5 * np.clip(1 - ece / 0.10, 0, 1))


def agreement(probs: list[float]) -> float:
    if len(probs) < 2:
        return 0.5
    return float(1 - min(1.0, np.std(probs) / 0.15))


def stability(history_probs: list[float]) -> float:
    if len(history_probs) < 2:
        return 0.5
    return float(1 - min(1.0, np.std(history_probs) / 0.08))


def label_for(score: float) -> str:
    return "high" if score >= CONFIDENCE_THRESHOLDS["high"] else "medium" if score >= CONFIDENCE_THRESHOLDS["medium"] else "low"


def compute_confidence(comp: dict[str, float], completeness: float, n_obs: int) -> dict:
    score = float(sum(CONFIDENCE_WEIGHTS[k] * float(np.clip(comp[k], 0, 1)) for k in CONFIDENCE_WEIGHTS))
    label = label_for(score)
    caps = []
    if completeness < 0.70 or n_obs < 252:
        label = "low"
        caps.append("incomplete data or <1 year of history")
    elif comp["model_quality"] < 0.15:
        label = "low"
        caps.append("held-out evidence for the model is weak")
    else:
        if label == "high" and comp["in_distribution"] < 0.70:
            label = "medium"
            caps.append("inputs outside the training range")
        if label == "high" and comp["model_quality"] < 0.50:
            label = "medium"
            caps.append("held-out evidence is only moderate: confidence capped at medium")
    return {"score": round(score, 4), "label": label, "components": {k: round(float(v), 4) for k, v in comp.items()}, "caps": caps}
