// Tool layer for the FUTURE WealthFolio AI chatbot (Phase K). The chatbot must never invent predictions: it calls
// these tools, which read the user's holdings and the stored, versioned model output, and return structured facts
// (with the model's confidence and a "model estimate" label) for the chatbot to explain.
//
// Wire-up later is just:  tools = INTELLIGENCE_TOOLS (JSON-schema definitions)  +  runIntelligenceTool(name, args, ctx)
// ctx = { holdings: [{symbol, name, marketValue, assetType}], ruleScores?: {SYMBOL: overall}, fetchIntelligence }

import { blendIntelligence, ESTIMATE_NOTE, RISK_LABEL } from '../lib/intelligence';

export const INTELLIGENCE_TOOLS = [
  { name: 'get_stock_intelligence', description: 'Latest WealthFolio intelligence (rule score, ML estimate, confidence) for specific symbols. Returns model estimates, never guarantees.', input_schema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' }, maxItems: 50 } }, required: ['symbols'] } },
  { name: 'rank_holdings_by_setup', description: "Rank the user's own holdings by WealthFolio Intelligence score (strongest setup first).", input_schema: { type: 'object', properties: { top: { type: 'integer', minimum: 1, maximum: 20 } } } },
  { name: 'portfolio_risk_summary', description: "Concentration and model risk signals for the user's holdings (allocation, largest positions, ML risk levels where available).", input_schema: { type: 'object', properties: {} } },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function row(h, intel, ruleScores) {
  const pred = intel.predictions?.[h.symbol] ?? null;
  const rule = ruleScores?.[h.symbol] ?? null;
  const blend = blendIntelligence(rule, pred, intel.model);
  return { symbol: h.symbol, name: h.name ?? h.symbol, marketValue: h.marketValue ?? null, intelligenceScore: blend.score, ruleScore: rule, mlScore: blend.ml, mlIncludedInScore: blend.mlIncluded,
    positive3mProbability: pred?.positive3mProbability ?? null, confidence: pred?.confidenceLabel ?? null, riskLevel: pred?.riskLevel ?? null, predictionDate: pred?.predictionDate ?? null, predictionStatus: pred?.status ?? 'no_estimate' };
}

export async function runIntelligenceTool(name, args, ctx) {
  const symbols = (name === 'get_stock_intelligence' ? args?.symbols : ctx.holdings.map((h) => h.symbol)) ?? [];
  const intel = await ctx.fetchIntelligence(symbols);
  const base = { mlStatus: intel.mlStatus, modelVersion: intel.model?.version ?? null, note: ESTIMATE_NOTE };
  if (name === 'get_stock_intelligence') {
    const holdings = symbols.map((s) => ({ symbol: s }));
    return { ...base, results: holdings.map((h) => row(h, intel, ctx.ruleScores)) };
  }
  const rows = ctx.holdings.map((h) => row(h, intel, ctx.ruleScores));
  if (name === 'rank_holdings_by_setup') {
    const ranked = rows.filter((r) => r.intelligenceScore !== null).sort((a, b) => b.intelligenceScore - a.intelligenceScore).slice(0, args?.top ?? 5);
    return { ...base, ranked, unscored: rows.filter((r) => r.intelligenceScore === null).map((r) => r.symbol) };
  }
  if (name === 'portfolio_risk_summary') {
    const total = rows.reduce((s, r) => s + (isNum(r.marketValue) ? r.marketValue : 0), 0);
    const weights = rows.filter((r) => isNum(r.marketValue) && total > 0).map((r) => ({ symbol: r.symbol, weight: r.marketValue / total, riskLevel: r.riskLevel ? RISK_LABEL[r.riskLevel] : 'No model estimate' })).sort((a, b) => b.weight - a.weight);
    const hhi = weights.reduce((s, w) => s + w.weight ** 2, 0);
    const highRiskWeight = weights.filter((w) => w.riskLevel === 'High').reduce((s, w) => s + w.weight, 0);
    return { ...base, positions: weights.length, largestPositions: weights.slice(0, 5), concentrationIndex: Number(hhi.toFixed(4)), effectivePositions: hhi > 0 ? Number((1 / hhi).toFixed(1)) : null,
      shareInHighRiskPositions: Number(highRiskWeight.toFixed(4)), positionsWithoutModelEstimate: rows.filter((r) => r.predictionStatus !== 'ok').map((r) => r.symbol) };
  }
  throw new Error(`Unknown tool: ${name}`);
}
