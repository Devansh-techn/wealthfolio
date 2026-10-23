import json

import numpy as np
import pandas as pd
import pytest

from wealthfolio_ml.backtest import perf_metrics, run_backtest
from wealthfolio_ml.config import BacktestConfig, CONFIDENCE_WEIGHTS, FEATURES
from wealthfolio_ml.confidence import agreement, compute_confidence, in_distribution, model_quality, stability, training_stats
from wealthfolio_ml.data import yahoo
from wealthfolio_ml.evaluate import calibration_table, clf_metrics, rank_ic, reg_metrics
from wealthfolio_ml.explain import occlusion_factors
from wealthfolio_ml.models import PlattCalibrator
from wealthfolio_ml.registry import ModelRegistry
from wealthfolio_ml import supabase_sync as sync
from wealthfolio_ml.universe import load_universes


# ------------------------------------------------------------------ universes / config
def test_universes_parsed_from_the_frontend_source():
    u = load_universes()
    assert len(u["in-largecap"]) == 49 and len(u["us-largecap"]) == 30 and "RELIANCE.NS" in u["in-largecap"]


# ------------------------------------------------------------------ confidence
def _comp(**kw):
    c = {k: 0.9 for k in CONFIDENCE_WEIGHTS}
    c.update(kw)
    return c


def test_weights_sum_to_one_and_labels():
    assert sum(CONFIDENCE_WEIGHTS.values()) == pytest.approx(1.0)
    assert compute_confidence(_comp(), 1.0, 800)["label"] == "high"
    assert compute_confidence(_comp(model_quality=0.3), 1.0, 800)["label"] == "medium"      # weak held-out evidence caps at medium
    assert compute_confidence(_comp(model_quality=0.05), 1.0, 800)["label"] == "low"
    assert compute_confidence(_comp(), 0.5, 800)["label"] == "low"                           # poor data quality => LOW
    assert compute_confidence(_comp(), 1.0, 100)["label"] == "low"                           # short history => LOW


def test_agreement_stability_and_distribution():
    assert agreement([0.6, 0.6, 0.6]) == 1.0 and agreement([0.2, 0.8, 0.5]) < 0.1
    assert stability([0.6, 0.6]) == 1.0 and stability([0.3, 0.7, 0.5]) < 0.2
    rng = np.random.default_rng(0)
    tr = pd.DataFrame({f: rng.normal(0, 1, 500) for f in FEATURES})
    st = training_stats(tr)
    assert in_distribution(pd.Series({f: 0.0 for f in FEATURES}), st) == 1.0
    assert in_distribution(pd.Series({f: 50.0 for f in FEATURES}), st) == 0.0
    assert model_quality({"roc_auc": 0.5, "ece": 0.2}) == 0.0 and model_quality(None) == 0.0


# ------------------------------------------------------------------ metrics
def test_classification_and_regression_metrics():
    rng = np.random.default_rng(1)
    n = 600
    df = pd.DataFrame({"grid_date": np.repeat(pd.date_range("2020-01-03", periods=30, freq="W-FRI"), 20), "y": 0.0, "r": 0.0})
    r = rng.normal(0, 0.1, n)
    df["r"], df["y"] = r, (r > 0).astype(float)
    good = np.clip(0.5 + r * 3, 0.01, 0.99)
    m = clf_metrics(df, "y", "r", good, 0.5)
    assert m["roc_auc"] > 0.95 and m["brier"] < m["brier_base_rate"] and m["rank_ic"]["mean"] > 0.5 and m["hit_rate_top20"] > 0.9
    junk = clf_metrics(df, "y", "r", rng.random(n), 0.5)
    assert abs(junk["roc_auc"] - 0.5) < 0.1
    rm = reg_metrics(df, "r", r * 0.9, 0.0)
    assert rm["r2"] > 0.9 and rm["r2_vs_train_mean"] > 0.9 and rm["directional_accuracy"] == 1.0
    cal, ece = calibration_table(df["y"], good)                       # score-like numbers are NOT calibrated probabilities
    assert ece > 0.1 and sum(c["n"] for c in cal) == n
    _, ece_ok = calibration_table(df["y"], np.full(n, df["y"].mean()))   # predicting the base rate is perfectly calibrated
    assert ece_ok < 1e-9


def test_platt_calibrator_improves_miscalibrated_probs():
    rng = np.random.default_rng(2)
    p_true = rng.uniform(0.2, 0.8, 4000)
    y = (rng.random(4000) < p_true).astype(float)
    overconfident = np.clip(0.5 + (p_true - 0.5) * 2.5, 0.01, 0.99)
    cal = PlattCalibrator().fit(overconfident[:2000], y[:2000]).transform(overconfident[2000:])
    from sklearn.metrics import brier_score_loss
    assert brier_score_loss(y[2000:], cal) < brier_score_loss(y[2000:], overconfident[2000:])


def test_occlusion_describes_influence_without_claiming_causation():
    row = pd.Series({f: 0.0 for f in FEATURES})
    row["ret_6m"] = 0.4
    med = {f: 0.0 for f in FEATURES}
    f = occlusion_factors(lambda X: 0.5 + 0.5 * np.tanh(X["ret_6m"].to_numpy() * 3), row, med)
    assert f["positive"][0]["feature"] == "ret_6m" and f["positive"][0]["value_text"] == "+40.0%" and f["negative"] == []


# ------------------------------------------------------------------ backtest
def _panel(n=500, k=12, seed=3):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2020-01-01", periods=n)
    drift = np.linspace(-0.001, 0.002, k)            # symbol j has constant drift: higher index = better
    r = rng.normal(0, 0.004, (n, k)) + drift
    px = pd.DataFrame(100 * np.cumprod(1 + r, axis=0), index=idx, columns=[f"S{i}" for i in range(k)])
    bench = pd.Series(100 * np.cumprod(1 + rng.normal(0.0003, 0.008, n)), index=idx)
    grids = pd.date_range(idx[60], idx[-70], freq="W-FRI")
    return px, bench, grids


def test_backtest_good_signal_beats_bad_signal_and_costs_bite():
    px, bench, grids = _panel()
    cols = list(px.columns)
    sig = lambda f: pd.DataFrame([{"symbol": s, "grid_date": g, "score": f(i)} for g in grids for i, s in enumerate(cols)])  # noqa: E731
    cfg = BacktestConfig(cost_bps_per_side=15)
    good = run_backtest(px, sig(lambda i: i), bench, cfg)
    bad = run_backtest(px, sig(lambda i: -i), bench, cfg)
    assert good["status"] == "ok" and good["label"] == "Historical simulation. Not a guarantee of future results."
    assert good["strategy"]["cumulative_return"] > bad["strategy"]["cumulative_return"]
    free = run_backtest(px, sig(lambda i: i), bench, BacktestConfig(cost_bps_per_side=0))
    heavy = run_backtest(px, sig(lambda i: (i * 7) % 12), bench, BacktestConfig(cost_bps_per_side=300))
    assert free["strategy"]["cumulative_return"] >= good["strategy"]["cumulative_return"]
    assert heavy["strategy"]["cumulative_return"] < free["strategy"]["cumulative_return"]
    assert good["avg_turnover"] <= 1 and "benchmark" in good and "hit_rate_vs_benchmark" in good


def test_backtest_signal_is_not_traded_on_its_own_close():
    """Entry must be strictly AFTER the signal date (next close)."""
    px, bench, grids = _panel()
    sig = pd.DataFrame([{"symbol": s, "grid_date": g, "score": i} for g in grids for i, s in enumerate(px.columns)])
    res = run_backtest(px, sig, bench)
    assert pd.Timestamp(res["period"][0]) > grids[0]


def test_backtest_insufficient_periods():
    px, bench, grids = _panel()
    sig = pd.DataFrame([{"symbol": s, "grid_date": g, "score": 1.0} for g in grids[:5] for s in px.columns])
    assert run_backtest(px, sig, bench)["status"] == "insufficient_periods"


def test_perf_metrics_drawdown():
    eq = pd.Series([1, 1.1, 0.99, 1.2] * 10, index=pd.bdate_range("2020-01-01", periods=40))
    m = perf_metrics(eq)
    assert m["max_drawdown"] == pytest.approx(0.99 / 1.1 - 1, abs=0.2) and m["cumulative_return"] == pytest.approx(0.2)


# ------------------------------------------------------------------ registry
def test_registry_enforces_single_production_and_status_changes(tmp_path):
    reg = ModelRegistry(tmp_path)
    base = {"version": "v1.0", "model_type": "x", "artifact_path": "a", "artifact_sha256": "0"}
    reg.add(base, "production", "first")
    reg.add({**base, "version": "v1.1"}, "production", "better")
    assert [e["status"] for e in reg.entries()] == ["archived", "production"] and reg.production()["version"] == "v1.1"
    reg.set_status("v1.0", "production", "rollback")
    assert reg.production()["version"] == "v1.0" and reg.get("v1.1")["status"] == "archived"
    assert reg.next_version() == "v1.2"


# ------------------------------------------------------------------ providers / sync (mocked network)
class _Resp:
    def __init__(self, status=200, body=None):
        self.status_code, self._b, self.text = status, body or {}, json.dumps(body or {})

    def json(self):
        return self._b


def test_yahoo_parser_uses_adjclose_and_exchange_date():
    body = {"chart": {"result": [{"meta": {"gmtoffset": 19800, "currency": "INR"}, "timestamp": [1700000000, 1700086400],
            "indicators": {"quote": [{"close": [100.0, 102.0], "volume": [10, 20]}], "adjclose": [{"adjclose": [99.0, 101.0]}]}}]}}
    class S:
        def get(self, *a, **k):
            return _Resp(200, body)
    df, meta = yahoo.fetch_history("X.NS", session=S())
    assert list(df["adj_close"]) == [99.0, 101.0] and meta["price_basis"] == "adjclose"
    class Blocked:
        def get(self, *a, **k):
            return _Resp(403)
    with pytest.raises(yahoo.DataUnavailable):
        yahoo.fetch_history("X.NS", session=Blocked(), retries=2, sleep=lambda s: None)


def test_sync_requires_service_key_and_ignores_duplicate_predictions(monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(sync.SyncError):
        sync.push_predictions([{"symbol": "A", "prediction_date": "2026-01-01"}])
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "svc")
    calls = []
    class S:
        def post(self, url, **k):
            calls.append((url, k))
            return _Resp(201)
    n = sync.push_predictions([{"symbol": "A", "prediction_date": "2026-01-01", "model_version": "v1.0", "status": "ok"}, {"symbol": "B"}], session=S())
    assert n == 1 and "ml_predictions" in calls[0][0]
    assert calls[0][1]["params"]["on_conflict"] == "symbol,prediction_date,model_version"
    assert "ignore-duplicates" in calls[0][1]["headers"]["Prefer"]


def test_edge_function_label_allowlist_matches_python_labels():
    """supabase/functions/_shared/ml.ts FEATURE_LABELS must mirror explain.LABELS (labels are never taken from the DB)."""
    import re
    from wealthfolio_ml.config import REPO_ROOT
    from wealthfolio_ml.explain import LABELS
    src = (REPO_ROOT / "supabase" / "functions" / "_shared" / "ml.ts").read_text(encoding="utf-8")
    block = src[src.index("FEATURE_LABELS"):src.index("};", src.index("FEATURE_LABELS"))]
    ts = dict(re.findall(r"^\s+(\w+): '([^']+)'", block, flags=re.M))
    assert set(ts) == set(FEATURES) == set(LABELS)
    assert all(ts[k] == LABELS[k][0] for k in ts)
