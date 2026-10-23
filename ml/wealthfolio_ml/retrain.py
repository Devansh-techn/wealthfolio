"""Controlled retraining (monthly / quarterly, from cron or CI — never per user interaction).

NEW DATA -> VALIDATE -> FEATURES -> TRAIN challenger -> VALIDATE (val + held-out test + walk-forward)
         -> COMPARE with the current production model on the same test rows -> promote ONLY IF better,
            otherwise KEEP THE CURRENT MODEL. Every challenger is recorded (production / rejected) for audit.
The system never edits its own rules from a single prediction; learning = new data -> trained, validated, versioned model.
"""
from __future__ import annotations

import logging

from .config import FULL, TrainProfile
from .data.store import PriceStore
from .registry import ModelRegistry
from .train import train_pipeline

log = logging.getLogger("wealthfolio_ml")


def load_frames(store: PriceStore, symbols: list[str]) -> dict:
    frames = {}
    for s in symbols:
        df = store.load(s)
        if df is not None:
            frames[s] = df
    return frames


def retrain(store: PriceStore, symbols: list[str], registry: ModelRegistry | None = None, profile: TrainProfile = FULL, **kw) -> dict:
    registry = registry or ModelRegistry()
    frames = load_frames(store, symbols)
    before = registry.production()
    report = train_pipeline(frames, profile, registry=registry, **kw)
    after = registry.production()
    report["production_before"] = before["version"] if before else None
    report["production_after"] = after["version"] if after else None
    report["changed_production"] = (before or {}).get("version") != (after or {}).get("version")
    return report
