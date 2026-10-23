# WealthFolio Stock Intelligence — ML layer

A **real, auditable machine-learning pipeline** that sits on top of the existing rule-based screener. It never replaces
`RULE_SCORE` (`src/lib/scoring.js`, 35/20/25/20) — it adds an `ML_SCORE` and a transparent blend.

```
MARKET DATA ─► DATA VALIDATION ─► FEATURE ENGINE ─┬─► RULE-BASED ENGINE (existing, unchanged) ─┐
                                                  └─► ML ENGINE (this package, offline Python) ─┤
                                                                                                ▼
                         WEALTHFOLIO INTELLIGENCE = 60% rule + 40% ML (configurable; ML needs ≥ medium confidence)
                                      ├─► STOCK SCREENER (src/pages/Screener.jsx)
                                      └─► EXPLAIN WITH AI (explain-stock) ─► future CHATBOT (src/services/intelligenceTools.js)
```

## Current status — read this first

**No trained model is shipped.** The sandbox this was built in cannot reach Yahoo Finance (HTTP 403), so no real
history could be downloaded and **no model has been trained, validated or backtested on real data**. Every number
the pipeline prints on synthetic test data is a *plumbing check*, not model performance, and none of it is stored anywhere.

* With no model: `ML_STATUS = not_enough_data`; the app shows rule-based scores only (and says so).
* If you train on real data and the model does not clearly beat the baselines: `ML_STATUS = insufficient_evidence`,
  the model is registered as `rejected` and is **never** used. That is a legitimate outcome — price-only features
  often carry little signal, and the gates are intentionally strict.
* Only a model that passes every gate (below) can become `production` and light up the ML columns.

| ML_STATUS | meaning | what users see |
|---|---|---|
| `ok` | a model passed all gates and is `production` | ML probability, confidence, blended Intelligence score |
| `insufficient_evidence` | trained, but did not beat baselines | rule-based only + explanation |
| `not_enough_data` | not enough history/symbols to train meaningfully (or never trained) | rule-based only + explanation |
| `unavailable` | data/service error | rule-based only |

Per-stock statuses: `insufficient_history` (<1 year of prices), `low_quality` (<50% of inputs), `stale_data`, `unavailable`.

## Quick start

```bash
cd ml && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
python -m wealthfolio_ml download            # prices for both curated universes + ^NSEI / ^GSPC  (needs internet access to Yahoo)
python -m wealthfolio_ml train               # validate → features → train → evaluate → backtest → registry   (add --fast for a smoke test)
python -m wealthfolio_ml registry list       # every model ever trained, with status and decision_reason
python -m wealthfolio_ml predict             # inference with the production model → ml/artifacts/predictions/<date>_<version>.json
export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…           # server-side only!
python -m wealthfolio_ml registry sync       # model metadata + artifact (private bucket) → Supabase
python -m wealthfolio_ml predict --push      # predictions → ml_predictions (idempotent per symbol+date+version)
python -m wealthfolio_ml retrain             # monthly/quarterly champion–challenger retraining (see below)
pytest                                       # 40+ tests
```

Training report (all metrics, per-head decisions, backtests): `ml/artifacts/last_report.json` and `ml/artifacts/models/<version>/report.json`.

## What is predicted (six heads)

`P(positive 3-month return)`, `P(positive 6-month return)`, expected 3m / 6m return, future 3-month volatility, future 3-month max drawdown.
Horizons are 63 / 126 **trading days**, validated against calendar dates (a data hole can never be read as "63 days later").
Each head is accepted or rejected **independently**; outputs for rejected heads are `null` (risk falls back to the rule-based volatility bucket). The model is `production`-eligible only if the **3-month classifier** is accepted.

## Features (30, all point-in-time)

* **Technical:** RSI14, price vs SMA20/50/200 & EMA50, SMA50 vs SMA200, golden-cross flag, MACD and histogram (price-normalised)
* **Momentum:** 1m/3m/6m/12m-ex-1m returns, momentum acceleration
* **Risk:** 21/63/252-day volatility, downside volatility, 1-year max drawdown, distance from 52-week high, Sharpe-like (126d), beta vs benchmark, 52-week range position
* **Volume:** 20d/60d volume ratio
* **Market context:** benchmark 3m/6m return, benchmark vs its SMA200, benchmark volatility, relative strength vs benchmark (NIFTY 50 for `.NS/.BO`, S&P 500 for US symbols; other exchanges → null, lower confidence)

**Fundamentals are deliberately NOT trained on in v1.** The provider only returns *current* P/E, ROE, growth, etc. Joining
today's values to 2019 rows would leak the future. Instead `screener-metrics` now saves a dated snapshot of the fundamentals it
fetches into `ml_fundamental_snapshots`; once real history accumulates a future feature-set version can use them legitimately
(`config.FUNDAMENTALS_PENDING` lists them). Sector performance is omitted (no reliable sector data). Nothing is invented.

## Anti-look-ahead measures

1. Every feature is a backward-looking window / shift / EWM; `tests/test_no_lookahead.py` **proves** features at *t* are bit-identical when the future is deleted *or replaced with garbage*.
2. Targets are the only forward-looking columns and live in separate columns that are never inputs (test enforces name separation).
3. Chronological split only (no `train_test_split`): `train < validation < test`, with **purge + embargo**: any row whose label window (190 calendar days ≈ 126 trading days) could reach into the next split is removed.
4. Imputers, scalers, calibrators, percentile ranges and base rates are fit on **train** (calibrator on **validation**); the **test** window is touched once.
5. Benchmarks are joined by trailing as-of alignment (last value on/before the date).
6. Backtests enter positions at the **next** close after the signal.
7. Dataset validation rejects `label_end <= date`, duplicate `(symbol,date)`, target/return inconsistency, infinities, out-of-range values.

## Data quality & missing values

`validate_prices`: drops duplicate/future/non-positive/non-finite rows, removes isolated reversed bad ticks (|move| > 40% undone next row), **quarantines** a symbol with any remaining |daily move| > 60% (likely unadjusted split) or < 600 rows, reports gaps and stale runs.
Missing values are **never zero-filled**: features stay `NaN`; HistGradientBoosting handles NaN natively; Logistic/Forest use train-median imputation (+ missing indicators for logistic); rows missing > 30% of features are excluded from training and get **low** confidence at inference; rows without a valid target are excluded for that head only. Return-regression targets are winsorised at 1%/99% **for fitting only** (evaluation uses raw targets).

## Models, baselines, selection

Candidates per head: Logistic/Ridge, Random Forest, Gradient Boosting (sklearn HistGB), LightGBM automatically if installed. Baselines every candidate must beat:
`base_rate` / `train_mean`, **the existing rule score** (price-only port of the `scoring.js` rubric — parity-tested against the JS by executing it — mapped with a 1-feature logistic/linear fit), and for risk heads **volatility / drawdown persistence**.
The candidate is **selected on validation** (ROC-AUC / RMSE), calibrated (Platt) on validation, then evaluated once on test.

## Evaluation (never training accuracy)

Classification: ROC-AUC, precision / recall / F1 (at 0.5 and at the base rate), Brier (+ base-rate Brier), log-loss, calibration table + ECE, directional accuracy, top-20% hit rate and lift, mean return top-vs-bottom 20%.
Regression: MAE, RMSE, R², R² vs train-mean, directional accuracy. Cross-sectional **rank IC** (per-date Spearman → mean, std, IR, % positive dates) because pooled AUC can merely reflect market timing.
Stability: by year, by regime (bull/bear/sideways from benchmark vs SMA200; high/low volatility), and **walk-forward** folds (expanding window, 6-month test blocks).

## Promotion gates (`config.GateConfig`)

A head is accepted only if, on **both validation and held-out test**: AUC ≥ best baseline + 0.01; Brier ≤ best baseline − 0.0005; mean rank IC > 0; test ECE ≤ 0.08 (regression: RMSE ≥ 0.5% better than best baseline, positive rank IC for return heads) **and** it beats baselines in ≥ 60% of walk-forward folds. Also required before training at all (`SufficiencyConfig`): ≥ 30 symbols, ≥ 5 000 train rows, ≥ 150 weekly dates, ≥ 1 000 val and test rows, ≥ 200 positives and negatives per split.

## Scores

* `ML_SCORE = clip(50 + 200 × (mean accepted calibrated P(+) − train base rate), 0, 100)` — a stock at the historical base rate scores 50.
* `INTELLIGENCE = 0.6·RULE + 0.4·ML` (`src/lib/intelligence.js` `INTELLIGENCE_CONFIG`; the weights each model shipped with are stored in `ml_models.blend_weights` and take precedence). ML is blended only when the estimate is fresh and confidence ≥ medium; otherwise Intelligence = RULE and the ML numbers are shown separately. The blend itself is not yet validated — evaluating it is listed below under "Before production".
* **Confidence ≠ probability.** Weighted from: data completeness, history depth, training size, held-out model quality (AUC edge + calibration), agreement of independent model families, in-distribution check, stability over the previous two weeks. Hard caps: poor data/<1y history ⇒ **low**; weak held-out evidence ⇒ at most **medium**.
* **Explainability:** one-at-a-time occlusion (how much the probability moves when an input is replaced by its training median) + permutation importance in the registry. Worded as *"influential in the model's estimate"*, never causal.

## Registry, versioning, retraining

`ml/artifacts/registry.json` (mirrored to `ml_models`): version `v<feature-set>.<n>`, model type per head, training/validation/test windows, features, targets, metrics (val + test + baselines + walk-forward), backtest, blend weights, status (`candidate|production|archived|rejected`), decision reason, artifact SHA-256 (verified before every load — joblib files are pickles), dataset hash, config snapshot. Versions are immutable; exactly one `production` (DB partial unique index). Every prediction row stores `model_version`; a `(symbol, prediction_date, model_version)` row is never overwritten.

`retrain` = new data → validate → features → train challenger → validate → **compare with the production model on the same test rows** (AUC ≥ champion + 0.002 **and** Brier ≤ champion − 0.0002) → promote **only if better**, otherwise **keep the champion** (challenger recorded as `rejected`). Run monthly/quarterly from cron/CI; never per user action. There is no online learning and no self-modifying logic.

## Backtesting

`backtest.py`: top-20% by signal, equal weight, entry next close, 3 staggered sleeves (~3-month hold), 15 bps/side on turnover, each market vs **its own** benchmark; reports cumulative/annualised return, benchmark return, excess, volatility, Sharpe (rf = 0), max drawdown, hit rate (vs zero and vs benchmark), turnover; compared with *rule-score top-20%* and *equal-weight universe*. Run on the held-out test window only. Always labelled **"Historical simulation. Not a guarantee of future results."**

## Database / API

* Migration `20260101000005_ml_intelligence.sql`: `ml_models`, `ml_predictions`, `ml_evaluations`, `ml_fundamental_snapshots`, private bucket `ml-artifacts`. RLS: signed-in users **read** models/predictions/evaluations; **no** client writes; snapshots have no client access; anon nothing. Checks/FKs/unique keys enforce ranges and the prediction cache key.
* Edge Function `ml-predictions` (POST `{symbols[≤50]}`) → `{ mlStatus, model, predictions{}, missing[] }`; read-only, falls back to `unavailable` on any error.
* `explain-stock` looks up the stock's stored ML output **itself** (never trusts client ML numbers), forwards only enum/numeric/allow-listed text, and its system prompt forbids inventing or overstating ML results.
* `screener-metrics` additionally saves a best-effort fundamentals snapshot (needs the auto-injected service-role key; never affects the response).

## Environment variables

Browser: unchanged. Edge Functions: unchanged (the service-role key is auto-injected). Python pipeline, **only for pushing**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never `VITE_*`).

## Known limitations

* **Survivorship bias:** universes are curated *current* large-caps; historical returns of survivors are flattered, inflating base rates and backtests. Mitigated only by comparing against baselines on the same universe — not removed.
* Price-derived features only (no point-in-time fundamentals, no sector/news/macro).
* Short history windows (one validation + one test year) make pooled metrics noisy; the walk-forward and rank-IC gates exist for that reason, but a strong-looking result still needs live monitoring.
* Unofficial Yahoo data (rate limits, adjustments change). Dividend/split adjustments use `adjclose`.
* Backtest ignores taxes, liquidity limits, market impact; costs are an assumption.
* The model is trained on data *through its training end* (≈ 2 years before today by design, because validation + test windows are held out); monthly retraining shortens, but does not remove, that lag.
* `ml-predictions` serves **stored** predictions for the curated universes; symbols not scored by the batch job show "no ML estimate".

## Before production

1. Run `download` + `train` on real data; read `last_report.json` — expect the possibility of `insufficient_evidence`.
2. If `ok`: review per-regime / per-year stability and the backtest vs rule-score baseline; **evaluate the 60/40 blend itself** against rule-only on validation (not done yet — the weights are a documented default, not a tuned optimum).
3. Apply migration `0005` and run `supabase/tests/rls_and_ledger.test.sql` on a scratch DB; deploy `ml-predictions`, `explain-stock`, `screener-metrics`; `deno check` the functions.
4. Schedule `predict --push` daily and `retrain` monthly/quarterly; monitor prediction drift and live calibration (not implemented).
5. Review wording/legal posture for showing probabilities to retail users in your jurisdiction.
