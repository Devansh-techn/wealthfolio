"""Market-regime labelling (evaluation segmentation + architecture hook).

Regimes are derived ONLY from benchmark features known at the observation date, so they are point-in-time.
v1 uses them to report performance per regime; the model is not trained per regime (not enough reliable
history to justify it yet). The labels are available as extra columns for future regime-specific models.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def assign_regimes(df: pd.DataFrame, vol_threshold: float | None = None, trend_band: float = 0.02) -> pd.DataFrame:
    out = df.copy()
    d = out["bench_dist_sma200"]
    out["regime_trend"] = np.where(d.isna(), "unknown", np.where(d > trend_band, "bull", np.where(d < -trend_band, "bear", "sideways")))
    v = out["bench_vol_63d"]
    thr = vol_threshold if vol_threshold is not None else float(v.median())
    out["regime_vol"] = np.where(v.isna(), "unknown", np.where(v > thr, "high_vol", "low_vol"))
    return out
