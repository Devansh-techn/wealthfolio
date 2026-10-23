"""Command line:  python -m wealthfolio_ml <command>

  download   fetch daily history for the app's universes (+ benchmarks) into ml/data_cache
  train      validate data, build dataset, train, evaluate, backtest, register (see ml/README.md)
  predict    run the production model over symbols and write predictions (optionally --push to Supabase)
  retrain    controlled champion/challenger retraining
  registry   list | promote <version> | sync
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .config import ARTIFACT_DIR, BENCHMARKS, FAST, FULL
from .data.store import PriceStore
from .data.yahoo import DataUnavailable, fetch_history
from .registry import ModelRegistry
from .universe import all_symbols, load_universes


def _symbols(args) -> list[str]:
    if getattr(args, "symbols", None):
        return args.symbols
    if getattr(args, "universe", None):
        return load_universes()[args.universe]
    return all_symbols()


def cmd_download(a) -> int:
    store, ok, fail = PriceStore(), 0, []
    for s in [*_symbols(a), *BENCHMARKS.values()]:
        try:
            df, meta = fetch_history(s)
            store.save(s, df, meta)
            ok += 1
            print(f"✓ {s}: {len(df)} rows")
        except DataUnavailable as e:
            fail.append(str(e))
            print(f"✗ {e}")
        time.sleep(0.4)
    print(f"\n{ok} downloaded, {len(fail)} failed.")
    if ok == 0:
        print("No market data could be downloaded: ML_STATUS = unavailable. Nothing was trained.")
        return 2
    return 0


def cmd_train(a) -> int:
    from .retrain import load_frames
    from .train import train_pipeline
    store = PriceStore()
    syms = [*_symbols(a), *BENCHMARKS.values()]
    frames = load_frames(store, syms)
    if not frames:
        print("ML_STATUS: unavailable — no cached prices. Run `download` first.")
        return 2
    rep = train_pipeline(frames, FAST if a.fast else FULL, register=not a.dry_run)
    rep.pop("_artifact", None)
    out = ARTIFACT_DIR / "last_report.json"
    out.write_text(json.dumps(rep, indent=2, default=str))
    print(f"ML_STATUS: {rep['ml_status']}")
    for r in rep.get("reasons", []):
        print(" -", r)
    for h, v in (rep.get("heads") or {}).items():
        print(f" {h}: {v['selected_model']} accepted={v['accepted']}")
    print(f"report: {out}")
    return 0


def cmd_predict(a) -> int:
    import pandas as pd
    from .predict import Predictor
    from .retrain import load_frames
    reg = ModelRegistry()
    prod = reg.production()
    if not prod:
        print("ML_STATUS: not_enough_data / no production model — nothing to predict with. (Rule-based screener is unaffected.)")
        return 2
    store = PriceStore()
    frames = load_frames(store, [*_symbols(a), *BENCHMARKS.values()])
    recs = Predictor.load(prod, reg).predict_symbols(frames)
    out = ARTIFACT_DIR / "predictions" / f"{pd.Timestamp.now().date()}_{prod['version']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(recs, indent=2, default=str))
    print(f"{len(recs)} records -> {out}  (model {prod['version']})")
    if a.push:
        from .supabase_sync import push_predictions
        print(f"pushed {push_predictions(recs)} predictions")
    return 0


def cmd_retrain(a) -> int:
    from .retrain import retrain
    rep = retrain(PriceStore(), [*_symbols(a), *BENCHMARKS.values()], profile=FAST if a.fast else FULL)
    rep.pop("_artifact", None)
    print(f"ML_STATUS: {rep['ml_status']}  production: {rep['production_before']} -> {rep['production_after']}")
    if "champion_comparison" in rep:
        print(" ", rep["champion_comparison"]["reason"])
    return 0


def cmd_registry(a) -> int:
    reg = ModelRegistry()
    if a.action == "list":
        for e in reg.entries():
            print(f"{e['version']:8} {e['status']:11} {e['model_type']:14} {e['training_start']}→{e['training_end']}  {e.get('decision_reason','')[:90]}")
    elif a.action == "promote":
        reg.set_status(a.version, "production", "manual promotion")
        print(f"{a.version} is now production")
    elif a.action == "sync":
        from .supabase_sync import sync_registry
        print(f"synced {sync_registry(reg)} models")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="wealthfolio_ml")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, fn in (("download", cmd_download), ("train", cmd_train), ("predict", cmd_predict), ("retrain", cmd_retrain)):
        s = sub.add_parser(name)
        s.add_argument("--universe", choices=list(load_universes()), help="default: all curated universes")
        s.add_argument("--symbols", nargs="+")
        if name in ("train", "retrain"):
            s.add_argument("--fast", action="store_true", help="small models (CI / smoke test)")
        if name == "train":
            s.add_argument("--dry-run", action="store_true", help="do not write to the registry")
        if name == "predict":
            s.add_argument("--push", action="store_true", help="upsert predictions into Supabase (needs service-role env)")
        s.set_defaults(fn=fn)
    r = sub.add_parser("registry")
    r.add_argument("action", choices=["list", "promote", "sync"])
    r.add_argument("version", nargs="?")
    r.set_defaults(fn=cmd_registry)
    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
