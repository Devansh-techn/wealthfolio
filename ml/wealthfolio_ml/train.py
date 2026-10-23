"""Offline training pipeline (Phases B-G, M).

    prices -> validation -> features/targets -> chronological split (purged) -> baselines + candidates ->
    validation-based selection -> calibration (validation) -> held-out TEST + walk-forward -> promotion gates ->
    backtest (test window) -> artifact + registry entry

If the data are not sufficient the pipeline stops with ml_status = "not_enough_data" and registers NOTHING.
If a model is trained but does not demonstrably beat the baselines it is registered as `rejected` and
ml_status = "insufficient_evidence" — it is never promoted.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone

from . import __version__
from .backtest import run_backtest
from .config import (ARTIFACT_DIR, BACKTEST_LABEL, BENCHMARKS, BLEND_WEIGHTS, FEATURES, FEATURE_SET_VERSION, FULL, H3, DatasetConfig,
                     GateConfig, SufficiencyConfig, TrainProfile, BacktestConfig, ML_SCORE_SCALE, MIN_CONFIDENCE_FOR_BLEND, config_snapshot, market_of)
from .confidence import training_stats
from .dataset import build_panel
from .evaluate import by_group, by_year, clf_metrics, rank_ic, reg_metrics
from .explain import global_importance
from .models import HEADS, PlattCalibrator, baselines, ml_candidates, predict_head
from .predict import Predictor
from .regimes import assign_regimes
from .registry import ModelRegistry, sha256_file
from .splits import SplitSpec, apply_split, auto_split, walk_forward_folds

NUM = (int, float, np.floating)


def _clean(o):
    """JSON-safe: NaN -> None, numpy -> python."""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return str(o)
    return o


def sufficiency_reasons(panel: pd.DataFrame, parts: dict[str, pd.DataFrame], cfg: SufficiencyConfig = SufficiencyConfig()) -> list[str]:
    r = []
    n_sym = panel["symbol"].nunique() if len(panel) else 0
    if n_sym < cfg.min_symbols:
        r.append(f"only {n_sym} usable symbols (need >= {cfg.min_symbols})")
    for name, need in (("train", cfg.min_train_rows), ("val", cfg.min_val_rows), ("test", cfg.min_test_rows)):
        d = parts[name].dropna(subset=["positive_3m", "positive_6m"])
        if len(d) < need:
            r.append(f"{name} split has {len(d)} labelled rows (need >= {need})")
        if len(d) and min(int(d["positive_3m"].sum()), int((1 - d["positive_3m"]).sum())) < cfg.min_class_count:
            r.append(f"{name} split has fewer than {cfg.min_class_count} rows in one outcome class")
    if parts["train"]["grid_date"].nunique() < cfg.min_train_dates:
        r.append(f"train spans only {parts['train']['grid_date'].nunique()} weekly dates (need >= {cfg.min_train_dates})")
    return r


def _fit_eval_head(head, tr, va, te, profile: TrainProfile, gates: GateConfig) -> dict:
    """Fit baselines + candidates on TRAIN, select on VALIDATION, calibrate on VALIDATION, report on TEST."""
    t = head.target
    tr, va, te = tr.dropna(subset=[t]), va.dropna(subset=[t]), te.dropna(subset=[t])
    y_tr = tr[t].to_numpy(float)
    fitted = {n: m.fit(tr, y_tr) for n, m in {**baselines(head), **ml_candidates(head.kind, profile)}.items()}
    base_names = list(baselines(head))
    train_mean = float(y_tr.mean())

    def metrics(df, preds: dict) -> dict:
        if head.kind == "clf":
            ret = "forward_return_3m" if head.horizon == "3m" else "forward_return_6m"
            return {n: clf_metrics(df, t, ret, p, train_mean) for n, p in preds.items()}
        return {n: reg_metrics(df, t, p, train_mean) for n, p in preds.items()}

    val_preds = {n: predict_head(m, va, head.kind) for n, m in fitted.items()}
    val_m = metrics(va, val_preds)
    key = "roc_auc" if head.kind == "clf" else "rmse"
    ml_names = [n for n in fitted if n not in base_names]
    score = lambda n: val_m[n].get(key, np.nan)  # noqa: E731
    sel = max(ml_names, key=lambda n: -np.inf if np.isnan(score(n)) else score(n)) if head.kind == "clf" else min(ml_names, key=lambda n: np.inf if np.isnan(score(n)) else score(n))

    calibrator = None
    if head.kind == "clf":
        calibrator = PlattCalibrator().fit(val_preds[sel], va[t].to_numpy(float))
    test_raw = {n: predict_head(m, te, head.kind) for n, m in fitted.items()}
    test_preds = {n: (calibrator.transform(p) if (calibrator and n == sel) else p) for n, p in test_raw.items()}
    test_m = metrics(te, test_preds)
    val_cal = dict(val_preds)
    if calibrator:
        val_cal[sel] = calibrator.transform(val_preds[sel])   # NOTE: optimistic (calibrator fitted on val); used for display only
    return {"head": head, "fitted": fitted, "selected": sel, "calibrator": calibrator, "base_names": base_names, "train_mean": train_mean,
            "val": val_m, "test": test_m, "val_pred_sel": val_preds[sel], "test_pred_sel": test_preds[sel], "n": {"train": len(tr), "val": len(va), "test": len(te)}, "frames": (tr, va, te)}


def _gate(res: dict, gates: GateConfig) -> tuple[bool, list[str]]:
    """Validation + test criteria (walk-forward is added by the caller)."""
    head, sel, why = res["head"], res["selected"], []
    for split in ("val", "test"):
        m, base = res[split][sel], [res[split][b] for b in res["base_names"]]
        if head.kind == "clf":
            best_auc = max([b.get("roc_auc", 0.5) for b in base if not np.isnan(b.get("roc_auc", np.nan))] + [0.5])
            if not m.get("roc_auc", 0) >= best_auc + gates.min_auc_edge:
                why.append(f"{split}: ROC-AUC {m.get('roc_auc', float('nan')):.3f} does not beat best baseline {best_auc:.3f} by {gates.min_auc_edge}")
            best_brier = min(b["brier"] for b in base)
            if not m.get("brier", 1) <= best_brier - gates.min_brier_edge:
                why.append(f"{split}: Brier {m.get('brier', float('nan')):.4f} does not beat best baseline {best_brier:.4f}")
            if not (m["rank_ic"]["mean"] > gates.min_rank_ic):
                why.append(f"{split}: mean rank IC {m['rank_ic']['mean']:.3f} not positive")
            if split == "test" and not m.get("ece", 1) <= gates.max_ece:
                why.append(f"test: calibration error {m['ece']:.3f} above {gates.max_ece}")
        else:
            best = min(b["rmse"] for b in base)
            if not m.get("rmse", 9) <= best * (1 - gates.min_rel_rmse_gain):
                why.append(f"{split}: RMSE {m.get('rmse', float('nan')):.4f} does not beat best baseline {best:.4f} by {gates.min_rel_rmse_gain:.1%}")
            if head.name in ("reg_3m", "reg_6m") and not (m["rank_ic"]["mean"] > gates.min_rank_ic):
                why.append(f"{split}: mean rank IC {m['rank_ic']['mean']:.3f} not positive")
    return (not why), why


def _walk_forward(res: dict, full: pd.DataFrame, ds_cfg: DatasetConfig, gates: GateConfig) -> dict:
    head, sel = res["head"], res["selected"]
    t = head.target
    wins, folds = 0, []
    for name, tr, te in walk_forward_folds(full, ds_cfg, min_train_rows=1000):
        tr, te = tr.dropna(subset=[t]), te.dropna(subset=[t])
        if len(tr) < 1000 or len(te) < 100:
            continue
        est = clone(res["fitted"][sel]).fit(tr, tr[t].to_numpy(float))
        mean = float(tr[t].mean())
        bs = {n: clone(res["fitted"][n]).fit(tr, tr[t].to_numpy(float)) for n in res["base_names"]}
        if head.kind == "clf":
            ret = "forward_return_3m" if head.horizon == "3m" else "forward_return_6m"
            m = clf_metrics(te, t, ret, predict_head(est, te, "clf"), mean)
            b_auc = max([clf_metrics(te, t, ret, predict_head(b, te, "clf"), mean).get("roc_auc", 0.5) for b in bs.values()] + [0.5])
            win = bool(m.get("roc_auc", 0) > b_auc)
            folds.append({"fold": name, "roc_auc": m.get("roc_auc"), "best_baseline_auc": b_auc, "rank_ic": m["rank_ic"]["mean"], "win": win})
        else:
            m = reg_metrics(te, t, predict_head(est, te, "reg"), mean)
            b_rmse = min(reg_metrics(te, t, predict_head(b, te, "reg"), mean)["rmse"] for b in bs.values())
            win = bool(m["rmse"] < b_rmse)
            folds.append({"fold": name, "rmse": m["rmse"], "best_baseline_rmse": b_rmse, "win": win})
        wins += win
    frac = wins / len(folds) if folds else float("nan")
    return {"folds": folds, "win_frac": frac, "passed": bool(folds and frac >= gates.min_wf_win_frac)}


def _backtests(predictor: Predictor, test: pd.DataFrame, clean: dict, cfg: BacktestConfig) -> dict:
    out = {}
    pred = predictor.predict_frame(test)
    sig = test[["symbol", "market", "grid_date", "rule_score_price_only"]].copy()
    sig["ml"] = pred["p3m"].to_numpy() if pred["p3m"].notna().any() else pred["ml_score"].to_numpy()
    for mk, bsym in BENCHMARKS.items():
        s = sig[sig["market"] == mk]
        if s["symbol"].nunique() < 8 or bsym not in clean:
            continue
        px = pd.DataFrame({sym: clean[sym]["adj_close"] for sym in s["symbol"].unique() if sym in clean})
        bench = clean[bsym]["adj_close"]
        res = {
            "ml_top20": run_backtest(px, s.rename(columns={"ml": "score"})[["symbol", "grid_date", "score"]], bench, cfg),
            "rule_score_top20": run_backtest(px, s.rename(columns={"rule_score_price_only": "score"})[["symbol", "grid_date", "score"]], bench, cfg),
            "equal_weight_universe": run_backtest(px, s.assign(score=1.0)[["symbol", "grid_date", "score"]], bench, cfg, top_frac=1.0),
        }
        out[mk] = {"benchmark_symbol": bsym, "label": BACKTEST_LABEL, **res}
    return out


def compare_with_champion(challenger: Predictor, champion: Predictor, test: pd.DataFrame, gates: GateConfig) -> dict:
    """Both models predict the SAME test rows. (If the champion's training window overlaps this test window the
    comparison favours the champion, which is the conservative direction.)"""
    from sklearn.metrics import brier_score_loss, roc_auc_score
    t = test.dropna(subset=["positive_3m"])
    y = t["positive_3m"].to_numpy(float)
    out = {}
    for name, pr in (("challenger", challenger), ("champion", champion)):
        p = pr.predict_frame(t)["p3m"].to_numpy()
        if np.isnan(p).any():
            return {"promote": name == "challenger", "reason": f"{name} has no accepted 3m classifier"}
        out[name] = {"auc": float(roc_auc_score(y, p)), "brier": float(brier_score_loss(y, p)), "rank_ic": rank_ic(t, p, "forward_return_3m")["mean"]}
    c, h = out["challenger"], out["champion"]
    win = (c["auc"] >= h["auc"] + gates.champion_margin_auc) and (c["brier"] <= h["brier"] - gates.champion_margin_brier)
    return {"promote": bool(win), "challenger": c, "champion": h,
            "reason": ("challenger beat champion on AUC and Brier" if win else f"challenger did not beat champion {champion.version} by the required margin (AUC {c['auc']:.3f} vs {h['auc']:.3f}, Brier {c['brier']:.4f} vs {h['brier']:.4f}) — keeping champion")}


def train_pipeline(price_frames: dict[str, pd.DataFrame], profile: TrainProfile = FULL, split: SplitSpec | None = None,
                   registry: ModelRegistry | None = None, register: bool = True, ds_cfg: DatasetConfig = DatasetConfig(),
                   suff: SufficiencyConfig = SufficiencyConfig(), gates: GateConfig = GateConfig(), bt_cfg: BacktestConfig = BacktestConfig(),
                   version_hint: str | None = None) -> dict:
    registry = registry or ModelRegistry()
    report: dict = {"code_version": __version__, "profile": profile.name, "started_at": datetime.now(timezone.utc).isoformat(), "config": config_snapshot()}
    panel, info = build_panel(price_frames, ds_cfg)
    report["data_quality"] = {"quarantined": info["quarantined"], "dataset": info["dataset"],
                              "symbols_in": len([s for s in price_frames if s not in BENCHMARKS.values()])}
    if panel.empty:
        report.update(ml_status="not_enough_data", reasons=["no usable price data"])
        return _clean(report)
    panel = panel[panel["completeness"] >= 1 - 0.30].reset_index(drop=True)
    labelled = panel.dropna(subset=["forward_return_6m"])
    if labelled.empty:
        report.update(ml_status="not_enough_data", reasons=["no rows with a 6-month forward label"])
        return _clean(report)
    split = split or auto_split(panel, ds_cfg)
    parts = apply_split(panel, split)
    report["split"] = split.as_dict()
    reasons = sufficiency_reasons(panel, parts, suff)
    report["rows"] = {k: len(v) for k, v in parts.items()}
    if reasons:
        report.update(ml_status="not_enough_data", reasons=reasons)
        return _clean(report)

    tr, va, te = parts["train"], parts["val"], parts["test"]
    te = assign_regimes(te, float(tr["bench_vol_63d"].median()))
    results = {}
    for head in HEADS:
        results[head.name] = r = _fit_eval_head(head, tr, va, te, profile, gates)
        ok, why = _gate(r, gates)
        r["accepted"], r["why"] = ok, why
        if ok:
            wf = _walk_forward(r, panel, ds_cfg, gates)
            r["wf"] = wf
            if not wf["passed"]:
                r["accepted"] = False
                r["why"].append(f"walk-forward: model beat baselines in {wf['win_frac']:.0%} of folds (need >= {gates.min_wf_win_frac:.0%})")

    primary = results["clf_3m"]
    ml_status = "ok" if primary["accepted"] else "insufficient_evidence"
    importance = global_importance(primary["fitted"][primary["selected"]], va.dropna(subset=["positive_3m"])[FEATURES], va.dropna(subset=["positive_3m"])["positive_3m"].to_numpy()) if primary["accepted"] else {}

    heads_art = {}
    for name, r in results.items():
        h = {"accepted": bool(r["accepted"]), "selected": r["selected"], "model": r["fitted"][r["selected"]] if r["accepted"] else None, "calibrator": r["calibrator"] if r["accepted"] else None}
        if name == "clf_3m" and r["accepted"]:
            h["peers"] = {n: m for n, m in r["fitted"].items() if n not in r["base_names"] and n != r["selected"]}
        heads_art[name] = h
    ytr = tr.dropna(subset=["future_vol_3m"])["future_vol_3m"]
    version = version_hint or registry.next_version(FEATURE_SET_VERSION)
    quality = {"clf_3m_test": {k: primary["test"][primary["selected"]].get(k) for k in ("roc_auc", "ece", "brier")}}
    artifact = {
        "version": version, "feature_set_version": FEATURE_SET_VERSION, "features": FEATURES, "heads": heads_art,
        "train_stats": training_stats(tr), "n_train": int(len(tr.dropna(subset=["positive_3m"]))),
        "base_rates": {"3m": float(tr["positive_3m"].dropna().mean()), "6m": float(tr["positive_6m"].dropna().mean())},
        "risk_cuts": {"vol_3m": [float(ytr.quantile(1 / 3)), float(ytr.quantile(2 / 3))]},
        "quality": quality, "blend_weights": BLEND_WEIGHTS, "ml_score_scale": ML_SCORE_SCALE,
    }
    summary = {}
    for name, r in results.items():
        sel = r["selected"]
        summary[name] = {"selected_model": sel, "accepted": bool(r["accepted"]), "n": r["n"], "reasons_rejected": r["why"],
                         "validation": {k: r["val"][k] for k in [sel, *r["base_names"]]}, "test": {k: r["test"][k] for k in [sel, *r["base_names"]]},
                         "walk_forward": r.get("wf")}
    test_c = te.dropna(subset=["positive_3m"])
    sel_p = primary["test_pred_sel"]
    summary["clf_3m"]["test_by_regime_trend"] = by_group(test_c.assign(_p=sel_p), "regime_trend", lambda g: clf_metrics(g, "positive_3m", "forward_return_3m", g["_p"].to_numpy(), primary["train_mean"]))
    summary["clf_3m"]["test_by_regime_vol"] = by_group(test_c.assign(_p=sel_p), "regime_vol", lambda g: clf_metrics(g, "positive_3m", "forward_return_3m", g["_p"].to_numpy(), primary["train_mean"]))
    summary["clf_3m"]["test_by_year"] = by_year(test_c.assign(_p=sel_p), lambda g: {"roc_auc": clf_metrics(g, "positive_3m", "forward_return_3m", g["_p"].to_numpy(), primary["train_mean"]).get("roc_auc"), "n": len(g)})
    backtest = {"label": BACKTEST_LABEL}
    if primary["accepted"]:
        backtest = _backtests(Predictor(artifact), te, info["clean"], bt_cfg)
        backtest["label"] = BACKTEST_LABEL

    reason = ("passed all promotion gates on validation, held-out test and walk-forward" if ml_status == "ok"
              else "did not demonstrate added value over baselines: " + "; ".join(primary["why"][:4]))
    report.update(ml_status=ml_status, version=version, heads=summary, backtest=backtest, feature_importance=importance,
                  data_window={"train": [str(tr["date"].min().date()), str(tr["date"].max().date())], "val": [str(va["date"].min().date()), str(va["date"].max().date())], "test": [str(te["date"].min().date()), str(te["date"].max().date())]},
                  limitations=["curated current-constituent universe => survivorship bias", "price-derived features only (no point-in-time fundamentals)", "single-market-regime history may not generalise", "backtest ignores taxes, liquidity limits and market impact"])
    report["finished_at"] = datetime.now(timezone.utc).isoformat()

    if register:
        d = registry.artifact_dir(version)
        art_path = d / "model.joblib"
        joblib.dump(artifact, art_path, compress=3)
        hh = hashlib.sha256()
        hh.update(pd.util.hash_pandas_object(panel[["symbol", "date"]], index=False).values.tobytes())
        hh.update(pd.util.hash_pandas_object(panel[FEATURES].round(8), index=False).values.tobytes())
        dataset_hash = hh.hexdigest()
        sel_clf = results["clf_3m"]["selected"]
        entry = {
            "version": version, "feature_set_version": FEATURE_SET_VERSION, "model_type": sel_clf,
            "head_models": {n: r["selected"] for n, r in results.items()}, "accepted_heads": [n for n, r in results.items() if r["accepted"]],
            "target": "positive_3m,positive_6m,forward_return_3m,forward_return_6m,future_vol_3m,future_drawdown_3m",
            "features": FEATURES, "training_start": str(tr["date"].min().date()), "training_end": str(tr["date"].max().date()),
            "validation_start": str(va["date"].min().date()), "validation_end": str(va["date"].max().date()),
            "test_start": str(te["date"].min().date()), "test_end": str(te["date"].max().date()),
            "metrics": _clean({"ml_status": ml_status, "heads": summary, "feature_importance": importance}),
            "backtest": _clean(backtest), "blend_weights": BLEND_WEIGHTS, "ml_status": ml_status,
            "artifact_path": str(art_path.relative_to(registry.root)), "artifact_sha256": sha256_file(art_path),
            "dataset_hash": dataset_hash, "n_symbols": int(panel["symbol"].nunique()), "n_train_rows": artifact["n_train"], "code_version": __version__,
            "config": config_snapshot(),
        }
        report["registered"] = {"version": version}
        # status is decided by the caller (retrain's champion/challenger) unless this is the first ever model.
        if ml_status != "ok":
            registry.add(entry, "rejected", reason)
            report["registered"]["status"] = "rejected"
        elif registry.production() is None:
            registry.add(entry, "production", reason + "; first model, no champion to compare with")
            report["registered"]["status"] = "production"
        else:
            champ_entry = registry.production()
            try:
                if champ_entry["feature_set_version"] != FEATURE_SET_VERSION:
                    cmp = {"promote": False, "reason": "champion uses a different feature set; promote manually after review"}
                else:
                    cmp = compare_with_champion(Predictor(artifact), Predictor.load(champ_entry, registry), te, gates)
            except Exception as e:  # never let a comparison problem replace a working champion
                cmp = {"promote": False, "reason": f"champion comparison failed ({type(e).__name__}); keeping champion"}
            report["champion_comparison"] = cmp
            if cmp["promote"]:
                registry.add(entry, "production", reason + "; " + cmp["reason"])
                report["registered"]["status"] = "production"
            else:
                registry.add(entry, "rejected", cmp["reason"])
                report["registered"]["status"] = "rejected"
        (d / "report.json").write_text(json.dumps(_clean(report), indent=2))
    report["_artifact"] = artifact
    return _clean({k: v for k, v in report.items() if k != "_artifact"}) | {"_artifact": artifact}
