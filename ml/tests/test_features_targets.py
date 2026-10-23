import numpy as np
import pandas as pd
import pytest

from wealthfolio_ml.config import FEATURES, H3, H6
from wealthfolio_ml.features import _rsi, compute_features, completeness
from wealthfolio_ml.targets import compute_targets


def _px(values, start="2020-01-01"):
    idx = pd.bdate_range(start, periods=len(values))
    return pd.DataFrame({"adj_close": np.asarray(values, float), "volume": 1e6}, index=idx)


def test_feature_columns_exact_and_missing_stays_nan():
    px = _px(np.linspace(100, 120, 300))
    f = compute_features(px, None)
    assert list(f.columns) == FEATURES
    assert f["vol_252d"].iloc[:251].isna().all() and f["vol_252d"].iloc[252:].notna().all()   # not zero-filled
    assert f["bench_ret_3m"].isna().all() and f["beta_252d"].isna().all()                   # no benchmark => null, not invented
    assert completeness(f.iloc[-1]) < 1.0


def test_rsi_extremes_and_golden_cross():
    up = _px(np.linspace(100, 200, 300))
    f = compute_features(up, None)
    assert f["rsi14"].iloc[-1] == 100 and f["golden_cross"].iloc[-1] == 1.0
    down = compute_features(_px(np.linspace(200, 100, 300)), None)
    assert down["rsi14"].iloc[-1] < 1 and down["golden_cross"].iloc[-1] == 0.0


def test_returns_and_drawdown_values():
    v = np.r_[np.full(252, 100.0), np.linspace(100, 120, 60)]
    f = compute_features(_px(v), None)
    assert f["ret_1m"].iloc[-1] == pytest.approx(v[-1] / v[-22] - 1)
    assert f["max_dd_252d"].iloc[-1] <= 0 and f["dd_from_high_252d"].iloc[-1] == pytest.approx(0.0)


def test_targets_known_values():
    v = np.arange(100.0, 100.0 + 300)           # +1 per day
    t = compute_targets(_px(v))
    assert t["forward_return_3m"].iloc[0] == pytest.approx(v[H3] / v[0] - 1)
    assert t["forward_return_6m"].iloc[10] == pytest.approx(v[10 + H6] / v[10] - 1)
    assert t["positive_3m"].iloc[0] == 1.0
    assert t["forward_return_3m"].iloc[-H3:].isna().all()                  # last 63 rows have no outcome yet
    assert t["forward_return_6m"].iloc[-H6:].isna().all()
    assert t["positive_6m"].iloc[-H6:].isna().all()                        # NaN, not 0
    assert (t["label_end_3m"].dropna() > t.index[: len(t["label_end_3m"].dropna())]).all()


def test_future_drawdown_and_vol():
    v = np.r_[100.0, np.linspace(100, 120, 30), np.linspace(120, 90, 33), np.full(40, 90.0)]
    t = compute_targets(_px(v))
    assert t["future_drawdown_3m"].iloc[0] == pytest.approx(90 / 120 - 1)
    assert t["future_vol_3m"].iloc[0] > 0


def test_date_gap_invalidates_target():
    idx = list(pd.bdate_range("2020-01-01", periods=120)) + list(pd.bdate_range("2021-06-01", periods=120))   # 1.3-year hole
    px = pd.DataFrame({"adj_close": np.linspace(100, 150, 240), "volume": 1e6}, index=pd.DatetimeIndex(idx))
    t = compute_targets(px)
    assert t["forward_return_3m"].iloc[:50].notna().all()      # +63 rows stays inside the first block: valid
    assert t["forward_return_3m"].iloc[60:118].isna().all()    # +63 rows would silently jump over the 1.3-year hole: must be invalid
