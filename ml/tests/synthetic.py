"""SYNTHETIC price generators — for unit tests of pipeline MECHANICS only.

Nothing generated here is ever written to the cache, the registry or Supabase, and no metric computed on it is
ever reported as model performance. `signal=0` produces pure noise (a correct pipeline must then refuse to
promote a model); `signal>0` plants a weak, learnable trailing-momentum effect.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _walk(rng, n, mkt_ret, vsig, signal, vol):
    """signal: weak trailing-momentum drift (the rule score can already see this).
    vsig: drift driven by volume_ratio_20_60 (a feature the existing rule rubric does NOT use)."""
    r = np.zeros(n)
    px = np.ones(n)
    for t in range(1, n):
        drift = 0.0
        if signal and t > 63:
            tr = px[t - 1] / px[t - 64] - 1
            drift = signal * np.tanh(tr / 0.15) / 100.0
        if vsig is not None:
            drift += vsig[t - 1]
        r[t] = mkt_ret[t] + drift + rng.normal(0, vol)
        px[t] = px[t - 1] * (1 + max(r[t], -0.4))
    return px


def make_universe(n_per_market: int = 20, n_days: int = 3000, seed: int = 0, signal: float = 0.0, volume_signal: float = 0.0, start: str = "2010-01-04") -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(start, periods=n_days)
    out: dict[str, pd.DataFrame] = {}
    for mk, suffix, bench in (("IN", ".NS", "^NSEI"), ("US", "", "^GSPC")):
        mkt = rng.normal(0.0003, 0.009, n_days)
        mkt[0] = 0
        bpx = 100 * np.cumprod(1 + mkt)
        out[bench] = pd.DataFrame({"date": dates, "adj_close": bpx, "volume": 0.0})
        for i in range(n_per_market):
            beta = rng.uniform(0.6, 1.4)
            lv = np.zeros(n_days)
            for t in range(1, n_days):
                lv[t] = 0.99 * lv[t - 1] + rng.normal(0, 0.12)
            vol = 1e6 * np.exp(lv)
            vs = pd.Series(vol)
            ratio = (vs.rolling(20, min_periods=1).mean() / vs.rolling(60, min_periods=1).mean()).to_numpy()
            vsig = volume_signal * np.clip(ratio - 1, -0.5, 0.5) if volume_signal else None
            px = _walk(rng, n_days, beta * mkt, vsig, signal, rng.uniform(0.008, 0.02)) * rng.uniform(20, 2000)
            out[f"SYN{mk}{i}{suffix}"] = pd.DataFrame({"date": dates, "adj_close": px, "volume": vol})
    return out
