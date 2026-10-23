"""PROOF that future information cannot enter training features."""
import numpy as np
import pandas as pd
import pytest

from synthetic import make_universe
from wealthfolio_ml.config import FEATURES, TARGETS
from wealthfolio_ml.dataset import build_symbol_frame
from wealthfolio_ml.features import compute_features


@pytest.fixture(scope="module")
def stock_and_bench():
    u = make_universe(1, 1600, seed=11)
    px = u["SYNIN0.NS"].set_index("date")[["adj_close", "volume"]]
    b = u["^NSEI"].set_index("date")["adj_close"]
    return px, b


def test_feature_names_never_reference_the_future():
    assert not set(FEATURES) & set(TARGETS)
    for f in FEATURES:
        assert not any(w in f for w in ("forward", "future", "label", "target", "next"))


def test_features_at_t_identical_when_future_is_deleted(stock_and_bench):
    px, b = stock_and_bench
    full = compute_features(px, b)
    for cut in (400, 900, 1300):
        trunc = compute_features(px.iloc[:cut], b.iloc[:cut])
        pd.testing.assert_frame_equal(full.iloc[:cut], trunc, rtol=1e-9, atol=1e-12)


def test_features_at_t_identical_when_future_is_corrupted(stock_and_bench):
    px, b = stock_and_bench
    full = compute_features(px, b)
    rng = np.random.default_rng(0)
    cut = 900
    px2, b2 = px.copy(), b.copy()
    px2.iloc[cut:, 0] *= rng.uniform(0.1, 10, len(px2) - cut)      # wildly different future prices
    px2.iloc[cut:, 1] *= rng.uniform(0.1, 10, len(px2) - cut)      # and volumes
    b2.iloc[cut:] *= rng.uniform(0.1, 10, len(b2) - cut)           # and benchmark
    corrupted = compute_features(px2, b2)
    pd.testing.assert_frame_equal(full.iloc[:cut], corrupted.iloc[:cut], rtol=1e-9, atol=1e-12)
    assert not full.iloc[cut + 50:].equals(corrupted.iloc[cut + 50:])  # sanity: the corruption really changed later rows


def test_dataset_rows_before_cutoff_have_identical_features_but_targets_need_future(stock_and_bench):
    px, b = stock_and_bench
    full = build_symbol_frame("SYNIN0.NS", px, b)
    cut = 1000
    trunc = build_symbol_frame("SYNIN0.NS", px.iloc[:cut], b.iloc[:cut])
    m = full.merge(trunc, on="date", suffixes=("_f", "_t"))
    assert len(m) > 50
    for f in FEATURES:
        a, c = m[f + "_f"].to_numpy(float), m[f + "_t"].to_numpy(float)
        np.testing.assert_allclose(a, c, rtol=1e-9, atol=1e-12, equal_nan=True)
    # Near the cut the truncated data CANNOT know the 6-month outcome: it must be missing, never filled.
    tail = trunc.tail(10)
    assert tail["forward_return_6m"].isna().all() and tail["forward_return_3m"].isna().all()
    assert tail["positive_6m"].isna().all()


def test_label_window_always_ends_after_observation(stock_and_bench):
    px, b = stock_and_bench
    f = build_symbol_frame("SYNIN0.NS", px, b).dropna(subset=["label_end_6m"])
    assert (f["label_end_6m"] > f["date"]).all() and (f["label_end_3m"] > f["date"]).all()
    assert (f["purge_date"] > f["date"]).all()
