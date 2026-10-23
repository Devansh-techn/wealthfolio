/**
 * Transparent screener scoring.
 *
 * Every sub-score is a weighted average (0-100) of rule-based component scores computed from
 * real metrics. A metric that is missing (null) is skipped and the remaining weights are
 * renormalised; `coverage` reports how much of the rubric had data. Nothing is estimated or invented.
 *
 * Overall = 35% Fundamental + 20% Technical + 25% Momentum + 20% Risk (renormalised if a pillar has no data).
 * "Risk Score": higher = LOWER risk (more favourable), so that all scores read the same way.
 */

/** Piecewise-linear map. pts = [[x0,s0],[x1,s1],...] with ascending x; clamps outside range. */
export function scale(x, pts) {
  if (x === null || x === undefined || Number.isNaN(x)) return null;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i += 1) {
    const [x1, s1] = pts[i];
    const [x0, s0] = pts[i - 1];
    if (x <= x1) return s0 + ((x - x0) / (x1 - x0)) * (s1 - s0);
  }
  return pts[pts.length - 1][1];
}

const bool = (b, yes = 100, no = 0) => (b === null || b === undefined ? null : b ? yes : no);

/** Component rubrics: [key, label, weight, fn(metrics)->score|null] */
export const RUBRIC = {
  fundamental: [
    ['pe', 'P/E ratio', 20, (m) => (m.pe == null ? null : m.pe <= 0 ? 10 : scale(m.pe, [[5, 90], [15, 85], [25, 60], [40, 30], [80, 5]]))],
    ['epsGrowth', 'Earnings growth', 20, (m) => scale(m.epsGrowth, [[-30, 0], [0, 35], [10, 65], [25, 90], [50, 100]])],
    ['revenueGrowth', 'Revenue growth', 15, (m) => scale(m.revenueGrowth, [[-20, 0], [0, 35], [10, 70], [25, 95], [40, 100]])],
    ['roe', 'Return on equity', 20, (m) => scale(m.roe, [[0, 0], [8, 40], [15, 75], [25, 100]])],
    ['roce', 'Return on capital employed', 10, (m) => scale(m.roce, [[0, 0], [10, 40], [18, 75], [28, 100]])],
    ['debtToEquity', 'Debt / equity', 10, (m) => scale(m.debtToEquity, [[0, 100], [0.5, 90], [1, 65], [2, 30], [4, 0]])],
    ['dividendYield', 'Dividend yield', 5, (m) => scale(m.dividendYield, [[0, 30], [1, 55], [3, 85], [6, 100]])],
  ],
  technical: [
    ['rsi14', 'RSI (14)', 30, (m) => scale(m.rsi14, [[0, 25], [30, 60], [45, 90], [60, 100], [70, 65], [80, 30], [100, 10]])],
    ['aboveSma50', 'Price vs 50-day average', 25, (m) => bool(m.aboveSma50)],
    ['aboveSma200', 'Price vs 200-day average', 25, (m) => bool(m.aboveSma200)],
    ['goldenCross', '50-day vs 200-day average', 20, (m) => bool(m.goldenCross)],
  ],
  momentum: [
    ['momentum1m', '1-month return', 15, (m) => scale(m.momentum1m, [[-15, 0], [0, 45], [5, 70], [15, 100]])],
    ['momentum3m', '3-month return', 30, (m) => scale(m.momentum3m, [[-25, 0], [0, 45], [10, 75], [30, 100]])],
    ['momentum6m', '6-month return', 25, (m) => scale(m.momentum6m, [[-35, 0], [0, 45], [20, 80], [50, 100]])],
    ['momentum12m1m', '12-month return (ex last month)', 20, (m) => scale(m.momentum12m1m, [[-40, 0], [0, 45], [25, 80], [70, 100]])],
    ['rangePosition', '52-week range position', 10, (m) => scale(m.rangePosition, [[0, 10], [50, 55], [85, 100], [100, 90]])],
  ],
  risk: [
    ['volatility', 'Annualised volatility', 45, (m) => scale(m.volatility, [[10, 100], [20, 80], [30, 55], [45, 25], [70, 0]])],
    ['maxDrawdown1y', '1-year max drawdown', 35, (m) => scale(Math.abs(m.maxDrawdown1y ?? NaN), [[0, 100], [10, 85], [20, 60], [35, 25], [55, 0]])],
    ['debtToEquity', 'Debt / equity', 20, (m) => scale(m.debtToEquity, [[0, 100], [0.5, 90], [1, 65], [2, 30], [4, 0]])],
  ],
};

export const PILLAR_WEIGHTS = { fundamental: 35, technical: 20, momentum: 25, risk: 20 };
export const PILLAR_LABELS = {
  fundamental: 'Fundamental',
  technical: 'Technical',
  momentum: 'Momentum',
  risk: 'Risk (higher = lower risk)',
};

function scorePillar(pillar, metrics) {
  const comps = [];
  let wsum = 0;
  let acc = 0;
  let totalW = 0;
  for (const [key, label, weight, fn] of RUBRIC[pillar]) {
    totalW += weight;
    const s = fn(metrics);
    if (s === null || s === undefined || Number.isNaN(s)) {
      comps.push({ key, label, weight, score: null });
      continue;
    }
    comps.push({ key, label, weight, score: s });
    wsum += weight;
    acc += s * weight;
  }
  return { score: wsum > 0 ? acc / wsum : null, coverage: totalW > 0 ? (wsum / totalW) * 100 : 0, components: comps };
}

/** metrics: flat object of fundamentals + technicals (see buildMetrics). */
export function scoreSecurity(metrics) {
  const pillars = {};
  for (const p of Object.keys(RUBRIC)) pillars[p] = scorePillar(p, metrics);
  let acc = 0;
  let w = 0;
  let covAcc = 0;
  for (const [p, weight] of Object.entries(PILLAR_WEIGHTS)) {
    covAcc += pillars[p].coverage * weight;
    if (pillars[p].score !== null) {
      acc += pillars[p].score * weight;
      w += weight;
    }
  }
  return {
    fundamental: pillars.fundamental.score,
    technical: pillars.technical.score,
    momentum: pillars.momentum.score,
    risk: pillars.risk.score,
    overall: w > 0 ? acc / w : null,
    coverage: covAcc / 100,
    pillars,
  };
}

/** Merge provider fundamentals with computed technicals into one flat metrics object. */
export function buildMetrics(fundamentals, technicals) {
  const f = fundamentals ?? {};
  const t = technicals ?? {};
  return {
    price: t.price ?? f.price ?? null,
    marketCap: f.marketCap ?? null,
    pe: f.pe ?? null,
    epsGrowth: f.epsGrowth ?? null,
    revenueGrowth: f.revenueGrowth ?? null,
    roe: f.roe ?? null,
    roce: f.roce ?? null,
    debtToEquity: f.debtToEquity ?? null,
    dividendYield: f.dividendYield ?? null,
    sector: f.sector ?? null,
    ...t,
  };
}

const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d));

/**
 * Deterministic, data-grounded explanation. Only restates metrics that exist.
 * Returns { headline, strengths: string[], weaknesses: string[], missing: string[] }.
 */
export function explainScores(metrics, scores) {
  const strengths = [];
  const weaknesses = [];
  const missing = [];
  const push = (cond, good, bad) => {
    if (cond === null) return;
    (cond ? strengths : weaknesses).push(cond ? good : bad);
  };
  const m = metrics;
  if (m.pe != null) push(m.pe > 0 && m.pe <= 25, `P/E of ${fmt(m.pe)} is moderate`, m.pe <= 0 ? 'Negative earnings (P/E not meaningful)' : `P/E of ${fmt(m.pe)} is on the high side`);
  else missing.push('P/E');
  if (m.epsGrowth != null) push(m.epsGrowth >= 10, `Earnings growth of ${fmt(m.epsGrowth)}%`, `Earnings growth of ${fmt(m.epsGrowth)}% is weak`);
  else missing.push('EPS growth');
  if (m.revenueGrowth != null) push(m.revenueGrowth >= 8, `Revenue growth of ${fmt(m.revenueGrowth)}%`, `Revenue growth of ${fmt(m.revenueGrowth)}% is weak`);
  else missing.push('Revenue growth');
  if (m.roe != null) push(m.roe >= 15, `ROE of ${fmt(m.roe)}%`, `ROE of ${fmt(m.roe)}% is below 15%`);
  else missing.push('ROE');
  if (m.roce == null) missing.push('ROCE');
  else push(m.roce >= 18, `ROCE of ${fmt(m.roce)}%`, `ROCE of ${fmt(m.roce)}% is below 18%`);
  if (m.debtToEquity != null) push(m.debtToEquity <= 1, `Debt/equity of ${fmt(m.debtToEquity, 2)} is conservative`, `Debt/equity of ${fmt(m.debtToEquity, 2)} is elevated`);
  else missing.push('Debt/equity');
  if (m.rsi14 != null) {
    if (m.rsi14 > 70) weaknesses.push(`RSI of ${fmt(m.rsi14, 0)} indicates overbought conditions`);
    else if (m.rsi14 < 30) weaknesses.push(`RSI of ${fmt(m.rsi14, 0)} indicates oversold / weak trend`);
    else strengths.push(`RSI of ${fmt(m.rsi14, 0)} is in a neutral range`);
  }
  if (m.aboveSma200 != null) push(m.aboveSma200, 'Trading above its 200-day average', 'Trading below its 200-day average');
  if (m.goldenCross != null) push(m.goldenCross, '50-day average is above the 200-day average', '50-day average is below the 200-day average');
  if (m.momentum3m != null) push(m.momentum3m >= 5, `3-month return of ${fmt(m.momentum3m)}%`, `3-month return of ${fmt(m.momentum3m)}%`);
  if (m.momentum12m1m != null) push(m.momentum12m1m >= 10, `12-month return (ex last month) of ${fmt(m.momentum12m1m)}%`, `12-month return (ex last month) of ${fmt(m.momentum12m1m)}%`);
  if (m.volatility != null) push(m.volatility <= 30, `Annualised volatility of ${fmt(m.volatility)}%`, `High annualised volatility of ${fmt(m.volatility)}%`);
  if (m.maxDrawdown1y != null && m.maxDrawdown1y <= -25) weaknesses.push(`Fell ${fmt(Math.abs(m.maxDrawdown1y))}% peak-to-trough over the past year`);

  const o = scores.overall;
  const headline =
    o === null
      ? 'Not enough data to score this security.'
      : `Overall score ${fmt(o, 0)}/100 — Fundamental ${fmt(scores.fundamental, 0)}, Technical ${fmt(scores.technical, 0)}, Momentum ${fmt(scores.momentum, 0)}, Risk ${fmt(scores.risk, 0)}. Data coverage ${fmt(scores.coverage, 0)}%.`;
  return { headline, strengths, weaknesses, missing };
}

/** Screener filter definitions (also drives the filter UI). */
export const FILTERS = [
  { key: 'marketCapMin', label: 'Market cap ≥ (billions)', metric: 'marketCap', op: 'gte', scale: 1e9, step: 1 },
  { key: 'marketCapMax', label: 'Market cap ≤ (billions)', metric: 'marketCap', op: 'lte', scale: 1e9, step: 1 },
  { key: 'priceMin', label: 'Price ≥', metric: 'price', op: 'gte', step: 1 },
  { key: 'priceMax', label: 'Price ≤', metric: 'price', op: 'lte', step: 1 },
  { key: 'peMax', label: 'P/E ≤', metric: 'pe', op: 'lte', step: 1, positiveOnly: true },
  { key: 'epsGrowthMin', label: 'EPS growth ≥ (%)', metric: 'epsGrowth', op: 'gte', step: 1 },
  { key: 'revenueGrowthMin', label: 'Revenue growth ≥ (%)', metric: 'revenueGrowth', op: 'gte', step: 1 },
  { key: 'roeMin', label: 'ROE ≥ (%)', metric: 'roe', op: 'gte', step: 1 },
  { key: 'roceMin', label: 'ROCE ≥ (%)', metric: 'roce', op: 'gte', step: 1 },
  { key: 'debtToEquityMax', label: 'Debt/equity ≤', metric: 'debtToEquity', op: 'lte', step: 0.1 },
  { key: 'dividendYieldMin', label: 'Dividend yield ≥ (%)', metric: 'dividendYield', op: 'gte', step: 0.1 },
  { key: 'rsiMin', label: 'RSI ≥', metric: 'rsi14', op: 'gte', step: 1 },
  { key: 'rsiMax', label: 'RSI ≤', metric: 'rsi14', op: 'lte', step: 1 },
  { key: 'momentum3mMin', label: '3-month momentum ≥ (%)', metric: 'momentum3m', op: 'gte', step: 1 },
  { key: 'volumeMin', label: 'Avg volume (20d) ≥', metric: 'avgVolume20', op: 'gte', step: 1000 },
  { key: 'volatilityMax', label: 'Volatility ≤ (%)', metric: 'volatility', op: 'lte', step: 1 },
];

export const MA_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'above50', label: 'Price above 50-day average' },
  { value: 'above200', label: 'Price above 200-day average' },
  { value: 'golden', label: '50-day above 200-day (golden cross state)' },
  { value: 'below50', label: 'Price below 50-day average' },
];

/** Apply filters. A security with missing data for an active filter is excluded (never guessed). */
export function applyFilters(rows, filters, ma = '') {
  return rows.filter((row) => {
    const m = row.metrics;
    for (const f of FILTERS) {
      const raw = filters[f.key];
      if (raw === '' || raw === null || raw === undefined) continue;
      const limit = Number(raw) * (f.scale ?? 1);
      if (Number.isNaN(limit)) continue;
      const v = m[f.metric];
      if (v === null || v === undefined || Number.isNaN(v)) return false;
      if (f.positiveOnly && v <= 0) return false;
      if (f.op === 'gte' ? v < limit : v > limit) return false;
    }
    if (ma === 'above50' && m.aboveSma50 !== true) return false;
    if (ma === 'above200' && m.aboveSma200 !== true) return false;
    if (ma === 'golden' && m.goldenCross !== true) return false;
    if (ma === 'below50' && m.aboveSma50 !== false) return false;
    return true;
  });
}
