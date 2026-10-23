"""Single place for every tunable number in the ML pipeline.

Nothing here is hidden: blend weights, gates, thresholds and split rules are all documented and are
copied into every registered model's metadata so a model can be audited after the fact.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = ROOT / "artifacts"
DATA_CACHE_DIR = ROOT / "data_cache"
REPO_ROOT = ROOT.parent

TRADING_DAYS = 252
H3, H6 = 63, 126  # forward horizons in trading days (~3 and ~6 months)

# Bump when the feature list / definitions change. Becomes the MAJOR part of model_version (v<major>.<n>).
FEATURE_SET_VERSION = 1

# --------------------------------------------------------------------------------------
# Features. All are computed from data available on or before the observation date.
# --------------------------------------------------------------------------------------
TECHNICAL = ["rsi14", "dist_sma20", "dist_sma50", "dist_sma200", "sma50_over_sma200", "golden_cross",
             "macd_norm", "macd_hist_norm", "dist_ema50"]
MOMENTUM = ["ret_1m", "ret_3m", "ret_6m", "ret_12m_ex1m", "mom_accel"]
RISK = ["vol_21d", "vol_63d", "vol_252d", "downside_vol_63d", "max_dd_252d", "dd_from_high_252d",
        "sharpe_126d", "beta_252d", "range_pos_252d"]
VOLUME = ["volume_ratio_20_60"]
MARKET = ["bench_ret_3m", "bench_ret_6m", "bench_dist_sma200", "bench_vol_63d", "rel_strength_3m", "rel_strength_6m"]
FEATURES = TECHNICAL + MOMENTUM + RISK + VOLUME + MARKET

# Fundamental features are DELIBERATELY not trained on in v1: the market-data provider only exposes a
# *current* snapshot (no point-in-time history), so using it for historical rows would leak the future.
# Real point-in-time snapshots accumulate in `ml_fundamental_snapshots` (see supabase/migrations/..._ml.sql).
FUNDAMENTALS_PENDING = ["pe", "pb", "eps_growth", "revenue_growth", "roe", "roce", "debt_to_equity",
                        "profit_margin", "operating_margin", "free_cash_flow", "market_cap"]

# --------------------------------------------------------------------------------------
# Targets
# --------------------------------------------------------------------------------------
TARGETS = ["forward_return_3m", "forward_return_6m", "positive_3m", "positive_6m", "future_vol_3m", "future_drawdown_3m"]

# Benchmarks. Stocks are only ever compared with a benchmark from their own market.
BENCHMARKS = {"IN": "^NSEI", "US": "^GSPC"}


def market_of(symbol: str) -> str | None:
    s = symbol.upper()
    if s.endswith(".NS") or s.endswith(".BO"):
        return "IN"
    if "." not in s and not s.startswith("^"):
        return "US"
    return None  # other exchanges: no reliable benchmark configured -> market-context features stay null


# --------------------------------------------------------------------------------------
# Data quality
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class QualityConfig:
    min_rows: int = 600                 # price rows a symbol needs to be usable at all
    spike_return: float = 0.40          # |daily return| above this AND immediately reversed => bad tick, row dropped
    spike_reversal_tol: float = 0.10    # reversal must bring price back within 10% of the pre-spike level
    quarantine_return: float = 0.60     # any remaining |daily return| above this => symbol quarantined (likely unadjusted split)
    max_gap_days: int = 12              # calendar gap that is reported as a data hole
    stale_run: int = 10                 # identical consecutive closes flagged
    max_missing_feature_frac: float = 0.30  # training rows with more missing features than this are dropped
    stale_prediction_days: int = 10     # last bar older than this => prediction status "stale_data"


# --------------------------------------------------------------------------------------
# Dataset / splits
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class DatasetConfig:
    min_history_rows: int = 252         # an observation needs >= 1y of prior prices (252-day features)
    purge_calendar_days: int = 190      # ~126 trading days: label window of the longest horizon. Rows whose label
                                        # window could reach into the next split are removed (purge + embargo).
    val_months: int = 12
    test_months: int = 12
    wf_folds: int = 4                   # walk-forward folds for stability checks
    wf_test_months: int = 6


# Minimum data before we even try to claim a model. Below this: ML_STATUS = not_enough_data.
@dataclass(frozen=True)
class SufficiencyConfig:
    min_symbols: int = 30
    min_train_rows: int = 5000
    min_train_dates: int = 150          # distinct weekly dates in train (~3 years)
    min_val_rows: int = 1000
    min_test_rows: int = 1000
    min_class_count: int = 200          # positives AND negatives in each of train / val / test


# --------------------------------------------------------------------------------------
# Promotion gates: the ML model must demonstrate added value vs. the baselines, on BOTH the validation
# and the held-out test window, or it is NOT used (ML_STATUS = insufficient_evidence).
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class GateConfig:
    min_auc_edge: float = 0.01          # AUC must beat the best baseline by this much
    min_brier_edge: float = 0.0005      # Brier must beat base-rate AND rule baseline by this much
    max_ece: float = 0.08               # expected calibration error ceiling on test
    min_rank_ic: float = 0.0            # mean cross-sectional rank IC must be > this on val and test
    min_rel_rmse_gain: float = 0.005    # regression: RMSE must beat best baseline by 0.5%
    min_wf_win_frac: float = 0.60       # share of walk-forward folds where model beats base rate / baselines
    champion_margin_auc: float = 0.002  # challenger must beat champion's AUC by this on the same test window
    champion_margin_brier: float = 0.0002


# --------------------------------------------------------------------------------------
# Scores and blending (transparent + configurable). Copied into each model's registry entry.
# --------------------------------------------------------------------------------------
BLEND_WEIGHTS = {"rule": 0.60, "ml": 0.40}
ML_SCORE_SCALE = 200.0     # ml_score = clip(50 + SCALE * (p_blend - base_rate), 0, 100): +25pp over base rate -> 100
MIN_CONFIDENCE_FOR_BLEND = "medium"   # ML only enters the headline Intelligence score at/above this confidence

CONFIDENCE_WEIGHTS = {
    "data_completeness": 0.20,
    "history_depth": 0.10,
    "training_size": 0.10,
    "model_quality": 0.20,
    "model_agreement": 0.15,
    "in_distribution": 0.15,
    "prediction_stability": 0.10,
}
CONFIDENCE_THRESHOLDS = {"high": 0.75, "medium": 0.50}   # below medium => "low"


@dataclass(frozen=True)
class TrainProfile:
    """Model sizes. `fast` is for tests/CI; `full` for real training."""
    name: str = "full"
    rf_trees: int = 300
    rf_min_leaf: int = 50
    rf_depth: int = 8
    gb_iter: int = 200
    gb_depth: int = 3
    gb_lr: float = 0.05
    gb_min_leaf: int = 100
    seed: int = 42


FAST = TrainProfile(name="fast", rf_trees=60, rf_min_leaf=40, rf_depth=6, gb_iter=60, gb_depth=3, gb_lr=0.08, gb_min_leaf=60)
FULL = TrainProfile()


@dataclass(frozen=True)
class BacktestConfig:
    rebalance_weeks: int = 4            # cadence of new positions
    slots: int = 3                      # staggered slots => ~3 month hold (3 x 4 weeks ~= 63 trading days)
    top_frac: float = 0.20              # buy the top 20% by signal (min `min_names`)
    min_names: int = 5
    cost_bps_per_side: float = 15.0     # brokerage + taxes + slippage assumption, per side
    risk_free: float = 0.0              # Sharpe uses rf=0 (documented simplification)


BACKTEST_LABEL = "Historical simulation. Not a guarantee of future results."
PREDICTION_DISCLAIMER = "Model estimates based on historical relationships. Not investment advice and not a guarantee of future results."


def config_snapshot() -> dict:
    """Everything needed to audit how a model was produced."""
    return {
        "features": FEATURES,
        "fundamentals_pending": FUNDAMENTALS_PENDING,
        "targets": TARGETS,
        "horizons_trading_days": {"3m": H3, "6m": H6},
        "quality": asdict(QualityConfig()),
        "dataset": asdict(DatasetConfig()),
        "sufficiency": asdict(SufficiencyConfig()),
        "gates": asdict(GateConfig()),
        "blend_weights": BLEND_WEIGHTS,
        "ml_score_scale": ML_SCORE_SCALE,
        "min_confidence_for_blend": MIN_CONFIDENCE_FOR_BLEND,
        "confidence_weights": CONFIDENCE_WEIGHTS,
        "backtest": asdict(BacktestConfig()),
    }
