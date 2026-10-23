"""Mirror the registry / predictions to Supabase with the SERVICE ROLE key (server-side only — never in the browser).

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Large artifacts go to the private Storage bucket `ml-artifacts`;
only metadata + metrics go in Postgres. Predictions are idempotent: unique (symbol, prediction_date, model_version).
"""
from __future__ import annotations

import os
from pathlib import Path

import requests

BUCKET = "ml-artifacts"


class SyncError(Exception):
    pass


def _env() -> tuple[str, dict]:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SyncError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return url.rstrip("/"), {"apikey": key, "Authorization": f"Bearer {key}"}


def rest_upsert(table: str, rows: list[dict], on_conflict: str, ignore_duplicates: bool = False, session=requests) -> int:
    if not rows:
        return 0
    url, h = _env()
    pref = ("resolution=ignore-duplicates" if ignore_duplicates else "resolution=merge-duplicates") + ",return=minimal"
    res = session.post(f"{url}/rest/v1/{table}", params={"on_conflict": on_conflict}, json=rows, headers={**h, "Content-Type": "application/json", "Prefer": pref}, timeout=60)
    if res.status_code >= 300:
        raise SyncError(f"{table}: HTTP {res.status_code} {res.text[:200]}")
    return len(rows)


def upload_artifact(path: Path, object_name: str, session=requests) -> str:
    url, h = _env()
    with open(path, "rb") as f:
        res = session.post(f"{url}/storage/v1/object/{BUCKET}/{object_name}", data=f, headers={**h, "Content-Type": "application/octet-stream", "x-upsert": "true"}, timeout=300)
    if res.status_code >= 300:
        raise SyncError(f"artifact upload: HTTP {res.status_code} {res.text[:200]}")
    return f"{BUCKET}/{object_name}"


def model_row(entry: dict, artifact_uri: str | None) -> dict:
    return {
        "version": entry["version"], "model_type": entry["model_type"], "target": entry["target"], "features": entry["features"],
        "training_start": entry["training_start"], "training_end": entry["training_end"],
        "validation_start": entry["validation_start"], "validation_end": entry["validation_end"],
        "test_start": entry["test_start"], "test_end": entry["test_end"],
        "metrics": entry["metrics"], "backtest": entry.get("backtest"), "blend_weights": entry["blend_weights"],
        "status": entry["status"], "decision_reason": entry.get("decision_reason"), "ml_status": entry.get("ml_status"),
        "artifact_uri": artifact_uri, "artifact_sha256": entry.get("artifact_sha256"), "dataset_hash": entry.get("dataset_hash"),
        "feature_set_version": entry.get("feature_set_version"), "n_train_rows": entry.get("n_train_rows"), "n_symbols": entry.get("n_symbols"),
        "promoted_at": entry.get("promoted_at"),
    }


def sync_registry(registry, session=requests, upload: bool = True) -> int:
    """Upserts every registry entry. Statuses are applied in two passes so the one-production-model index is never violated."""
    entries = registry.entries()
    rows = []
    for e in entries:
        uri = None
        if upload and e["status"] in ("production", "archived", "candidate"):
            uri = upload_artifact(registry.verified_artifact_path(e), f"{e['version']}/model.joblib", session)
        rows.append(model_row(e, uri))
    non_prod = [r for r in rows if r["status"] != "production"]
    prod = [r for r in rows if r["status"] == "production"]
    n = rest_upsert("ml_models", non_prod, "version", session=session) + rest_upsert("ml_models", prod, "version", session=session)
    evals = []
    for e in entries:
        evals.append({"model_version": e["version"], "split": "metrics", "metrics": e["metrics"]})
        if e.get("backtest"):
            evals.append({"model_version": e["version"], "split": "backtest", "metrics": e["backtest"]})
    rest_upsert("ml_evaluations", evals, "model_version,split", session=session)
    return n


PRED_COLS = ["symbol", "prediction_date", "model_version", "status", "positive_3m_probability", "positive_6m_probability", "expected_3m_return", "expected_6m_return",
             "expected_volatility_3m", "expected_drawdown_3m", "risk_level", "risk_source", "ml_score", "confidence", "confidence_label", "confidence_components",
             "data_completeness", "top_positive_factors", "top_negative_factors"]


def push_predictions(records: list[dict], session=requests) -> int:
    rows = []
    for r in records:
        if not r.get("prediction_date"):
            continue
        row = {k: r.get(k) for k in PRED_COLS}
        row["detail"] = r.get("detail")
        rows.append(row)
    # ignore-duplicates: a (symbol, date, version) prediction is never overwritten
    return rest_upsert("ml_predictions", rows, "symbol,prediction_date,model_version", ignore_duplicates=True, session=session)


def push_fundamental_snapshot_noop() -> None:  # point-in-time fundamentals are recorded by the screener-metrics Edge Function
    return None
