"""Symbol universes. Parsed from src/lib/universes.js so the frontend and ML pipeline never drift apart."""
from __future__ import annotations

import re

from .config import REPO_ROOT


def load_universes(path=None) -> dict[str, list[str]]:
    p = path or (REPO_ROOT / "src" / "lib" / "universes.js")
    text = p.read_text(encoding="utf-8")
    out: dict[str, list[str]] = {}
    for m in re.finditer(r"id:\s*'([^']+)'.*?symbols:\s*\[(.*?)\]", text, flags=re.S):
        out[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))
    return out


def all_symbols() -> list[str]:
    seen: dict[str, None] = {}
    for syms in load_universes().values():
        for s in syms:
            seen[s] = None
    return list(seen)
