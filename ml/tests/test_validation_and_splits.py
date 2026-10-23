import numpy as np
import pandas as pd
import pytest

from synthetic import make_universe
from wealthfolio_ml.config import DatasetConfig, QualityConfig
from wealthfolio_ml.data.validation import DataQualityError, validate_dataset, validate_prices
from wealthfolio_ml.dataset import build_panel
from wealthfolio_ml.splits import apply_split, auto_split, walk_forward_folds


def _raw(n=800, seed=0):
    r = np.random.default_rng(seed)
    return pd.DataFrame({"date": pd.bdate_range("2018-01-01", periods=n), "adj_close": 100 * np.cumprod(1 + r.normal(0, 0.01, n)), "volume": 1e6})


def test_price_validation_cleans_and_reports():
    d = _raw()
    d = pd.concat([d, d.iloc[[5]]])                      # duplicate date
    d.loc[10, "adj_close"] = np.nan
    d.loc[11, "adj_close"] = -3
    d.loc[300, "adj_close"] = d.loc[299, "adj_close"] * 3   # bad tick (+200%) reversed next row
    d.loc[301, "adj_close"] = d.loc[299, "adj_close"] * 1.001
    clean, rep = validate_prices(d, "X")
    assert clean is not None and not rep.quarantined
    assert rep.duplicates_dropped == 1 and rep.invalid_dropped == 2 and rep.spikes_dropped == 1
    assert clean.index.is_unique and clean.index.is_monotonic_increasing and (clean["adj_close"] > 0).all()


def test_symbol_quarantined_for_unadjusted_split_or_short_history():
    d = _raw()
    d.loc[400:, "adj_close"] *= 0.2                      # permanent -80% step => likely unadjusted split
    clean, rep = validate_prices(d, "SPLIT")
    assert clean is None and rep.quarantined
    clean, rep = validate_prices(_raw(100), "SHORT")
    assert clean is None and "usable rows" in rep.reason


def test_future_dated_rows_dropped():
    d = _raw()
    clean, rep = validate_prices(d, "F", today=pd.Timestamp("2019-01-01"))
    assert rep.future_dropped > 0 and clean.index.max() <= pd.Timestamp("2019-01-01") if clean is not None else True


@pytest.fixture(scope="module")
def panel():
    return build_panel(make_universe(8, 2200, seed=2), DatasetConfig())[0]


def test_dataset_invariants_pass_and_catch_corruption(panel):
    assert validate_dataset(panel).issues == []
    dup = pd.concat([panel, panel.iloc[[0]]], ignore_index=True)
    with pytest.raises(DataQualityError, match="duplicate"):
        validate_dataset(dup)
    bad = panel.copy()
    i = bad["positive_3m"].first_valid_index()
    bad.loc[i, "positive_3m"] = 1.0 - bad.loc[i, "positive_3m"]
    with pytest.raises(DataQualityError, match="inconsistent"):
        validate_dataset(bad)
    leak = panel.copy()
    j = leak["label_end_3m"].first_valid_index()
    leak.loc[j, "label_end_3m"] = leak.loc[j, "date"]
    with pytest.raises(DataQualityError, match="look-ahead"):
        validate_dataset(leak)


def test_chronological_split_has_no_overlap_and_is_purged(panel):
    spec = auto_split(panel)
    s = apply_split(panel, spec)
    tr, va, te = s["train"], s["val"], s["test"]
    assert tr["date"].max() < va["date"].min() <= va["date"].max() < te["date"].min()
    assert tr["purge_date"].max() < spec.val_start and va["purge_date"].max() < spec.test_start    # label windows cannot leak forward
    assert set(map(tuple, tr[["symbol", "date"]].values)).isdisjoint(set(map(tuple, te[["symbol", "date"]].values)))
    assert te["forward_return_6m"].notna().any()


def test_walk_forward_is_expanding_and_ordered(panel):
    folds = walk_forward_folds(panel, DatasetConfig(), min_train_rows=500)
    assert len(folds) >= 2
    prev_end = None
    for name, tr, te in folds:
        assert tr["purge_date"].max() < te["date"].min()
        if prev_end is not None:
            assert te["date"].max() > prev_end
        prev_end = te["date"].max()
