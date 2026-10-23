"""The price-only baseline must be the SAME rubric as the app's src/lib/scoring.js (checked by executing the JS)."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from wealthfolio_ml.config import REPO_ROOT
from wealthfolio_ml.features import rule_score_from_features

JS = REPO_ROOT / "src" / "lib" / "scoring.js"


def _js_scores(metrics_list):
    code = ("import { scoreSecurity } from %s; const inp = JSON.parse(process.argv[1]);"
            "console.log(JSON.stringify(inp.map(m => { const s = scoreSecurity(m); return {technical:s.technical, momentum:s.momentum, risk:s.risk, overall:s.overall}; })))") % json.dumps(JS.as_uri())
    out = subprocess.run(["node", "--input-type=module", "-e", code, json.dumps(metrics_list)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_python_rule_score_matches_javascript():
    rng = np.random.default_rng(5)
    metrics, rows = [], []
    for _ in range(40):
        m = dict(rsi14=float(rng.uniform(10, 90)), aboveSma50=bool(rng.random() > .5), aboveSma200=bool(rng.random() > .5), goldenCross=bool(rng.random() > .5),
                 momentum1m=float(rng.normal(1, 8)), momentum3m=float(rng.normal(3, 15)), momentum6m=float(rng.normal(6, 22)), momentum12m1m=float(rng.normal(10, 30)),
                 rangePosition=float(rng.uniform(0, 100)), volatility=float(rng.uniform(8, 70)), maxDrawdown1y=float(-rng.uniform(1, 55)))
        metrics.append(m)   # fundamentals intentionally absent (null) exactly as in the historical setting
        rows.append(pd.Series({"rsi14": m["rsi14"], "dist_sma50": .05 if m["aboveSma50"] else -.05, "dist_sma200": .05 if m["aboveSma200"] else -.05,
                               "golden_cross": 1.0 if m["goldenCross"] else 0.0, "ret_1m": m["momentum1m"] / 100, "ret_3m": m["momentum3m"] / 100, "ret_6m": m["momentum6m"] / 100,
                               "ret_12m_ex1m": m["momentum12m1m"] / 100, "range_pos_252d": m["rangePosition"] / 100, "vol_252d": m["volatility"] / 100, "max_dd_252d": m["maxDrawdown1y"] / 100}))
    js = _js_scores(metrics)
    for j, r in zip(js, rows):
        py = rule_score_from_features(r)
        for k in ("technical", "momentum", "risk", "overall"):
            assert py[k] == pytest.approx(j[k], abs=1e-6), k
