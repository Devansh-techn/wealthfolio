"""Inference. Loads a registered, hash-verified artifact and produces STANDARDISED prediction records.

Used by (a) the CLI `predict`, (b) train.py for the held-out backtest — so backtests exercise the exact code
path that production uses. Every record carries `model_version`; nothing is overwritten across versions.
"""
from __future__ import annotations

from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd

from .config import (BENCHMARKS, FEATURES, ML_SCORE_SCALE, PREDICTION_DISCLAIMER, QualityConfig, market_of)
from .confidence import agreement, compute_confidence, in_distribution, model_quality, stability
from .data.validation import validate_prices
from .explain import occlusion_factors
from .features import compute_features, completeness, rule_score_series
from .registry import ModelRegistry

RULE_RISK = [(0.20, "low"), (0.35, "moderate")]  # fallback thresholds on 1y volatility when the ML risk head is not accepted


def _risk_from_vol(v: float, cuts: list[float]) -> str:
    return "low" if v < cuts[0] else "moderate" if v < cuts[1] else "high"


class Predictor:
    def __init__(self, artifact: dict):
        self.art = artifact
        self.version = artifact["version"]

    @classmethod
    def load(cls, entry: dict, registry: ModelRegistry) -> "Predictor":
        return cls(joblib.load(registry.verified_artifact_path(entry)))

    # ---------------------------------------------------------------- vectorised core
    def _head(self, name: str):
        h = self.art["heads"].get(name)
        return h if h and h.get("accepted") and h.get("model") is not None else None

    @staticmethod
    def _p(h, X: pd.DataFrame, raw: bool = False) -> np.ndarray:
        p = h["model"].predict_proba(X)[:, 1]
        return p if raw or h.get("calibrator") is None else h["calibrator"].transform(p)

    def predict_frame(self, X: pd.DataFrame) -> pd.DataFrame:
        out = pd.DataFrame(index=X.index)
        for name in ("clf_3m", "clf_6m"):
            h = self._head(name)
            out["p" + name[-2:]] = self._p(h, X) if h else np.nan
        for name, col in (("reg_3m", "er3m"), ("reg_6m", "er6m"), ("vol_3m", "vol3m"), ("dd_3m", "dd3m")):
            h = self._head(name)
            out[col] = h["model"].predict(X) if h else np.nan
        out["ml_score"] = self.ml_score(out)
        return out

    def ml_score(self, pred: pd.DataFrame) -> np.ndarray:
        """clip(50 + SCALE*(mean accepted calibrated P(+) - base rate), 0, 100): a stock at the historical base rate scores 50."""
        cols, bases = [], []
        for c, b in (("p3m", "3m"), ("p6m", "6m")):
            if pred[c].notna().any():
                cols.append(c)
                bases.append(self.art["base_rates"][b])
        if not cols:
            return np.full(len(pred), np.nan)
        p = pred[cols].mean(axis=1).to_numpy()
        return np.clip(50 + self.art.get("ml_score_scale", ML_SCORE_SCALE) * (p - float(np.mean(bases))), 0, 100)

    def risk_level(self, vol_pred: float, vol_1y: float) -> tuple[str, str]:
        if not np.isnan(vol_pred):
            return _risk_from_vol(vol_pred, self.art["risk_cuts"]["vol_3m"]), "ml"
        if not np.isnan(vol_1y):
            return _risk_from_vol(vol_1y, [r[0] for r in RULE_RISK]), "rule"
        return "unknown", "none"

    # ---------------------------------------------------------------- per-symbol records
    def record(self, symbol: str, feats: pd.DataFrame, n_obs: int, last_date: pd.Timestamp, today: pd.Timestamp | None = None,
               qcfg: QualityConfig = QualityConfig()) -> dict:
        """feats: the symbol's feature rows (ascending); the LAST row is the prediction date."""
        today = (today or pd.Timestamp.now(tz="UTC").tz_localize(None)).normalize()
        base = {"symbol": symbol, "prediction_date": str(last_date.date()), "model_version": self.version, "disclaimer": PREDICTION_DISCLAIMER}
        last = feats.iloc[-1]
        comp_ = float(completeness(last))
        if n_obs < 252 + 1:
            return {**base, "status": "insufficient_history", "detail": f"{n_obs} price rows; at least 252 required"}
        if comp_ < 0.5:
            return {**base, "status": "low_quality", "detail": f"only {comp_:.0%} of model inputs available"}
        if (today - last_date).days > qcfg.stale_prediction_days:
            return {**base, "status": "stale_data", "detail": f"latest price is from {last_date.date()}"}
        X = feats.tail(11)
        pred = self.predict_frame(X)
        cur = pred.iloc[-1]
        clf = self._head("clf_3m")
        peers = [m.predict_proba(X.iloc[[-1]])[:, 1][0] for m in (clf.get("peers") or {}).values()] if clf else []
        hist = list(self._p(clf, X.iloc[[-1, -6, -11]] if len(X) >= 11 else X, raw=True)) if clf else []
        risk, risk_src = self.risk_level(float(cur["vol3m"]), float(last["vol_252d"]))
        quality = self.art["quality"]
        conf = compute_confidence({
            "data_completeness": comp_,
            "history_depth": min(1.0, n_obs / 504),
            "training_size": min(1.0, self.art["n_train"] / 50_000),
            "model_quality": model_quality(quality.get("clf_3m_test")),
            "model_agreement": agreement(peers),
            "in_distribution": in_distribution(last, self.art["train_stats"]),
            "prediction_stability": stability(hist),
        }, comp_, n_obs)
        factors = {"positive": [], "negative": []}
        if clf:
            factors = occlusion_factors(lambda M: clf["model"].predict_proba(M)[:, 1], last, {k: (v or {}).get("median") for k, v in self.art["train_stats"].items()})
        nn = lambda v: None if v is None or (isinstance(v, float) and np.isnan(v)) else float(v)  # noqa: E731
        return {
            **base, "status": "ok",
            "positive_3m_probability": nn(cur["p3m"]), "positive_6m_probability": nn(cur["p6m"]),
            "expected_3m_return": nn(cur["er3m"]), "expected_6m_return": nn(cur["er6m"]),
            "expected_volatility_3m": nn(cur["vol3m"]), "expected_drawdown_3m": nn(cur["dd3m"]),
            "risk_level": risk, "risk_source": risk_src,
            "ml_score": nn(cur["ml_score"]),
            "confidence": conf["score"], "confidence_label": conf["label"], "confidence_components": conf["components"], "confidence_caps": conf["caps"],
            "data_completeness": round(comp_, 4),
            "top_positive_factors": factors["positive"], "top_negative_factors": factors["negative"],
            "factor_note": "These features were influential in the model's estimate. They do not imply causation.",
        }

    def predict_symbols(self, price_frames: dict[str, pd.DataFrame], today: pd.Timestamp | None = None) -> list[dict]:
        qcfg = QualityConfig()
        clean = {}
        for s, raw in price_frames.items():
            c, rep = validate_prices(raw, s, qcfg, today=today)
            if c is not None:
                clean[s] = c
        bench = {m: clean[b]["adj_close"] for m, b in BENCHMARKS.items() if b in clean}
        out = []
        for s, raw in price_frames.items():
            if s in BENCHMARKS.values():
                continue
            if s not in clean:
                out.append({"symbol": s, "model_version": self.version, "status": "unavailable", "detail": "price history unavailable or failed data validation"})
                continue
            c = clean[s]
            f = compute_features(c, bench.get(market_of(s)))
            out.append(self.record(s, f, len(c), c.index[-1], today, qcfg))
        return out
