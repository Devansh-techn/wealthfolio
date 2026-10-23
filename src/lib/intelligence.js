// WealthFolio Intelligence = RULE_SCORE (src/lib/scoring.js, unchanged) + ML signal (offline model, served via the
// `ml-predictions` Edge Function). Pure functions only, so the blend is transparent and unit-tested.
//
// The weighting is NOT hidden or tuned silently: it is this constant, and the model registry stores the weights each
// model version was shipped with (`model.blendWeights`), which take precedence when present.

export const INTELLIGENCE_CONFIG = Object.freeze({
  weights: Object.freeze({ rule: 0.6, ml: 0.4 }),
  /** ML only enters the headline score at/above this confidence; below it the ML estimate is still shown, separately. */
  minConfidenceForBlend: 'medium',
});

const CONF_RANK = { low: 0, medium: 1, high: 2 };

export const ML_STATUS_COPY = {
  ok: 'ML estimates come from a model that passed held-out validation against the rule-based baseline.',
  insufficient_evidence: 'ML estimates are switched off: the latest model did not show enough evidence of adding value over the rule-based score.',
  not_enough_data: 'ML estimates are not available yet: there is not enough validated historical data. Scores shown are rule-based only.',
  unavailable: 'ML estimates are temporarily unavailable. Scores shown are rule-based only.',
};

export const PREDICTION_STATUS_COPY = {
  insufficient_history: 'Insufficient historical data for this security.',
  low_quality: 'Too many model inputs are missing for this security.',
  stale_data: 'The latest price data for this security is out of date.',
  unavailable: 'No ML estimate is available for this security.',
};

export const RISK_LABEL = { low: 'Low', moderate: 'Moderate', high: 'High', unknown: 'Unknown' };
export const CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const fmtProb = (p) => (isNum(p) ? `${Math.round(p * 100)}%` : 'n/a');
export const fmtSignedPct = (v, d = 1) => (isNum(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(d)}%` : 'n/a');
export const fmtPct = (v, d = 0) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : 'n/a');

/** Safe default for anything that goes wrong: the screener keeps working on rule scores. */
export const UNAVAILABLE = Object.freeze({ mlStatus: 'unavailable', model: null, predictions: {}, reason: ML_STATUS_COPY.unavailable });

export function normalizeIntelligenceResponse(data) {
  if (!data || typeof data !== 'object' || !['ok', 'insufficient_evidence', 'not_enough_data', 'unavailable'].includes(data.mlStatus)) return { ...UNAVAILABLE };
  return {
    mlStatus: data.mlStatus,
    model: data.mlStatus === 'ok' && data.model && typeof data.model === 'object' ? data.model : null,
    predictions: data.mlStatus === 'ok' && data.predictions && typeof data.predictions === 'object' ? data.predictions : {},
    reason: typeof data.reason === 'string' ? data.reason : ML_STATUS_COPY[data.mlStatus],
  };
}

function resolveWeights(model) {
  const w = model?.blendWeights;
  const rule = isNum(w?.rule) && w.rule >= 0 ? w.rule : INTELLIGENCE_CONFIG.weights.rule;
  const ml = isNum(w?.ml) && w.ml >= 0 ? w.ml : INTELLIGENCE_CONFIG.weights.ml;
  return rule + ml > 0 ? { rule, ml } : { ...INTELLIGENCE_CONFIG.weights };
}

/**
 * @param ruleScore number|null  existing overall rule score (0-100)
 * @param prediction object|null one entry from ml-predictions `predictions[symbol]`
 * @returns {{score:number|null, rule:number|null, ml:number|null, mlIncluded:boolean, weights:{rule:number,ml:number}, excludedBecause:string|null}}
 */
export function blendIntelligence(ruleScore, prediction, model = null, minConfidence = INTELLIGENCE_CONFIG.minConfidenceForBlend) {
  const weights = resolveWeights(model);
  const rule = isNum(ruleScore) ? ruleScore : null;
  const ml = prediction?.status === 'ok' && isNum(prediction.mlScore) ? prediction.mlScore : null;
  let excludedBecause = null;
  if (ml === null) excludedBecause = prediction ? 'no_estimate' : 'ml_unavailable';
  else if (prediction.stale) excludedBecause = 'stale';
  else if ((CONF_RANK[prediction.confidenceLabel] ?? -1) < CONF_RANK[minConfidence]) excludedBecause = 'low_confidence';
  const mlIncluded = rule !== null && ml !== null && excludedBecause === null;
  const score = rule === null ? null : mlIncluded ? (weights.rule * rule + weights.ml * ml) / (weights.rule + weights.ml) : rule;
  return { score, rule, ml, mlIncluded, weights, excludedBecause };
}

export const EXCLUDED_COPY = {
  ml_unavailable: 'ML estimate unavailable — score is rule-based only.',
  no_estimate: 'No usable ML estimate for this security — score is rule-based only.',
  stale: 'ML estimate is out of date — score is rule-based only.',
  low_confidence: 'ML confidence is low — shown separately and not blended into the score.',
};

/** Words that must never appear in user-facing intelligence copy. Enforced by a unit test over all copy constants. */
export const FORBIDDEN_PHRASES = ['guaranteed', 'risk-free', 'risk free', 'certain to', 'sure to', 'will rise', 'will outperform', 'cannot lose', 'no risk'];

export const FACTOR_NOTE = "These features were influential in the model's estimate. They do not imply that they caused a price move.";
export const ESTIMATE_NOTE = 'Model estimates based on historical relationships. They can be wrong and are not guarantees or advice.';
