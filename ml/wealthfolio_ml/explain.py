"""Model explainability. Reports which inputs were INFLUENTIAL for a given estimate (one-at-a-time occlusion:
how much does the probability move when this input is replaced by its training median?). This is a description
of the model, not of the market — it does not establish causality.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance

from .config import FEATURES

LABELS = {
    "rsi14": ("RSI (14)", "num0"), "dist_sma20": ("Price vs 20-day average", "pct"), "dist_sma50": ("Price vs 50-day average", "pct"),
    "dist_sma200": ("Price vs 200-day average", "pct"), "sma50_over_sma200": ("50-day vs 200-day average", "pct"),
    "golden_cross": ("50-day above 200-day average", "bool"), "macd_norm": ("MACD (price-normalised)", "pct"),
    "macd_hist_norm": ("MACD histogram (price-normalised)", "pct"), "dist_ema50": ("Price vs 50-day EMA", "pct"),
    "ret_1m": ("1-month return", "pct"), "ret_3m": ("3-month return", "pct"), "ret_6m": ("6-month return", "pct"),
    "ret_12m_ex1m": ("12-month return (ex last month)", "pct"), "mom_accel": ("Momentum acceleration", "pct"),
    "vol_21d": ("21-day volatility", "pct"), "vol_63d": ("63-day volatility", "pct"), "vol_252d": ("1-year volatility", "pct"),
    "downside_vol_63d": ("Downside volatility (63d)", "pct"), "max_dd_252d": ("1-year max drawdown", "pct"),
    "dd_from_high_252d": ("Distance below 52-week high", "pct"), "sharpe_126d": ("Sharpe-like ratio (6m)", "num2"),
    "beta_252d": ("Beta vs benchmark", "num2"), "range_pos_252d": ("Position in 52-week range", "pct"),
    "volume_ratio_20_60": ("Volume (20d vs 60d)", "num2"), "bench_ret_3m": ("Benchmark 3-month return", "pct"),
    "bench_ret_6m": ("Benchmark 6-month return", "pct"), "bench_dist_sma200": ("Benchmark vs its 200-day average", "pct"),
    "bench_vol_63d": ("Benchmark volatility (63d)", "pct"), "rel_strength_3m": ("3-month return vs benchmark", "pct"),
    "rel_strength_6m": ("6-month return vs benchmark", "pct"),
}


def fmt(feature: str, v: float) -> str:
    kind = LABELS.get(feature, (feature, "num2"))[1]
    if kind == "pct":
        return f"{v * 100:+.1f}%"
    if kind == "bool":
        return "yes" if v > 0.5 else "no"
    return f"{v:.0f}" if kind == "num0" else f"{v:.2f}"


def occlusion_factors(predict_proba, row: pd.Series, medians: dict, k: int = 3, min_effect: float = 0.002) -> dict:
    """predict_proba: callable(DataFrame)->P(positive). Returns top positive / negative influences."""
    base = row[FEATURES].astype(float)
    present = [f for f in FEATURES if pd.notna(base[f]) and medians.get(f) is not None]
    if not present:
        return {"positive": [], "negative": []}
    rows = [base.copy()]
    for f in present:
        r = base.copy()
        r[f] = medians[f]
        rows.append(r)
    X = pd.DataFrame(rows).reset_index(drop=True)
    p = np.asarray(predict_proba(X), float)
    delta = p[0] - p[1:]           # >0 : this input RAISED the estimate relative to a typical value
    items = [{"feature": f, "label": LABELS.get(f, (f,))[0], "value": float(base[f]), "value_text": fmt(f, float(base[f])), "influence": float(d)}
             for f, d in zip(present, delta)]
    pos = sorted([i for i in items if i["influence"] > min_effect], key=lambda i: -i["influence"])[:k]
    neg = sorted([i for i in items if i["influence"] < -min_effect], key=lambda i: i["influence"])[:k]
    return {"positive": pos, "negative": neg}


def global_importance(est, X: pd.DataFrame, y, seed: int = 42, repeats: int = 3, max_rows: int = 4000) -> dict:
    if len(X) > max_rows:
        idx = np.random.default_rng(seed).choice(len(X), max_rows, replace=False)
        X, y = X.iloc[idx], np.asarray(y)[idx]
    r = permutation_importance(est, X, y, scoring="roc_auc", n_repeats=repeats, random_state=seed)
    order = np.argsort(-r.importances_mean)
    cols = list(X.columns)
    return {cols[i]: round(float(r.importances_mean[i]), 5) for i in order if cols[i] in FEATURES}
