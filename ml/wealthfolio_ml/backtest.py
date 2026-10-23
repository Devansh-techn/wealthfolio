"""Backtest: "if WealthFolio had used this signal historically, what would have happened?"

Design (kept deliberately simple and conservative):
  * cross-sectional: at each rebalance, buy the top `top_frac` names by signal, equal weight;
  * the signal is known at the close of its observation date; entry is the NEXT trading day's close;
  * `slots` staggered sleeves, each rebalanced every `rebalance_weeks * slots` weeks (~3-month hold);
  * transaction costs charged on the turnover of every rebalance;
  * each market is compared ONLY with its own benchmark (^NSEI for .NS, ^GSPC for US);
  * only the held-out TEST window is used by train.py, so the result is out-of-sample for the model.
Limitations are stated in the output: curated current-constituent universes carry SURVIVORSHIP BIAS, which
flatters absolute returns. This is a historical simulation, not a forecast.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import BACKTEST_LABEL, BacktestConfig, TRADING_DAYS


def perf_metrics(equity: pd.Series, risk_free: float = 0.0) -> dict:
    equity = equity.dropna()
    if len(equity) < 20:
        return {"n_days": int(len(equity))}
    r = equity.pct_change().dropna()
    yrs = (equity.index[-1] - equity.index[0]).days / 365.25
    total = float(equity.iloc[-1] / equity.iloc[0] - 1)
    vol = float(r.std() * np.sqrt(TRADING_DAYS))
    return {
        "n_days": int(len(equity)), "cumulative_return": total,
        "annualised_return": float((1 + total) ** (1 / yrs) - 1) if yrs > 0.25 else float("nan"),
        "annualised_volatility": vol,
        "sharpe": float((r.mean() * TRADING_DAYS - risk_free) / vol) if vol > 0 else float("nan"),
        "max_drawdown": float((equity / equity.cummax() - 1).min()),
    }


def run_backtest(px: pd.DataFrame, signals: pd.DataFrame, bench: pd.Series | None, cfg: BacktestConfig = BacktestConfig(), top_frac: float | None = None) -> dict:
    """px: date x symbol adjusted closes (this market). signals: columns symbol, grid_date, score."""
    top_frac = cfg.top_frac if top_frac is None else top_frac
    px = px.sort_index().ffill(limit=5)
    grids = sorted(signals["grid_date"].unique())
    rebal = grids[:: cfg.rebalance_weeks]
    need = cfg.slots + 1
    if len(rebal) < need:
        return {"status": "insufficient_periods", "n_rebalances": len(rebal), "label": BACKTEST_LABEL}

    def entry_date(g):
        i = px.index.searchsorted(pd.Timestamp(g), side="right")
        return px.index[i] if i < len(px.index) else None

    entries = [(entry_date(g), g) for g in rebal]
    entries = [(e, g) for e, g in entries if e is not None]
    slot_series, seg_returns, seg_bench, turnovers = [], [], [], []
    bench_px = bench.sort_index().reindex(px.index).ffill(limit=5) if bench is not None else None
    for j in range(cfg.slots):
        mine = entries[j:: cfg.slots]
        points: dict[pd.Timestamp, float] = {}
        value, prev = 1.0 / cfg.slots, set()
        for k, (e, g) in enumerate(mine):
            x = mine[k + 1][0] if k + 1 < len(mine) else px.index[-1]
            if x <= e:
                continue
            sig = signals[signals["grid_date"] == g].dropna(subset=["score"])
            sig = sig[sig["symbol"].isin(px.columns)]
            sig = sig[px.loc[e, sig["symbol"]].notna().to_numpy()]
            if len(sig) < cfg.min_names:
                continue
            n = max(cfg.min_names, int(round(top_frac * len(sig))))
            picks = list(sig.nlargest(n, "score")["symbol"])
            turn = 1.0 - len(prev & set(picks)) / len(picks)
            turnovers.append(turn)
            prev = set(picks)
            value *= 1 - turn * 2 * cfg.cost_bps_per_side / 1e4
            seg = px.loc[e:x, picks]
            rel = (seg / seg.iloc[0]).mean(axis=1)
            seg_returns.append(float(rel.iloc[-1] - 1))
            if bench_px is not None and pd.notna(bench_px.loc[e]) and pd.notna(bench_px.loc[x]):
                seg_bench.append(float(bench_px.loc[x] / bench_px.loc[e] - 1))
            else:
                seg_bench.append(np.nan)
            for d, v in (rel * value).items():
                points[d] = float(v)
            points[e] = value  # value right after paying costs
            value = float(rel.iloc[-1] * value)
        if points:
            slot_series.append(pd.Series(points).sort_index())
    if len(slot_series) < cfg.slots:
        return {"status": "insufficient_periods", "label": BACKTEST_LABEL}
    start = max(s.index[0] for s in slot_series)
    idx = px.index[px.index >= start]
    equity = sum(s.reindex(px.index).ffill().reindex(idx) for s in slot_series)
    equity = equity / equity.iloc[0]
    out = {"status": "ok", "label": BACKTEST_LABEL, "period": [str(idx[0].date()), str(idx[-1].date())],
           "n_rebalances": len(entries), "top_frac": top_frac, "cost_bps_per_side": cfg.cost_bps_per_side,
           "strategy": perf_metrics(equity, cfg.risk_free), "avg_turnover": float(np.mean(turnovers)) if turnovers else float("nan"),
           "hit_rate_positive": float(np.mean([r > 0 for r in seg_returns])) if seg_returns else float("nan"),
           "assumptions": "equal weight, entry next close after signal, costs on turnover, rf=0, survivorship-biased curated universe"}
    if bench_px is not None:
        b = (bench_px.reindex(idx).ffill() / bench_px.reindex(idx).ffill().iloc[0]).dropna()
        out["benchmark"] = perf_metrics(b)
        sb = np.array(seg_bench, float)
        sr = np.array(seg_returns, float)
        ok = ~np.isnan(sb)
        out["hit_rate_vs_benchmark"] = float(np.mean(sr[ok] > sb[ok])) if ok.any() else float("nan")
        if "cumulative_return" in out["strategy"] and "cumulative_return" in out["benchmark"]:
            out["excess_cumulative_return"] = out["strategy"]["cumulative_return"] - out["benchmark"]["cumulative_return"]
    return out
