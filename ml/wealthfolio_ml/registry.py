"""Auditable model registry (JSON on disk, mirrored to Supabase `ml_models`). Exactly one model may be 'production'."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .config import ARTIFACT_DIR, FEATURE_SET_VERSION

STATUSES = ("candidate", "production", "archived", "rejected")


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class ModelRegistry:
    def __init__(self, root: Path | str = ARTIFACT_DIR):
        self.root = Path(root)
        self.models_dir = self.root / "models"
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.file = self.root / "registry.json"

    # -- persistence
    def entries(self) -> list[dict]:
        if not self.file.exists():
            return []
        return json.loads(self.file.read_text())

    def _save(self, entries: list[dict]) -> None:
        fd, tmp = tempfile.mkstemp(dir=self.root, suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(entries, f, indent=2, default=str)
        os.replace(tmp, self.file)

    # -- queries
    def get(self, version: str) -> dict | None:
        return next((e for e in self.entries() if e["version"] == version), None)

    def production(self) -> dict | None:
        return next((e for e in self.entries() if e["status"] == "production"), None)

    def latest(self) -> dict | None:
        es = self.entries()
        return es[-1] if es else None

    def next_version(self, major: int = FEATURE_SET_VERSION) -> str:
        n = [int(e["version"].split(".")[1]) for e in self.entries() if e["version"].startswith(f"v{major}.")]
        return f"v{major}.{(max(n) + 1) if n else 0}"

    def artifact_dir(self, version: str) -> Path:
        d = self.models_dir / version
        d.mkdir(parents=True, exist_ok=True)
        return d

    # -- mutations
    def add(self, entry: dict, status: str, reason: str) -> dict:
        assert status in STATUSES
        entry = {**entry, "status": status, "decision_reason": reason, "created_at": entry.get("created_at") or datetime.now(timezone.utc).isoformat()}
        es = self.entries()
        if any(e["version"] == entry["version"] for e in es):
            raise ValueError(f"version {entry['version']} already registered (versions are immutable)")
        if status == "production":
            for e in es:
                if e["status"] == "production":
                    e["status"], e["decision_reason"] = "archived", f"superseded by {entry['version']}"
            entry["promoted_at"] = datetime.now(timezone.utc).isoformat()
        es.append(entry)
        self._save(es)
        return entry

    def set_status(self, version: str, status: str, reason: str) -> None:
        assert status in STATUSES
        es = self.entries()
        tgt = next(e for e in es if e["version"] == version)
        if status == "production":
            for e in es:
                if e["status"] == "production" and e is not tgt:
                    e["status"], e["decision_reason"] = "archived", f"superseded by {version}"
            tgt["promoted_at"] = datetime.now(timezone.utc).isoformat()
        tgt["status"], tgt["decision_reason"] = status, reason
        self._save(es)

    def verified_artifact_path(self, entry: dict) -> Path:
        p = Path(entry["artifact_path"])
        if not p.is_absolute():
            p = self.root / p
        if sha256_file(p) != entry["artifact_sha256"]:
            raise RuntimeError(f"artifact hash mismatch for {entry['version']} — refusing to load (joblib files are pickles)")
        return p
