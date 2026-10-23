"""Forward-looking TARGETS. These are the only columns allowed to use future prices, and they are never
used as features. Row offsets are validated against calendar dates so a hole in the data can never be
silently read as "63 trading days later".
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import H3, H6, TRADING_DAYS

# Calendar-day plausibility window for a 63 / 126-row look-ahead (holidays + weekends).
GAP_OK = {H3: (70, 110), H6: (150, 215)}


def _gap_ok(idx: pd.DatetimeIndex, h: int) -> np.ndarray:
    d = idx.values.astype("datetime64[D]").astype("int64")
    ok = np.zeros(len(d), dtype=bool)
    if len(d) > h:
        gap = d[h:] - d[:-h]
        lo, hi = GAP_OK[h]
        ok[:-h] = (gap >= lo) & (gap <= hi)
    return ok


def _future_date(idx: pd.DatetimeIndex, h: int) -> pd.Series:
    s = pd.Series(idx, index=idx)
    return s.shift(-h)


def _forward_max_drawdown(close: np.ndarray, h: int) -> np.ndarray:
    """Max drawdown of the path close[t..t+h] with the peak initialised at close[t]."""
    out = np.full(len(close), np.nan)
    if len(close) > h:
        w = np.lib.stride_tricks.sliding_window_view(close, h + 1)
        peak = np.maximum.accumulate(w, axis=1)
        out[: len(w)] = (w / peak - 1.0).min(axis=1)
    return out


def compute_targets(prices: pd.DataFrame) -> pd.DataFrame:
    close = prices["adj_close"].astype(float)
    idx = close.index
    t = pd.DataFrame(index=idx)
    ok3, ok6 = _gap_ok(idx, H3), _gap_ok(idx, H6)
    f3 = (close.shift(-H3) / close - 1).where(ok3)
    f6 = (close.shift(-H6) / close - 1).where(ok6)
    t["forward_return_3m"], t["forward_return_6m"] = f3, f6
    t["positive_3m"] = (f3 > 0).astype(float).where(f3.notna())
    t["positive_6m"] = (f6 > 0).astype(float).where(f6.notna())
    r = close.pct_change()
    # std of r[t+1..t+63]: rolling std ending at t+63, shifted back to t
    fvol = (r.rolling(H3, min_periods=H3).std() * np.sqrt(TRADING_DAYS)).shift(-H3)
    t["future_vol_3m"] = fvol.where(ok3)
    t["future_drawdown_3m"] = pd.Series(_forward_max_drawdown(close.to_numpy(float), H3), index=idx).where(ok3)
    t["label_end_3m"] = _future_date(idx, H3).where(ok3)
    t["label_end_6m"] = _future_date(idx, H6).where(ok6)
    return t
