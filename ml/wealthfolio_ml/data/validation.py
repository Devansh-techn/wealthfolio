"""Data-quality layer. The model must never train on fabricated / misaligned / duplicated data.

validate_prices   -> cleans ONE symbol's price history and returns a report (or quarantines the symbol).
validate_dataset  -> asserts structural invariants on the assembled training panel (raises on fatal ones).

Missing-data policy (documented in ml/README.md):
  * prices: rows with non-finite or <= 0 prices are DROPPED (never zero-filled).
  * features: stay NaN. HistGradientBoosting handles NaN natively; Logistic/RF use median imputation
    (+ missing-indicators) fitted on the TRAIN split only. Rows missing > 30% of features are excluded from
    training and get low confidence at inference.
  * targets: rows without a valid target for a head are excluded for that head only.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import FEATURES, QualityConfig, TARGETS


class DataQualityError(Exception):
    pass


@dataclass
class PriceReport:
    symbol: str
    rows_in: int = 0
    rows_out: int = 0
    duplicates_dropped: int = 0
    invalid_dropped: int = 0
    future_dropped: int = 0
    spikes_dropped: int = 0
    gaps: list[str] = field(default_factory=list)
    stale_runs: int = 0
    extreme_returns: int = 0
    quarantined: bool = False
    reason: str = ""

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def validate_prices(df: pd.DataFrame, symbol: str, cfg: QualityConfig = QualityConfig(), today: pd.Timestamp | None = None) -> tuple[pd.DataFrame | None, PriceReport]:
    """df columns: date, adj_close, volume (close optional). Returns (clean DataFrame indexed by date | None, report)."""
    rep = PriceReport(symbol=symbol, rows_in=len(df))
    if df is None or df.empty or not {"date", "adj_close"} <= set(df.columns):
        rep.quarantined, rep.reason = True, "no usable price data"
        return None, rep
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"], errors="coerce").dt.tz_localize(None).dt.normalize()
    if "volume" not in d:
        d["volume"] = np.nan
    d["adj_close"] = pd.to_numeric(d["adj_close"], errors="coerce")
    d["volume"] = pd.to_numeric(d["volume"], errors="coerce")

    bad = d["date"].isna() | ~np.isfinite(d["adj_close"]) | (d["adj_close"] <= 0)
    rep.invalid_dropped = int(bad.sum())
    d = d[~bad]
    today = (today or pd.Timestamp.now(tz="UTC").tz_localize(None)).normalize()
    fut = d["date"] > today
    rep.future_dropped = int(fut.sum())
    d = d[~fut]
    d = d.sort_values("date")
    dup = d["date"].duplicated(keep="last")
    rep.duplicates_dropped = int(dup.sum())
    d = d[~dup]
    d.loc[d["volume"] < 0, "volume"] = np.nan

    # isolated bad ticks: a huge move that is almost fully reversed on the next row
    for _ in range(3):
        c = d["adj_close"].to_numpy(float)
        if len(c) < 3:
            break
        r = c[1:] / c[:-1] - 1
        drop = np.zeros(len(c), dtype=bool)
        for i in range(1, len(c) - 1):
            if abs(r[i - 1]) > cfg.spike_return and abs(c[i + 1] / c[i - 1] - 1) < cfg.spike_reversal_tol:
                drop[i] = True
        if not drop.any():
            break
        rep.spikes_dropped += int(drop.sum())
        d = d[~drop]
    d = d.set_index("date")

    if len(d) < cfg.min_rows:
        rep.quarantined, rep.reason = True, f"only {len(d)} usable rows (< {cfg.min_rows})"
        rep.rows_out = len(d)
        return None, rep

    r = d["adj_close"].pct_change().dropna()
    rep.extreme_returns = int((r.abs() > cfg.spike_return).sum())
    if (r.abs() > cfg.quarantine_return).any():
        rep.quarantined = True
        rep.reason = f"daily move beyond {cfg.quarantine_return:.0%} (possible unadjusted split / bad data)"
        rep.rows_out = len(d)
        return None, rep
    gaps = d.index.to_series().diff().dt.days
    rep.gaps = [f"{d.index[i - 1].date()}→{d.index[i].date()} ({int(g)}d)" for i, g in enumerate(gaps) if g and g > cfg.max_gap_days][:10]
    same = (d["adj_close"].diff() == 0).astype(int)
    run = same.groupby((same == 0).cumsum()).cumsum()
    rep.stale_runs = int((run >= cfg.stale_run).sum())
    rep.rows_out = len(d)
    return d[["adj_close", "volume"]], rep


@dataclass
class DatasetReport:
    rows: int = 0
    symbols: int = 0
    issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    missing_frac: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return self.__dict__.copy()


RANGES = {  # inclusive plausibility ranges for features / targets (decimals)
    "rsi14": (0, 100), "range_pos_252d": (0, 1), "golden_cross": (0, 1),
    "vol_21d": (0, 20), "vol_63d": (0, 20), "vol_252d": (0, 20), "downside_vol_63d": (0, 20),
    "max_dd_252d": (-1, 0), "dd_from_high_252d": (-1, 0),
    "ret_1m": (-0.99, 20), "ret_3m": (-0.99, 50), "ret_6m": (-0.99, 100), "ret_12m_ex1m": (-0.99, 200),
    "forward_return_3m": (-0.99, 50), "forward_return_6m": (-0.99, 100),
    "future_vol_3m": (0, 20), "future_drawdown_3m": (-1, 0),
}


def validate_dataset(df: pd.DataFrame, strict: bool = True) -> DatasetReport:
    rep = DatasetReport(rows=len(df), symbols=int(df["symbol"].nunique()) if len(df) else 0)
    fatal: list[str] = []
    if len(df) == 0:
        fatal.append("dataset is empty")
    else:
        dups = int(df.duplicated(["symbol", "date"]).sum())
        if dups:
            fatal.append(f"{dups} duplicate (symbol, date) rows")
        if not df["date"].is_monotonic_increasing and not df.sort_values(["symbol", "date"]).equals(df.sort_values(["symbol", "date"])):
            fatal.append("ordering error")
        for c in ("label_end_3m", "label_end_6m"):
            v = df[c].dropna()
            if len(v) and (v <= df.loc[v.index, "date"]).any():
                fatal.append(f"{c} not strictly after the observation date (look-ahead risk)")
        if (df["grid_date"] < df["date"]).any():
            fatal.append("observation date later than its grid date")
        inf = int(np.isinf(df[FEATURES + [t for t in TARGETS if t in df]].select_dtypes("number")).sum().sum())
        if inf:
            fatal.append(f"{inf} infinite values")
        for col, (lo, hi) in RANGES.items():
            if col in df:
                v = df[col].dropna()
                n = int(((v < lo) | (v > hi)).sum())
                if n:
                    (fatal if n / max(len(v), 1) > 0.001 else rep.warnings).append(f"{col}: {n} values outside [{lo}, {hi}]")
        for tgt, src in (("positive_3m", "forward_return_3m"), ("positive_6m", "forward_return_6m")):
            m = df[[tgt, src]].dropna()
            if len(m) and ((m[src] > 0).astype(float) != m[tgt]).any():
                fatal.append(f"{tgt} inconsistent with {src}")
        # "missing data disguised as zero": exact zeros in features where zero is implausible
        for col in ("vol_21d", "vol_63d", "vol_252d", "rsi14"):
            z = float((df[col] == 0).mean())
            if z > 0.001:
                rep.warnings.append(f"{col}: {z:.2%} exact zeros (possible disguised missing data)")
        rep.missing_frac = {c: round(float(df[c].isna().mean()), 4) for c in FEATURES}
        hi_missing = [c for c, f in rep.missing_frac.items() if f > 0.5]
        if hi_missing:
            rep.warnings.append(f"features >50% missing: {hi_missing}")
    rep.issues = fatal
    if fatal and strict:
        raise DataQualityError("; ".join(fatal))
    return rep
