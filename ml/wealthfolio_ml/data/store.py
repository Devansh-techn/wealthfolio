"""Tiny on-disk price cache (gzip CSV, no extra dependencies)."""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

from ..config import DATA_CACHE_DIR


def _name(symbol: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", symbol)


class PriceStore:
    def __init__(self, root: Path | str = DATA_CACHE_DIR / "prices"):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, symbol: str) -> Path:
        return self.root / f"{_name(symbol)}.csv.gz"

    def has(self, symbol: str) -> bool:
        return self.path(symbol).exists()

    def save(self, symbol: str, df: pd.DataFrame, meta: dict | None = None) -> None:
        df.to_csv(self.path(symbol), index=False, compression="gzip")
        if meta:
            self.path(symbol).with_suffix(".meta.json").write_text(json.dumps(meta))

    def load(self, symbol: str) -> pd.DataFrame | None:
        p = self.path(symbol)
        if not p.exists():
            return None
        return pd.read_csv(p, parse_dates=["date"])

    def symbols(self) -> list[str]:
        return sorted(p.name.removesuffix(".csv.gz") for p in self.root.glob("*.csv.gz"))
