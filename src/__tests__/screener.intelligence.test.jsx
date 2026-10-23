// @vitest-environment jsdom
// The real Screener page with ML layer ok / not-enough-data / failing. Rule-based behaviour must be identical in all cases.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ intel: null }));
vi.mock('../contexts/DataContext', () => ({ useAppData: () => ({ profile: { id: 'u1' }, watchlist: [], mutate: vi.fn() }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('../services/marketDataService', () => ({ getScreenerMetrics: vi.fn() }));
vi.mock('../services/functions', () => ({ invokeFunction: vi.fn(async () => ({ explanation: 'ok' })) }));
vi.mock('../services/intelligenceService', () => ({ fetchIntelligence: vi.fn(() => h.intel()) }));
vi.mock('../services/dataService', () => {
  const metrics = (over) => ({ price: 100, pe: 20, rsi14: 55, aboveSma50: true, aboveSma200: true, goldenCross: true, momentum1m: 2, momentum3m: 8, momentum6m: 15, momentum12m1m: 20, rangePosition: 70, volatility: 25, maxDrawdown1y: -15, roe: 0.2, epsGrowth: 0.15, revenueGrowth: 0.1, debtToEquity: 0.5, ...over });
  return {
    loadScreenerResult: vi.fn(async () => ({ run_at: new Date().toISOString(), results: [
      { symbol: 'AAA.NS', name: 'Alpha Ltd', currency: 'INR', exchange: 'NSE', metrics: metrics({}) },
      { symbol: 'BBB.NS', name: 'Beta Ltd', currency: 'INR', exchange: 'NSE', metrics: metrics({ rsi14: 40, momentum3m: -5, volatility: 40 }) },
    ] })),
    saveScreenerResult: vi.fn(async () => {}),
    watchlist: { create: vi.fn() },
  };
});

import Screener from '../pages/Screener';
import { scoreSecurity } from '../lib/scoring';

const pred = { symbol: 'AAA.NS', predictionDate: '2026-10-05', modelVersion: 'v1.0', status: 'ok', positive3mProbability: 0.68, positive6mProbability: 0.74, expected3mReturn: 0.087, expected6mReturn: 0.142, expectedVolatility3m: 0.24, expectedDrawdown3m: -0.09,
  riskLevel: 'moderate', riskSource: 'ml', mlScore: 80, confidence: 0.62, confidenceLabel: 'medium', dataCompleteness: 1, stale: false, detail: null, confidenceComponents: { data_completeness: 1, model_quality: 0.4 },
  topPositiveFactors: [{ feature: 'ret_6m', label: '6-month return', valueText: '+21.4%', influence: 0.03 }], topNegativeFactors: [{ feature: 'vol_63d', label: '63-day volatility', valueText: '+31.0%', influence: -0.02 }] };
const model = { version: 'v1.0', trainingEnd: '2025-06-30', blendWeights: { rule: 0.6, ml: 0.4 }, evidence: { rocAuc: 0.571, baselineRocAuc: 0.532, ece: 0.031 } };

beforeEach(() => cleanup());
const ruleOverall = (over) => scoreSecurity({ price: 100, pe: 20, rsi14: 55, aboveSma50: true, aboveSma200: true, goldenCross: true, momentum1m: 2, momentum3m: 8, momentum6m: 15, momentum12m1m: 20, rangePosition: 70, volatility: 25, maxDrawdown1y: -15, roe: 0.2, epsGrowth: 0.15, revenueGrowth: 0.1, debtToEquity: 0.5, ...over }).overall;

describe('Screener + WealthFolio Intelligence', () => {
  it('shows the blended Intelligence score, ML probability and confidence when a validated model exists', async () => {
    h.intel = async () => ({ mlStatus: 'ok', model, predictions: { 'AAA.NS': pred } });
    render(<Screener />);
    const row = (await screen.findByText('Alpha Ltd')).closest('tr');
    await waitFor(() => expect(within(row).getByText('68%')).toBeTruthy());
    expect(within(row).getByText('Medium')).toBeTruthy();
    const expected = Math.round(0.6 * ruleOverall({}) + 0.4 * 80);
    expect(within(row).getAllByRole('cell').some((c) => c.textContent === String(expected))).toBe(true);
    // the untouched rule score is still shown in its own column
    expect(within(row).getAllByRole('cell').some((c) => c.textContent === String(Math.round(ruleOverall({}))))).toBe(true);
    // a stock without an ML estimate falls back to the rule score
    const row2 = screen.getByText('Beta Ltd').closest('tr');
    expect(within(row2).getAllByText('–').length).toBeGreaterThanOrEqual(2);
  });

  it('detail view explains components, estimates, factors, and never claims certainty', async () => {
    h.intel = async () => ({ mlStatus: 'ok', model, predictions: { 'AAA.NS': pred } });
    render(<Screener />);
    fireEvent.click(await screen.findByText('Alpha Ltd'));
    expect(await screen.findByLabelText('WealthFolio Intelligence')).toBeTruthy();
    const box = screen.getByLabelText('WealthFolio Intelligence');
    for (const t of [/chance of a positive 3-month return/i, /68%/, /74%/, /\+8\.7%/, /model estimates/i, /not guarantees/i, /raised the estimate/i, /6-month return: \+21\.4%/, /lowered the estimate/i, /do not imply that they caused/i, /ROC-AUC 0\.571 vs 0\.532/, /v1\.0/]) expect(box.textContent).toMatch(t);
    expect(box.textContent).toMatch(/60% rule-based score \+ 40% ML signal/);
    const all = document.body.textContent.toLowerCase();
    for (const bad of ['guaranteed', 'risk-free', 'certain to', 'will rise']) expect(all).not.toContain(bad);
    // Explain with AI keeps working and is handed the rule + intelligence scores (ML numbers are looked up server-side)
    const { invokeFunction } = await import('../services/functions');
    fireEvent.click(screen.getByText(/explain with ai/i));
    await waitFor(() => expect(invokeFunction).toHaveBeenCalled());
    const [name, body] = invokeFunction.mock.calls.at(-1);
    expect(name).toBe('explain-stock'); expect(body.scores.rule).toBeCloseTo(ruleOverall({}), 6); expect(body.scores.intelligence).toBeCloseTo(0.6 * ruleOverall({}) + 0.4 * 80, 6);
    expect(JSON.stringify(body)).not.toMatch(/0\.68|positive3m/);
  });

  it.each([['not_enough_data', /not enough validated historical data/i], ['insufficient_evidence', /did not show enough evidence/i], ['unavailable', /temporarily unavailable/i]])('falls back to rule-based scores when ML is %s', async (status, msg) => {
    h.intel = async () => ({ mlStatus: status, model: null, predictions: {} });
    render(<Screener />);
    const row = (await screen.findByText('Alpha Ltd')).closest('tr');
    expect(await screen.findByText(msg)).toBeTruthy();
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.filter((c) => c === String(Math.round(ruleOverall({})))).length).toBeGreaterThanOrEqual(2); // Overall and Intel. are identical
    expect(document.body.textContent).not.toMatch(/68%/);
  });

  it('survives the ML request failing outright', async () => {
    h.intel = async () => ({ mlStatus: 'unavailable', model: null, predictions: {}, reason: 'x' });
    render(<Screener />);
    expect(await screen.findByText('Alpha Ltd')).toBeTruthy();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });
});
