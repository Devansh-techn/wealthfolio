"""Point-in-time feature engineering.

Every feature at row t is a function of prices/volumes at rows <= t ONLY (rolling windows, shifts by a
positive number of rows, exponentially weighted means, trailing joins). tests/test_no_lookahead.py proves
this by truncating and by corrupting the future and asserting the features at t do not change.

Units: returns / volatilities / distances are DECIMALS (0.05 = 5%), not percent.
Missing values stay NaN (never filled with 0) — see ml/README.md "Missing data".
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import FEATURES, TRADING_DAYS

SQRT_TD = np.sqrt(TRADING_DAYS)


def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    gain = d.clip(lower=0.0)
    loss = (-d).clip(lower=0.0)
    ag = gain.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    al = loss.ewm(alpha=1.0 / n, adjust=False, min_periods=n).mean()
    rs = ag / al
    out = 100.0 - 100.0 / (1.0 + rs)
    out = out.where(al != 0, 100.0)             # no losses in window -> RSI 100
    out = out.where(~((al == 0) & (ag == 0)), 50.0)
    out.iloc[:n] = np.nan                         # not enough history
    return out


def _rolling_max_drawdown(close: pd.Series, window: int) -> pd.Series:
    """Max drawdown (negative decimal) inside each trailing `window`-row window."""
    v = close.to_numpy(dtype=float)
    out = np.full(len(v), np.nan)
    if len(v) >= window:
        w = np.lib.stride_tricks.sliding_window_view(v, window)
        peak = np.maximum.accumulate(w, axis=1)
        out[window - 1:] = (w / peak - 1.0).min(axis=1)
    return pd.Series(out, index=close.index)


def _base_series_features(close: pd.Series) -> dict[str, pd.Series]:
    r = close.pct_change()
    f: dict[str, pd.Series] = {}
    sma20, sma50, sma200 = (close.rolling(n, min_periods=n).mean() for n in (20, 50, 200))
    f["dist_sma20"] = close / sma20 - 1
    f["dist_sma50"] = close / sma50 - 1
    f["dist_sma200"] = close / sma200 - 1
    f["sma50_over_sma200"] = sma50 / sma200 - 1
    both = sma50.notna() & sma200.notna()
    f["golden_cross"] = (sma50 > sma200).astype(float).where(both)
    ema12 = close.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = close.ewm(span=26, adjust=False, min_periods=26).mean()
    macd = ema12 - ema26
    sig = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    f["macd_norm"] = macd / close
    f["macd_hist_norm"] = (macd - sig) / close
    f["dist_ema50"] = close / close.ewm(span=50, adjust=False, min_periods=50).mean() - 1
    f["rsi14"] = _rsi(close, 14)
    f["ret_1m"] = close / close.shift(21) - 1
    f["ret_3m"] = close / close.shift(63) - 1
    f["ret_6m"] = close / close.shift(126) - 1
    f["ret_12m_ex1m"] = close.shift(21) / close.shift(252) - 1
    f["mom_accel"] = f["ret_3m"] - (close.shift(63) / close.shift(126) - 1)
    for n in (21, 63, 252):
        f[f"vol_{n}d"] = r.rolling(n, min_periods=n).std() * SQRT_TD
    f["downside_vol_63d"] = np.sqrt((r.clip(upper=0.0) ** 2).rolling(63, min_periods=63).mean()) * SQRT_TD
    f["max_dd_252d"] = _rolling_max_drawdown(close, 252)
    f["dd_from_high_252d"] = close / close.rolling(252, min_periods=252).max() - 1
    mu, sd = r.rolling(126, min_periods=126).mean(), r.rolling(126, min_periods=126).std()
    f["sharpe_126d"] = (mu / sd * SQRT_TD).where(sd > 0)
    hi, lo = close.rolling(252, min_periods=252).max(), close.rolling(252, min_periods=252).min()
    f["range_pos_252d"] = ((close - lo) / (hi - lo)).where(hi > lo)
    f["_ret"] = r
    return f


def compute_features(prices: pd.DataFrame, bench_close: pd.Series | None = None) -> pd.DataFrame:
    """prices: DatetimeIndex (ascending, unique), columns: adj_close, volume. Returns DataFrame[FEATURES]."""
    close = prices["adj_close"].astype(float)
    f = _base_series_features(close)
    r = f.pop("_ret")

    vol = prices["volume"].astype(float).where(prices["volume"] > 0)
    f["volume_ratio_20_60"] = vol.rolling(20, min_periods=20).mean() / vol.rolling(60, min_periods=60).mean()

    nan = pd.Series(np.nan, index=close.index)
    if bench_close is not None and len(bench_close) > 260:
        b = bench_close.astype(float)
        bf = _base_series_features(b)
        br = bf.pop("_ret")
        # Trailing alignment: each stock date takes the most recent benchmark value on or before it.
        al = lambda s: s.reindex(s.index.union(close.index)).ffill(limit=3).reindex(close.index)  # noqa: E731
        f["bench_ret_3m"], f["bench_ret_6m"] = al(bf["ret_3m"]), al(bf["ret_6m"])
        f["bench_dist_sma200"], f["bench_vol_63d"] = al(bf["dist_sma200"]), al(bf["vol_63d"])
        f["rel_strength_3m"] = f["ret_3m"] - f["bench_ret_3m"]
        f["rel_strength_6m"] = f["ret_6m"] - f["bench_ret_6m"]
        brr = br.reindex(close.index)            # benchmark daily return on the stock's own trading days
        cov = r.rolling(252, min_periods=200).cov(brr)
        var = brr.rolling(252, min_periods=200).var()
        f["beta_252d"] = (cov / var).where(var > 0)
    else:
        for k in ("bench_ret_3m", "bench_ret_6m", "bench_dist_sma200", "bench_vol_63d", "rel_strength_3m", "rel_strength_6m", "beta_252d"):
            f[k] = nan

    out = pd.DataFrame(f, index=close.index)[FEATURES]
    return out.replace([np.inf, -np.inf], np.nan)


def completeness(row_or_frame: pd.DataFrame | pd.Series) -> pd.Series | float:
    """Share of non-null features (0..1). Used for confidence and for dropping near-empty training rows."""
    if isinstance(row_or_frame, pd.Series):
        return float(row_or_frame[FEATURES].notna().mean())
    return row_or_frame[FEATURES].notna().mean(axis=1)


# ---------------- price-only port of the EXISTING rule score (src/lib/scoring.js) ----------------
def _scale(x: float | None, pts: list[tuple[float, float]]) -> float | None:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, s0), (x1, s1) in zip(pts, pts[1:]):
        if x <= x1:
            return s0 + (x - x0) / (x1 - x0) * (s1 - s0)
    return pts[-1][1]


def _b(v: bool | None) -> float | None:
    return None if v is None else (100.0 if v else 0.0)


# Same rubric weights as RUBRIC in scoring.js for the pillars that CAN be computed from prices.
# Inputs use the JS units (percent). The Fundamental pillar is absent: no point-in-time fundamentals.
RULE_TECH = [(30, "rsi14", lambda m: _scale(m["rsi14"], [(0, 25), (30, 60), (45, 90), (60, 100), (70, 65), (80, 30), (100, 10)])),
             (25, "aboveSma50", lambda m: _b(m["aboveSma50"])),
             (25, "aboveSma200", lambda m: _b(m["aboveSma200"])),
             (20, "goldenCross", lambda m: _b(m["goldenCross"]))]
RULE_MOM = [(15, "momentum1m", lambda m: _scale(m["momentum1m"], [(-15, 0), (0, 45), (5, 70), (15, 100)])),
            (30, "momentum3m", lambda m: _scale(m["momentum3m"], [(-25, 0), (0, 45), (10, 75), (30, 100)])),
            (25, "momentum6m", lambda m: _scale(m["momentum6m"], [(-35, 0), (0, 45), (20, 80), (50, 100)])),
            (20, "momentum12m1m", lambda m: _scale(m["momentum12m1m"], [(-40, 0), (0, 45), (25, 80), (70, 100)])),
            (10, "rangePosition", lambda m: _scale(m["rangePosition"], [(0, 10), (50, 55), (85, 100), (100, 90)]))]
RULE_RISK = [(45, "volatility", lambda m: _scale(m["volatility"], [(10, 100), (20, 80), (30, 55), (45, 25), (70, 0)])),
             (35, "maxDrawdown1y", lambda m: _scale(abs(m["maxDrawdown1y"]) if m["maxDrawdown1y"] is not None else None, [(0, 100), (10, 85), (20, 60), (35, 25), (55, 0)]))]
# (the JS risk pillar also has debtToEquity, which is null here and therefore skipped + renormalised, exactly as in JS)
PILLAR_W = {"technical": 20, "momentum": 25, "risk": 20}


def _pillar(rules, m) -> float | None:
    acc = w = 0.0
    for weight, _k, fn in rules:
        s = fn(m)
        if s is None:
            continue
        acc += s * weight
        w += weight
    return acc / w if w else None


def _nz(x):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else float(x)


def rule_score_from_features(row: pd.Series) -> dict[str, float | None]:
    """Existing WealthFolio rubric applied to the price-derived metrics only (what is knowable historically)."""
    pct = lambda k: None if _nz(row.get(k)) is None else float(row[k]) * 100.0  # noqa: E731
    flag = lambda k, op: None if _nz(row.get(k)) is None else op(float(row[k]))  # noqa: E731
    m = {
        "rsi14": _nz(row.get("rsi14")),
        "aboveSma50": flag("dist_sma50", lambda v: v > 0),
        "aboveSma200": flag("dist_sma200", lambda v: v > 0),
        "goldenCross": flag("golden_cross", lambda v: v > 0.5),
        "momentum1m": pct("ret_1m"), "momentum3m": pct("ret_3m"), "momentum6m": pct("ret_6m"),
        "momentum12m1m": pct("ret_12m_ex1m"), "rangePosition": pct("range_pos_252d"),
        "volatility": pct("vol_252d"), "maxDrawdown1y": pct("max_dd_252d"),
    }
    p = {"technical": _pillar(RULE_TECH, m), "momentum": _pillar(RULE_MOM, m), "risk": _pillar(RULE_RISK, m)}
    acc = w = 0.0
    for k, wt in PILLAR_W.items():
        if p[k] is not None:
            acc += p[k] * wt
            w += wt
    p["overall"] = acc / w if w else None
    return p


def rule_score_series(feat: pd.DataFrame) -> pd.DataFrame:
    rows = [rule_score_from_features(r) for _, r in feat.iterrows()]
    return pd.DataFrame(rows, index=feat.index).astype(float)
