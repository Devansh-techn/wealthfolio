"""Candidate models and baselines. Explainable tabular models first (no deep nets).

Heads (what we predict):
  clf_3m / clf_6m : P(forward return > 0)                      -> calibrated probability
  reg_3m / reg_6m : expected forward return
  vol_3m          : future annualised volatility
  dd_3m           : future max drawdown (negative)
Baselines every ML candidate must beat (see config.GateConfig): training base rate / mean, the price-only
port of the EXISTING rule score (Platt/linear mapped), and for risk heads volatility/drawdown persistence.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .config import FEATURES, TrainProfile


@dataclass(frozen=True)
class HeadSpec:
    name: str
    kind: str      # "clf" | "reg"
    target: str
    horizon: str


HEADS = [
    HeadSpec("clf_3m", "clf", "positive_3m", "3m"),
    HeadSpec("clf_6m", "clf", "positive_6m", "6m"),
    HeadSpec("reg_3m", "reg", "forward_return_3m", "3m"),
    HeadSpec("reg_6m", "reg", "forward_return_6m", "6m"),
    HeadSpec("vol_3m", "reg", "future_vol_3m", "3m"),
    HeadSpec("dd_3m", "reg", "future_drawdown_3m", "3m"),
]
HEAD_BY_NAME = {h.name: h for h in HEADS}


class Select(BaseEstimator, TransformerMixin):
    def __init__(self, columns=None):
        self.columns = columns

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return X[list(self.columns)]


class ConstantBaseline(BaseEstimator):
    """Historical base rate (clf) or historical mean (reg) from the TRAIN split."""
    def __init__(self, kind="clf"):
        self.kind = kind

    def fit(self, X, y):
        self.value_ = float(np.mean(y))
        return self

    def predict(self, X):
        return np.full(len(X), self.value_)

    def predict_proba(self, X):
        return np.column_stack([1 - np.full(len(X), self.value_), np.full(len(X), self.value_)])


class SingleFeatureBaseline(BaseEstimator):
    """One-feature model (rule score or persistence) fitted on TRAIN: logistic for clf, OLS for reg."""
    def __init__(self, feature="rule_score_price_only", kind="clf"):
        self.feature = feature
        self.kind = kind

    def _x(self, X):
        v = X[self.feature].to_numpy(float)
        return np.where(np.isnan(v), self.med_, v).reshape(-1, 1)

    def fit(self, X, y):
        v = X[self.feature].to_numpy(float)
        self.med_ = float(np.nanmedian(v)) if np.isfinite(v).any() else 0.0
        self.mu_, self.sd_ = float(np.mean(self._x(X))), float(np.std(self._x(X))) or 1.0
        xs = (self._x(X) - self.mu_) / self.sd_
        self.m_ = LogisticRegression(C=10.0) if self.kind == "clf" else LinearRegression()
        self.m_.fit(xs, y)
        return self

    def predict(self, X):
        return self.m_.predict((self._x(X) - self.mu_) / self.sd_)

    def predict_proba(self, X):
        return self.m_.predict_proba((self._x(X) - self.mu_) / self.sd_)


class ClippedTarget(BaseEstimator):
    """Fit on a winsorised target (1%/99%) so extreme outcomes do not dominate; evaluation uses raw targets."""
    def __init__(self, estimator=None, q=0.01):
        self.estimator = estimator
        self.q = q

    def fit(self, X, y):
        lo, hi = np.quantile(y, [self.q, 1 - self.q])
        self.estimator.fit(X, np.clip(y, lo, hi))
        return self

    def predict(self, X):
        return self.estimator.predict(X)


class PlattCalibrator:
    """Sigmoid calibration p -> logistic(a*logit(p)+b), fitted on the VALIDATION split only."""
    def fit(self, p, y):
        z = self._logit(p).reshape(-1, 1)
        self.lr_ = LogisticRegression(C=1e6, max_iter=500).fit(z, y)
        return self

    @staticmethod
    def _logit(p):
        p = np.clip(np.asarray(p, float), 1e-4, 1 - 1e-4)
        return np.log(p / (1 - p))

    def transform(self, p):
        return self.lr_.predict_proba(self._logit(p).reshape(-1, 1))[:, 1]


def _lightgbm():
    try:
        import lightgbm  # noqa: F401
        return lightgbm
    except Exception:
        return None


def ml_candidates(kind: str, p: TrainProfile) -> dict:
    sel = lambda: ("sel", Select(FEATURES))  # noqa: E731
    imp = lambda: ("imp", SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=True))  # noqa: E731
    out: dict = {}
    if kind == "clf":
        out["logistic"] = Pipeline([sel(), imp(), ("sc", StandardScaler()), ("m", LogisticRegression(C=0.05, max_iter=1000))])
        out["random_forest"] = Pipeline([sel(), ("imp", SimpleImputer(strategy="median", keep_empty_features=True)),
                                         ("m", RandomForestClassifier(n_estimators=p.rf_trees, min_samples_leaf=p.rf_min_leaf, max_depth=p.rf_depth, max_features="sqrt", n_jobs=-1, random_state=p.seed))])
        out["hist_gb"] = Pipeline([sel(), ("m", HistGradientBoostingClassifier(max_depth=p.gb_depth, learning_rate=p.gb_lr, max_iter=p.gb_iter, min_samples_leaf=p.gb_min_leaf, l2_regularization=1.0, random_state=p.seed))])
        lgb = _lightgbm()
        if lgb:
            out["lightgbm"] = Pipeline([sel(), ("m", lgb.LGBMClassifier(n_estimators=p.gb_iter, learning_rate=p.gb_lr, num_leaves=2 ** p.gb_depth, min_child_samples=p.gb_min_leaf, reg_lambda=1.0, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=p.seed, verbose=-1))])
    else:
        out["ridge"] = ClippedTarget(Pipeline([sel(), imp(), ("sc", StandardScaler()), ("m", Ridge(alpha=200.0))]))
        out["random_forest"] = ClippedTarget(Pipeline([sel(), ("imp", SimpleImputer(strategy="median", keep_empty_features=True)),
                                                       ("m", RandomForestRegressor(n_estimators=p.rf_trees, min_samples_leaf=p.rf_min_leaf, max_depth=p.rf_depth, max_features="sqrt", n_jobs=-1, random_state=p.seed))]))
        out["hist_gb"] = ClippedTarget(Pipeline([sel(), ("m", HistGradientBoostingRegressor(max_depth=p.gb_depth, learning_rate=p.gb_lr, max_iter=p.gb_iter, min_samples_leaf=p.gb_min_leaf, l2_regularization=1.0, random_state=p.seed))]))
        lgb = _lightgbm()
        if lgb:
            out["lightgbm"] = ClippedTarget(Pipeline([sel(), ("m", lgb.LGBMRegressor(n_estimators=p.gb_iter, learning_rate=p.gb_lr, num_leaves=2 ** p.gb_depth, min_child_samples=p.gb_min_leaf, reg_lambda=1.0, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, random_state=p.seed, verbose=-1))]))
    return out


def baselines(head: HeadSpec) -> dict:
    if head.kind == "clf":
        return {"base_rate": ConstantBaseline("clf"), "rule_score": SingleFeatureBaseline("rule_score_price_only", "clf")}
    b = {"train_mean": ConstantBaseline("reg")}
    if head.name == "vol_3m":
        b["persistence_vol_63d"] = SingleFeatureBaseline("vol_63d", "reg")
    elif head.name == "dd_3m":
        b["persistence_max_dd_252d"] = SingleFeatureBaseline("max_dd_252d", "reg")
    else:
        b["rule_score"] = SingleFeatureBaseline("rule_score_price_only", "reg")
    return b


def predict_head(est, X: pd.DataFrame, kind: str) -> np.ndarray:
    return est.predict_proba(X)[:, 1] if kind == "clf" else est.predict(X)
