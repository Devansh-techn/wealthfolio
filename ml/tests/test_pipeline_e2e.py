"""End-to-end behaviour on SYNTHETIC data. These tests verify MECHANICS and HONESTY, never model quality:
  * too little data              -> ml_status "not_enough_data", nothing registered
  * pure noise                   -> ml_status "insufficient_evidence", model registered as REJECTED (never production)
  * gates relaxed (plumbing only)-> artifact/registry/inference/backtest work and are versioned & hash-verified
  * second, non-better model     -> champion is kept
"""
import json
import warnings

import joblib
import numpy as np
import pandas as pd
import pytest

from synthetic import make_universe
from wealthfolio_ml.config import FAST, GateConfig
from wealthfolio_ml.predict import Predictor
from wealthfolio_ml.registry import ModelRegistry
from wealthfolio_ml.train import train_pipeline

warnings.filterwarnings("ignore")
PLUMBING_ONLY = GateConfig(min_auc_edge=-1, min_brier_edge=-1, max_ece=1, min_rank_ic=-1, min_rel_rmse_gain=-1, min_wf_win_frac=0)


@pytest.fixture(scope="module")
def universe():
    return make_universe(20, 3000, seed=7)


def test_not_enough_data_registers_nothing(tmp_path):
    tiny = make_universe(3, 1500, seed=1)
    reg = ModelRegistry(tmp_path)
    rep = train_pipeline(tiny, FAST, registry=reg)
    assert rep["ml_status"] == "not_enough_data" and rep["reasons"]
    assert reg.entries() == [] and reg.production() is None


def test_no_data_at_all_is_not_enough_data(tmp_path):
    assert train_pipeline({}, FAST, registry=ModelRegistry(tmp_path))["ml_status"] == "not_enough_data"


def test_noise_is_rejected_not_promoted(universe, tmp_path):
    reg = ModelRegistry(tmp_path)
    rep = train_pipeline(universe, FAST, registry=reg)
    assert rep["ml_status"] == "insufficient_evidence"
    assert rep["heads"]["clf_3m"]["accepted"] is False and rep["heads"]["clf_3m"]["reasons_rejected"]
    e = reg.entries()
    assert len(e) == 1 and e[0]["status"] == "rejected" and reg.production() is None
    assert "did not demonstrate added value" in e[0]["decision_reason"]
    # reports never contain training-only accuracy as the headline: validation AND test blocks are present for baselines + model
    h = rep["heads"]["clf_3m"]
    assert {"base_rate", "rule_score"} <= set(h["test"]) and {"base_rate", "rule_score"} <= set(h["validation"])
    assert rep["split"]["val_start"] < rep["split"]["test_start"]


@pytest.fixture(scope="module")
def trained(universe, tmp_path_factory):
    root = tmp_path_factory.mktemp("reg")
    reg = ModelRegistry(root)
    rep = train_pipeline(universe, FAST, registry=reg, gates=PLUMBING_ONLY)
    return reg, rep, universe


def test_registration_metadata_is_complete(trained):
    reg, rep, _ = trained
    assert rep["ml_status"] == "ok"
    e = reg.production()
    assert e["version"] == "v1.0" and e["status"] == "production"
    for k in ("model_type", "training_start", "training_end", "features", "target", "metrics", "created_at", "artifact_sha256", "dataset_hash", "blend_weights", "validation_start", "test_start"):
        assert e[k], k
    assert e["training_end"] < e["validation_start"] < e["test_start"]
    assert e["blend_weights"] == {"rule": 0.6, "ml": 0.4}
    assert "Historical simulation. Not a guarantee of future results." == e["backtest"]["label"]


def test_backtests_use_matching_benchmarks_and_are_labelled(trained):
    _, rep, _ = trained
    bt = rep["backtest"]
    assert bt["IN"]["benchmark_symbol"] == "^NSEI" and bt["US"]["benchmark_symbol"] == "^GSPC"
    for mk in ("IN", "US"):
        for k in ("ml_top20", "rule_score_top20", "equal_weight_universe"):
            r = bt[mk][k]
            assert r["status"] == "ok" and r["label"].startswith("Historical simulation")
            assert {"cumulative_return", "max_drawdown", "sharpe", "annualised_volatility"} <= set(r["strategy"])
            assert 0 <= r["avg_turnover"] <= 1 and "benchmark" in r and "hit_rate_vs_benchmark" in r


def test_serialization_load_and_inference_record(trained):
    reg, _, u = trained
    e = reg.production()
    pred = Predictor.load(e, reg)
    today = pd.Timestamp(u["SYNIN0.NS"]["date"].iloc[-1]) + pd.Timedelta(days=1)
    recs = pred.predict_symbols({k: v for k, v in u.items() if k in ("SYNIN0.NS", "SYNUS1", "^NSEI", "^GSPC")}, today=today)
    assert {r["symbol"] for r in recs} == {"SYNIN0.NS", "SYNUS1"}
    r = recs[0]
    assert r["status"] == "ok" and r["model_version"] == "v1.0"
    for k in ("positive_3m_probability", "positive_6m_probability"):
        assert 0 <= r[k] <= 1
    assert 0 <= r["ml_score"] <= 100 and 0 <= r["confidence"] <= 1 and r["confidence_label"] in ("high", "medium", "low")
    assert r["risk_level"] in ("low", "moderate", "high")
    assert set(r["confidence_components"]) == {"data_completeness", "history_depth", "training_size", "model_quality", "model_agreement", "in_distribution", "prediction_stability"}
    assert "do not imply causation" in r["factor_note"] and "Not investment advice" in r["disclaimer"]
    json.dumps(recs, default=str)       # API-safe


def test_inference_is_deterministic(trained):
    reg, _, u = trained
    pred = Predictor.load(reg.production(), reg)
    today = pd.Timestamp(u["SYNIN0.NS"]["date"].iloc[-1]) + pd.Timedelta(days=1)
    frames = {k: v for k, v in u.items() if k in ("SYNIN2.NS", "^NSEI")}
    a, b = pred.predict_symbols(frames, today=today), pred.predict_symbols(frames, today=today)
    assert a == b


def test_missing_and_short_data_degrade_gracefully(trained):
    reg, _, u = trained
    pred = Predictor.load(reg.production(), reg)
    today = pd.Timestamp(u["SYNIN0.NS"]["date"].iloc[-1]) + pd.Timedelta(days=1)
    short = u["SYNIN3.NS"].iloc[-700:].copy()
    short = short.iloc[-200:]
    stale = u["SYNIN4.NS"].copy()
    recs = {r["symbol"]: r for r in pred.predict_symbols({"SYNIN3.NS": short, "SYNIN4.NS": stale, "NOPE.NS": u["SYNIN4.NS"].iloc[:50], "^NSEI": u["^NSEI"]}, today=today)}
    assert recs["NOPE.NS"]["status"] == "unavailable"                     # failed validation -> explicit status, no fabricated numbers
    assert recs["SYNIN3.NS"]["status"] in ("unavailable", "insufficient_history") and "positive_3m_probability" not in recs["SYNIN3.NS"]
    stale_recs = pred.predict_symbols({"SYNIN4.NS": stale, "^NSEI": u["^NSEI"]}, today=today + pd.Timedelta(days=60))
    assert stale_recs[0]["status"] == "stale_data"


def test_tampered_artifact_refuses_to_load(trained):
    reg, _, _ = trained
    e = reg.production()
    path = reg.root / e["artifact_path"]
    original = path.read_bytes()
    try:
        path.write_bytes(original + b"x")
        with pytest.raises(RuntimeError, match="hash mismatch"):
            Predictor.load(e, reg)
    finally:
        path.write_bytes(original)
    assert Predictor.load(e, reg).version == "v1.0"


def test_versions_are_immutable_and_challenger_that_is_not_better_is_rejected(trained, tmp_path):
    reg, _, u = trained
    with pytest.raises(ValueError, match="already registered"):
        reg.add(reg.production(), "candidate", "dup")
    before = reg.production()["version"]
    rep = train_pipeline(u, FAST, registry=reg, gates=PLUMBING_ONLY)      # identical data+settings => cannot beat the champion by the margin
    assert rep["champion_comparison"]["promote"] is False
    assert reg.production()["version"] == before == "v1.0"                # KEEP CURRENT MODEL
    assert [e["status"] for e in reg.entries()] == ["production", "rejected"]
    assert reg.entries()[1]["version"] == "v1.1" and "keeping champion" in reg.entries()[1]["decision_reason"]
