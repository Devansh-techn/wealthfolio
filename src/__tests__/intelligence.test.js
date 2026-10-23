import { describe, it, expect, vi } from 'vitest';
import * as I from '../lib/intelligence';
import { fetchIntelligence } from '../services/intelligenceService';
import { INTELLIGENCE_TOOLS, runIntelligenceTool } from '../services/intelligenceTools';

const okPred = (over = {}) => ({ status: 'ok', mlScore: 80, confidenceLabel: 'medium', stale: false, positive3mProbability: 0.68, riskLevel: 'moderate', predictionDate: '2026-10-02', ...over });

describe('blendIntelligence (rule score is never silently replaced)', () => {
  it('uses the documented 60/40 weights when a confident, fresh ML estimate exists', () => {
    const b = I.blendIntelligence(70, okPred());
    expect(b.mlIncluded).toBe(true);
    expect(b.score).toBeCloseTo(0.6 * 70 + 0.4 * 80, 10);
    expect(b.rule).toBe(70);
    expect(b.weights).toEqual({ rule: 0.6, ml: 0.4 });
  });
  it('falls back to the pure rule score when ML is unavailable, stale, low-confidence or missing', () => {
    expect(I.blendIntelligence(70, null)).toMatchObject({ score: 70, mlIncluded: false, excludedBecause: 'ml_unavailable' });
    expect(I.blendIntelligence(70, okPred({ stale: true }))).toMatchObject({ score: 70, excludedBecause: 'stale' });
    expect(I.blendIntelligence(70, okPred({ confidenceLabel: 'low' }))).toMatchObject({ score: 70, excludedBecause: 'low_confidence', ml: 80 });
    expect(I.blendIntelligence(70, { status: 'insufficient_history' })).toMatchObject({ score: 70, excludedBecause: 'no_estimate' });
  });
  it('is null when there is no rule score (ML alone never produces the headline)', () => {
    expect(I.blendIntelligence(null, okPred()).score).toBeNull();
  });
  it('weights are configurable and the registry-recorded weights win', () => {
    expect(I.blendIntelligence(50, okPred({ mlScore: 100 }), { blendWeights: { rule: 0.5, ml: 0.5 } }).score).toBe(75);
    expect(I.blendIntelligence(50, okPred({ mlScore: 100 }), { blendWeights: { rule: 0, ml: 0 } }).score).toBeCloseTo(0.6 * 50 + 0.4 * 100); // invalid -> defaults
    expect(I.blendIntelligence(50, okPred({ confidenceLabel: 'low', mlScore: 100 }), null, 'low').score).toBeCloseTo(0.6 * 50 + 0.4 * 100);
  });
});

describe('response normalisation and safety', () => {
  it('treats malformed / unknown responses as unavailable', () => {
    for (const bad of [null, undefined, {}, { mlStatus: 'great' }, 'x']) expect(I.normalizeIntelligenceResponse(bad).mlStatus).toBe('unavailable');
  });
  it('drops predictions unless the model is validated (status ok)', () => {
    const r = I.normalizeIntelligenceResponse({ mlStatus: 'insufficient_evidence', predictions: { A: okPred() }, model: { version: 'v1.0' } });
    expect(r.predictions).toEqual({}) ; expect(r.model).toBeNull();
  });
  it('no user-facing copy makes guarantees', () => {
    const copy = [...Object.values(I.ML_STATUS_COPY), ...Object.values(I.PREDICTION_STATUS_COPY), ...Object.values(I.EXCLUDED_COPY), I.FACTOR_NOTE, I.ESTIMATE_NOTE, ...Object.values(I.RISK_LABEL), ...Object.values(I.CONFIDENCE_LABEL)].join(' ').toLowerCase();
    for (const p of I.FORBIDDEN_PHRASES) expect(copy).not.toContain(p);
    expect(I.FACTOR_NOTE.toLowerCase()).toContain('do not imply');
  });
  it('formats probabilities and returns', () => {
    expect(I.fmtProb(0.684)).toBe('68%'); expect(I.fmtProb(null)).toBe('n/a');
    expect(I.fmtSignedPct(0.087)).toBe('+8.7%'); expect(I.fmtSignedPct(-0.021)).toBe('−2.1%');
  });
});

describe('fetchIntelligence', () => {
  it('batches symbols (<=50 per request), validates them and merges predictions', async () => {
    const syms = Array.from({ length: 120 }, (_, i) => `S${i}.NS`);
    const invoke = vi.fn(async (_n, { symbols }) => ({ mlStatus: 'ok', model: { version: 'v1.0' }, predictions: Object.fromEntries(symbols.map((s) => [s, okPred()])) }));
    const r = await fetchIntelligence([...syms, 'bad symbol!', syms[0]], invoke);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(Object.keys(r.predictions)).toHaveLength(120);
    expect(invoke.mock.calls.every(([n]) => n === 'ml-predictions')).toBe(true);
  });
  it('never throws: any failure degrades to unavailable so the screener keeps working', async () => {
    expect((await fetchIntelligence(['A'], async () => { throw new Error('boom'); })).mlStatus).toBe('unavailable');
    expect((await fetchIntelligence([], async () => ({}))).mlStatus).toBe('unavailable');
    const ne = await fetchIntelligence(['A'], async () => ({ mlStatus: 'not_enough_data' }));
    expect(ne.mlStatus).toBe('not_enough_data'); expect(ne.predictions).toEqual({});
  });
});

describe('chatbot tool layer (queries the engine; never invents predictions)', () => {
  const holdings = [
    { symbol: 'AAA', name: 'A Corp', marketValue: 600 }, { symbol: 'BBB', name: 'B Corp', marketValue: 300 }, { symbol: 'CCC', name: 'C Corp', marketValue: 100 },
  ];
  const preds = { AAA: okPred({ mlScore: 90, riskLevel: 'high' }), BBB: okPred({ mlScore: 40, riskLevel: 'low' }) };
  const ctx = (status = 'ok') => ({ holdings, ruleScores: { AAA: 60, BBB: 80, CCC: 55 }, fetchIntelligence: async () => ({ mlStatus: status, model: status === 'ok' ? { version: 'v1.0' } : null, predictions: status === 'ok' ? preds : {} }) });

  it('declares JSON-schema tools', () => {
    expect(INTELLIGENCE_TOOLS.map((t) => t.name)).toEqual(['get_stock_intelligence', 'rank_holdings_by_setup', 'portfolio_risk_summary']);
    expect(INTELLIGENCE_TOOLS.every((t) => t.input_schema.type === 'object')).toBe(true);
  });
  it('ranks the user\'s holdings by the blended score using stored model output only', async () => {
    const r = await runIntelligenceTool('rank_holdings_by_setup', { top: 2 }, ctx());
    expect(r.ranked.map((x) => x.symbol)).toEqual(['AAA', 'BBB']);               // 0.6*60+0.4*90=72 > 0.6*80+0.4*40=64 > CCC rule-only 55
    expect(r.ranked[0].intelligenceScore).toBeCloseTo(72); expect(r.modelVersion).toBe('v1.0'); expect(r.note).toMatch(/not guarantees/);
  });
  it('falls back to rule-based ranking when the engine has no validated model', async () => {
    const r = await runIntelligenceTool('rank_holdings_by_setup', {}, ctx('not_enough_data'));
    expect(r.mlStatus).toBe('not_enough_data'); expect(r.ranked.map((x) => x.symbol)).toEqual(['BBB', 'AAA', 'CCC']); expect(r.ranked.every((x) => !x.mlIncludedInScore)).toBe(true);
  });
  it('summarises concentration and model risk, flagging holdings without a model estimate', async () => {
    const r = await runIntelligenceTool('portfolio_risk_summary', {}, ctx());
    expect(r.largestPositions[0]).toMatchObject({ symbol: 'AAA', riskLevel: 'High' });
    expect(r.concentrationIndex).toBeCloseTo(0.36 + 0.09 + 0.01, 4); expect(r.shareInHighRiskPositions).toBeCloseTo(0.6);
    expect(r.positionsWithoutModelEstimate).toEqual(['CCC']);
  });
  it('rejects unknown tools', async () => { await expect(runIntelligenceTool('predict_lottery', {}, ctx())).rejects.toThrow(/Unknown tool/); });
});
