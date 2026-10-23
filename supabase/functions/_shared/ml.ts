// Pure, dependency-free helpers for the ML intelligence endpoints (kept free of Deno/npm imports so the same
// code is unit-tested under vitest: src/__tests__/mlShared.test.js).

export type MlStatus = 'ok' | 'insufficient_evidence' | 'not_enough_data' | 'unavailable';
export const ML_STATUSES: MlStatus[] = ['ok', 'insufficient_evidence', 'not_enough_data', 'unavailable'];
export const PREDICTION_STATUSES = ['ok', 'insufficient_history', 'low_quality', 'stale_data', 'unavailable'] as const;
export const RISK_LEVELS = ['low', 'moderate', 'high', 'unknown'] as const;
export const CONFIDENCE_LABELS = ['high', 'medium', 'low'] as const;

export const SYMBOL_RE = /^[A-Za-z0-9.\-^=&_]{1,32}$/;
export const DISCLAIMER = 'Model estimates based on historical relationships. Not investment advice and not a guarantee of future results.';
export const STALE_AFTER_DAYS = 10;

/** No production model => say WHY: a trained-but-rejected model is "insufficient_evidence"; nothing trained is "not_enough_data". */
export function deriveMlStatus(production: { ml_status?: string } | null, latest: { ml_status?: string; status?: string } | null): MlStatus {
  if (production) return 'ok';
  if (latest?.ml_status === 'insufficient_evidence') return 'insufficient_evidence';
  return 'not_enough_data';
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);

// Factor text is forwarded to an LLM, so NOTHING free-form from the database is ever passed on: the label comes from this
// fixed allowlist keyed by feature name (mirrors ml/wealthfolio_ml/explain.py LABELS; a Python test keeps them in sync),
// and the value must look like a number/percentage or yes/no.
export const FEATURE_LABELS: Record<string, string> = {
  rsi14: 'RSI (14)',
  dist_sma20: 'Price vs 20-day average',
  dist_sma50: 'Price vs 50-day average',
  dist_sma200: 'Price vs 200-day average',
  sma50_over_sma200: '50-day vs 200-day average',
  golden_cross: '50-day above 200-day average',
  macd_norm: 'MACD (price-normalised)',
  macd_hist_norm: 'MACD histogram (price-normalised)',
  dist_ema50: 'Price vs 50-day EMA',
  ret_1m: '1-month return',
  ret_3m: '3-month return',
  ret_6m: '6-month return',
  ret_12m_ex1m: '12-month return (ex last month)',
  mom_accel: 'Momentum acceleration',
  vol_21d: '21-day volatility',
  vol_63d: '63-day volatility',
  vol_252d: '1-year volatility',
  downside_vol_63d: 'Downside volatility (63d)',
  max_dd_252d: '1-year max drawdown',
  dd_from_high_252d: 'Distance below 52-week high',
  sharpe_126d: 'Sharpe-like ratio (6m)',
  beta_252d: 'Beta vs benchmark',
  range_pos_252d: 'Position in 52-week range',
  volume_ratio_20_60: 'Volume (20d vs 60d)',
  bench_ret_3m: 'Benchmark 3-month return',
  bench_ret_6m: 'Benchmark 6-month return',
  bench_dist_sma200: 'Benchmark vs its 200-day average',
  bench_vol_63d: 'Benchmark volatility (63d)',
  rel_strength_3m: '3-month return vs benchmark',
  rel_strength_6m: '6-month return vs benchmark',
};
const FACTOR_VALUE_RE = /^([+\-]?\d{1,4}(\.\d{1,3})?%?|yes|no)$/;
export interface Factor { feature: string; label: string; valueText: string; influence: number }

export function sanitizeFactors(raw: unknown, max = 3): Factor[] {
  if (!Array.isArray(raw)) return [];
  const out: Factor[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const { feature, value_text, influence } = f as Record<string, unknown>;
    if (typeof feature !== 'string' || !Object.prototype.hasOwnProperty.call(FEATURE_LABELS, feature)) continue;
    if (typeof value_text !== 'string' || !FACTOR_VALUE_RE.test(value_text)) continue;
    const inf = num(influence);
    if (inf === null) continue;
    out.push({ feature, label: FEATURE_LABELS[feature], valueText: value_text, influence: inf });
    if (out.length >= max) break;
  }
  return out;
}

export interface ShapedPrediction {
  symbol: string; predictionDate: string; modelVersion: string; status: (typeof PREDICTION_STATUSES)[number];
  positive3mProbability: number | null; positive6mProbability: number | null;
  expected3mReturn: number | null; expected6mReturn: number | null;
  expectedVolatility3m: number | null; expectedDrawdown3m: number | null;
  riskLevel: (typeof RISK_LEVELS)[number] | null; riskSource: 'ml' | 'rule' | 'none' | null;
  mlScore: number | null; confidence: number | null; confidenceLabel: (typeof CONFIDENCE_LABELS)[number] | null;
  dataCompleteness: number | null; topPositiveFactors: Factor[]; topNegativeFactors: Factor[];
  detail: string | null; stale: boolean;
}

export function shapePrediction(row: Record<string, unknown>, now = new Date()): ShapedPrediction | null {
  const status = oneOf(row.status, PREDICTION_STATUSES);
  if (!status || typeof row.symbol !== 'string' || !SYMBOL_RE.test(row.symbol) || typeof row.prediction_date !== 'string') return null;
  const ageDays = (now.getTime() - new Date(row.prediction_date + 'T00:00:00Z').getTime()) / 86_400_000;
  const ok = status === 'ok';
  const inRange = (v: unknown, lo: number, hi: number) => { const n = num(v); return n !== null && n >= lo && n <= hi ? n : null; };
  return {
    symbol: row.symbol, predictionDate: row.prediction_date, modelVersion: String(row.model_version ?? ''), status,
    positive3mProbability: ok ? inRange(row.positive_3m_probability, 0, 1) : null,
    positive6mProbability: ok ? inRange(row.positive_6m_probability, 0, 1) : null,
    expected3mReturn: ok ? num(row.expected_3m_return) : null, expected6mReturn: ok ? num(row.expected_6m_return) : null,
    expectedVolatility3m: ok ? inRange(row.expected_volatility_3m, 0, 50) : null, expectedDrawdown3m: ok ? inRange(row.expected_drawdown_3m, -1, 0) : null,
    riskLevel: ok ? oneOf(row.risk_level, RISK_LEVELS) : null, riskSource: ok ? oneOf(row.risk_source, ['ml', 'rule', 'none'] as const) : null,
    mlScore: ok ? inRange(row.ml_score, 0, 100) : null, confidence: ok ? inRange(row.confidence, 0, 1) : null,
    confidenceLabel: ok ? oneOf(row.confidence_label, CONFIDENCE_LABELS) : null, dataCompleteness: inRange(row.data_completeness, 0, 1),
    topPositiveFactors: ok ? sanitizeFactors(row.top_positive_factors) : [], topNegativeFactors: ok ? sanitizeFactors(row.top_negative_factors) : [],
    detail: typeof row.detail === 'string' ? row.detail.slice(0, 200) : null,
    stale: ageDays > STALE_AFTER_DAYS,
  };
}

/** rows may contain several dates per symbol; keep the newest per symbol. */
export function latestPerSymbol(rows: Record<string, unknown>[], now = new Date()): Record<string, ShapedPrediction> {
  const out: Record<string, ShapedPrediction> = {};
  for (const r of rows) {
    const p = shapePrediction(r, now);
    if (p && (!out[p.symbol] || p.predictionDate > out[p.symbol].predictionDate)) out[p.symbol] = p;
  }
  return out;
}

/** Compact, honest evidence summary for the UI: held-out numbers only, never training accuracy. */
export function summariseEvidence(clf3m: any): { selectedModel: string | null; rocAuc: number | null; brier: number | null; brierBaseRate: number | null; ece: number | null; baselineRocAuc: number | null; walkForwardWinFrac: number | null } | null {
  if (!clf3m || typeof clf3m !== 'object') return null;
  const sel = typeof clf3m.selected_model === 'string' ? clf3m.selected_model : null;
  const t = sel ? clf3m.test?.[sel] : null;
  const base = clf3m.test?.rule_score;
  return {
    selectedModel: sel, rocAuc: num(t?.roc_auc), brier: num(t?.brier), brierBaseRate: num(t?.brier_base_rate), ece: num(t?.ece),
    baselineRocAuc: num(base?.roc_auc), walkForwardWinFrac: num(clf3m.walk_forward?.win_frac),
  };
}

/** What explain-stock may hand to the LLM: only validated model outputs, never free text from the client. */
export function mlForExplanation(status: MlStatus, p: ShapedPrediction | null, model: { version?: string } | null) {
  if (status !== 'ok' || !p) return { status, note: 'No validated ML estimate is available; explain using the rule-based scores only.' };
  if (p.status !== 'ok') return { status: p.status, note: 'The model could not produce an estimate for this stock.' };
  return {
    status: 'ok', modelVersion: model?.version ?? p.modelVersion, predictionDate: p.predictionDate, stale: p.stale,
    positive3mProbability: p.positive3mProbability, positive6mProbability: p.positive6mProbability,
    expected3mReturn: p.expected3mReturn, expected6mReturn: p.expected6mReturn, riskLevel: p.riskLevel, mlScore: p.mlScore,
    confidenceLabel: p.confidenceLabel, topPositiveFactors: p.topPositiveFactors.map((f) => `${f.label}: ${f.valueText}`), topNegativeFactors: p.topNegativeFactors.map((f) => `${f.label}: ${f.valueText}`),
  };
}
