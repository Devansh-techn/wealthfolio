"""Chronological splitting with purge/embargo. NEVER a random train_test_split.

A training row at date t has a label that peeks up to ~126 trading days ahead. To stop that label window
from reaching into the validation (or test) period, every row's `purge_date` (= date + 190 calendar days) must
fall BEFORE the start of the next split to be used.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import pandas as pd

from .config import DatasetConfig


@dataclass(frozen=True)
class SplitSpec:
    val_start: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp

    def as_dict(self) -> dict:
        return {k: str(v.date()) for k, v in asdict(self).items()}


def auto_split(df: pd.DataFrame, cfg: DatasetConfig = DatasetConfig(), target: str = "forward_return_6m") -> SplitSpec:
    """Test = the latest `test_months` of rows that HAVE a 6-month label; validation = the `val_months` before it."""
    last = df.loc[df[target].notna(), "date"].max()
    test_start = (last - pd.DateOffset(months=cfg.test_months)).normalize()
    val_start = (test_start - pd.DateOffset(months=cfg.val_months)).normalize()
    return SplitSpec(val_start=val_start, test_start=test_start, test_end=last)


def explicit_split(val_start: str, test_start: str, test_end: str | None = None) -> SplitSpec:
    return SplitSpec(pd.Timestamp(val_start), pd.Timestamp(test_start), pd.Timestamp(test_end or "2100-01-01"))


def apply_split(df: pd.DataFrame, spec: SplitSpec) -> dict[str, pd.DataFrame]:
    tr = df[df["purge_date"] < spec.val_start]
    va = df[(df["date"] >= spec.val_start) & (df["date"] < spec.test_start) & (df["purge_date"] < spec.test_start)]
    te = df[(df["date"] >= spec.test_start) & (df["date"] <= spec.test_end)]
    assert tr["date"].max() < va["date"].min() if len(tr) and len(va) else True
    return {"train": tr, "val": va, "test": te}


def walk_forward_folds(df: pd.DataFrame, cfg: DatasetConfig = DatasetConfig(), target: str = "forward_return_6m", min_train_rows: int = 2000):
    """Expanding-window folds, newest first stepping back `wf_test_months`. Yields (name, train_df, test_df)."""
    last = df.loc[df[target].notna(), "date"].max()
    folds = []
    for k in range(cfg.wf_folds):
        te_end = last - pd.DateOffset(months=k * cfg.wf_test_months)
        te_start = te_end - pd.DateOffset(months=cfg.wf_test_months)
        tr = df[df["purge_date"] < te_start]
        te = df[(df["date"] > te_start) & (df["date"] <= te_end)]
        if len(tr) >= min_train_rows and len(te) > 0:
            folds.append((f"{te_start.date()}..{te_end.date()}", tr, te))
    return list(reversed(folds))
