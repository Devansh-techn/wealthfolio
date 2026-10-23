"""Panel dataset: one row per (symbol, weekly observation date) with point-in-time features and forward targets."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import BENCHMARKS, FEATURES, DatasetConfig, QualityConfig, market_of
from .data.validation import validate_prices, validate_dataset, DatasetReport
from .features import completeness, compute_features, rule_score_series
from .targets import compute_targets

META_COLS = ["symbol", "market", "date", "grid_date", "purge_date", "n_obs_before", "price"]


def _weekly_positions(idx: pd.DatetimeIndex, grid: pd.DatetimeIndex, max_lag_days: int = 4) -> np.ndarray:
    pos = idx.searchsorted(grid, side="right") - 1
    ok = pos >= 0
    pos, g = pos[ok], grid[ok]
    lag = (g.values - idx.values[pos]).astype("timedelta64[D]").astype(int)
    keep = lag <= max_lag_days
    return pos[keep], g[keep]


def build_symbol_frame(symbol: str, prices: pd.DataFrame, bench_close: pd.Series | None, cfg: DatasetConfig = DatasetConfig(),
                       grid: pd.DatetimeIndex | None = None, with_targets: bool = True) -> pd.DataFrame:
    feats = compute_features(prices, bench_close)
    close = prices["adj_close"]
    idx = prices.index
    grid = grid if grid is not None else pd.date_range(idx[0], idx[-1], freq="W-FRI")
    pos, g = _weekly_positions(idx, grid)
    keep = pos >= cfg.min_history_rows
    pos, g = pos[keep], g[keep]
    # a weekly grid can map two grid dates to the same trading day around holidays -> keep the first
    _, first = np.unique(pos, return_index=True)
    pos, g = pos[np.sort(first)], g[np.sort(first)]
    f = feats.iloc[pos].copy()
    f.insert(0, "symbol", symbol)
    f.insert(1, "market", market_of(symbol) or "OTHER")
    f.insert(2, "date", idx[pos])
    f.insert(3, "grid_date", g)
    f.insert(4, "purge_date", idx[pos] + pd.Timedelta(days=cfg.purge_calendar_days))
    f.insert(5, "n_obs_before", pos)
    f.insert(6, "price", close.iloc[pos].to_numpy())
    f["completeness"] = completeness(f)
    rs = rule_score_series(f)
    f["rule_score_price_only"] = rs["overall"].to_numpy()
    if with_targets:
        t = compute_targets(prices).iloc[pos]
        for c in t.columns:
            f[c] = t[c].to_numpy()
    f.index = range(len(f))
    return f


def build_panel(price_frames: dict[str, pd.DataFrame], cfg: DatasetConfig = DatasetConfig(), qcfg: QualityConfig = QualityConfig(),
                with_targets: bool = True, validate: bool = True) -> tuple[pd.DataFrame, dict]:
    """price_frames: symbol -> raw DataFrame (date, adj_close, volume), INCLUDING benchmark symbols (^NSEI, ^GSPC)."""
    reports, clean = {}, {}
    for sym, raw in price_frames.items():
        c, rep = validate_prices(raw, sym, qcfg)
        reports[sym] = rep.as_dict()
        if c is not None:
            clean[sym] = c
    bench = {m: clean[b]["adj_close"] for m, b in BENCHMARKS.items() if b in clean}
    benchmark_symbols = set(BENCHMARKS.values())
    frames = []
    for sym, c in clean.items():
        if sym in benchmark_symbols:
            continue
        mk = market_of(sym)
        frames.append(build_symbol_frame(sym, c, bench.get(mk), cfg, with_targets=with_targets))
    if not frames:
        return pd.DataFrame(columns=META_COLS + FEATURES), {"price_reports": reports, "dataset": None, "clean": clean, "quarantined": []}
    panel = pd.concat(frames, ignore_index=True).sort_values(["date", "symbol"]).reset_index(drop=True)
    drep: DatasetReport | None = validate_dataset(panel) if validate and with_targets else None
    return panel, {"price_reports": reports, "dataset": drep.as_dict() if drep else None, "clean": clean,
                   "quarantined": [s for s, r in reports.items() if r["quarantined"]]}
