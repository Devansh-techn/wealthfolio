"""Evaluation metrics: statistical AND financially meaningful, never training accuracy."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import brier_score_loss, f1_score, log_loss, mean_absolute_error, precision_score, recall_score, roc_auc_score


def calibration_table(y, p, bins: int = 10) -> tuple[list[dict], float]:
    y, p = np.asarray(y, float), np.asarray(p, float)
    if len(y) == 0:
        return [], float("nan")
    q = pd.qcut(p, q=min(bins, max(2, len(np.unique(p)))), duplicates="drop")
    rows, ece = [], 0.0
    for _, g in pd.DataFrame({"y": y, "p": p, "q": q}).groupby("q", observed=True):
        rows.append({"mean_pred": float(g.p.mean()), "observed": float(g.y.mean()), "n": int(len(g))})
        ece += len(g) / len(y) * abs(g.p.mean() - g.y.mean())
    return rows, float(ece)


def rank_ic(df: pd.DataFrame, pred, target: str, min_names: int = 10) -> dict:
    """Mean cross-sectional Spearman correlation between the signal and the realised target, per date."""
    t = pd.DataFrame({"g": df["grid_date"].to_numpy(), "p": np.asarray(pred, float), "y": df[target].to_numpy(float)}).dropna()
    ics = []
    for _, g in t.groupby("g"):
        if len(g) >= min_names and g.p.nunique() > 1 and g.y.nunique() > 1:
            ics.append(spearmanr(g.p, g.y)[0])
    if not ics:
        return {"mean": float("nan"), "std": float("nan"), "ir": float("nan"), "pos_frac": float("nan"), "n_dates": 0}
    a = np.array(ics)
    return {"mean": float(a.mean()), "std": float(a.std(ddof=1)) if len(a) > 1 else 0.0,
            "ir": float(a.mean() / a.std(ddof=1)) if len(a) > 1 and a.std(ddof=1) > 0 else float("nan"),
            "pos_frac": float((a > 0).mean()), "n_dates": int(len(a))}


def clf_metrics(df: pd.DataFrame, y_col: str, ret_col: str, p, base_rate: float) -> dict:
    y = df[y_col].to_numpy(float)
    p = np.asarray(p, float)
    m: dict = {"n": int(len(y)), "base_rate": float(np.mean(y)) if len(y) else float("nan")}
    if len(y) == 0:
        return m
    m["roc_auc"] = float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else float("nan")
    m["brier"] = float(brier_score_loss(y, p))
    m["brier_base_rate"] = float(brier_score_loss(y, np.full(len(y), base_rate)))
    m["log_loss"] = float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1]))
    for tag, thr in (("t50", 0.5), ("tbase", base_rate)):
        yh = (p >= thr).astype(int)
        m[f"precision_{tag}"] = float(precision_score(y, yh, zero_division=0))
        m[f"recall_{tag}"] = float(recall_score(y, yh, zero_division=0))
        m[f"f1_{tag}"] = float(f1_score(y, yh, zero_division=0))
        m[f"directional_accuracy_{tag}"] = float((yh == y).mean())
    cal, ece = calibration_table(y, p)
    m["calibration"], m["ece"] = cal, ece
    k = max(1, int(0.2 * len(p)))
    order = np.argsort(-p)
    top, bot = order[:k], order[-k:]
    r = df[ret_col].to_numpy(float)
    m["hit_rate_top20"] = float(y[top].mean())
    m["lift_top20"] = float(y[top].mean() - y.mean())
    m["mean_ret_top20"] = float(np.nanmean(r[top]))
    m["mean_ret_bottom20"] = float(np.nanmean(r[bot]))
    m["rank_ic"] = rank_ic(df, p, ret_col)
    return m


def reg_metrics(df: pd.DataFrame, y_col: str, pred, train_mean: float) -> dict:
    y = df[y_col].to_numpy(float)
    p = np.asarray(pred, float)
    if len(y) == 0:
        return {"n": 0}
    sse = float(((y - p) ** 2).sum())
    sst_mean = float(((y - train_mean) ** 2).sum())
    sst = float(((y - y.mean()) ** 2).sum())
    return {
        "n": int(len(y)), "mae": float(mean_absolute_error(y, p)), "rmse": float(np.sqrt(sse / len(y))),
        "r2": float(1 - sse / sst) if sst > 0 else float("nan"),
        "r2_vs_train_mean": float(1 - sse / sst_mean) if sst_mean > 0 else float("nan"),   # out-of-sample skill vs "always predict the train mean"
        "directional_accuracy": float((np.sign(p) == np.sign(y)).mean()),
        "rank_ic": rank_ic(df, p, y_col),
    }


def by_group(df: pd.DataFrame, group: str, fn) -> dict:
    out = {}
    for k, g in df.groupby(group):
        if len(g) >= 50:
            out[str(k)] = fn(g)
    return out


def by_year(df: pd.DataFrame, fn) -> dict:
    return {str(y): fn(g) for y, g in df.groupby(df["date"].dt.year) if len(g) >= 50}
