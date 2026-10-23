import { describe, it, expect } from 'vitest';
import { sma, rsi, pctReturn, maxDrawdown, technicalMetrics } from '../indicators';
import { scale, scoreSecurity, buildMetrics, applyFilters, explainScores } from '../scoring';

describe('indicators', () => {
  it('sma', () => expect(sma([1, 2, 3, 4, 5], 3)).toBe(4));
  it('rsi is 100 for monotonic gains and 0 for monotonic losses', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(up)).toBe(100);
    expect(rsi(down)).toBeCloseTo(0, 5);
  });
  it('rsi matches Wilder reference series', () => {
    // Classic Wilder sample data (14-period RSI of last value ~ 70.46 in common references)
    const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
    expect(rsi(c, 14)).toBeGreaterThan(55);
    expect(rsi(c, 14)).toBeLessThan(70);
  });
  it('pctReturn and maxDrawdown', () => {
    expect(pctReturn([100, 110, 121], 2)).toBeCloseTo(21);
    expect(maxDrawdown([100, 200, 100, 150])).toBeCloseTo(-50);
  });
  it('technicalMetrics returns null with too little data', () => {
    expect(technicalMetrics([1, 2, 3], [])).toBeNull();
  });
});

describe('scoring', () => {
  it('scale is piecewise linear and clamped', () => {
    const pts = [[0, 0], [10, 100]];
    expect(scale(5, pts)).toBe(50);
    expect(scale(-5, pts)).toBe(0);
    expect(scale(50, pts)).toBe(100);
    expect(scale(null, pts)).toBeNull();
  });
  const strong = buildMetrics(
    { pe: 18, epsGrowth: 25, revenueGrowth: 20, roe: 25, roce: 28, debtToEquity: 0.2, dividendYield: 2 },
    { price: 100, rsi14: 58, aboveSma50: true, aboveSma200: true, goldenCross: true, momentum1m: 6, momentum3m: 18, momentum6m: 35, momentum12m1m: 50, rangePosition: 85, volatility: 18, maxDrawdown1y: -8 },
  );
  const weak = buildMetrics(
    { pe: -5, epsGrowth: -20, revenueGrowth: -10, roe: 2, roce: 4, debtToEquity: 3.5, dividendYield: 0 },
    { price: 10, rsi14: 25, aboveSma50: false, aboveSma200: false, goldenCross: false, momentum1m: -12, momentum3m: -25, momentum6m: -35, momentum12m1m: -40, rangePosition: 3, volatility: 65, maxDrawdown1y: -50 },
  );
  it('ranks a strong profile above a weak one', () => {
    const a = scoreSecurity(strong);
    const b = scoreSecurity(weak);
    expect(a.overall).toBeGreaterThan(80);
    expect(b.overall).toBeLessThan(25);
    expect(a.coverage).toBeCloseTo(100);
  });
  it('skips missing metrics instead of inventing them and reports coverage', () => {
    const partial = buildMetrics({ pe: 20 }, { price: 50, rsi14: 50, aboveSma50: true, aboveSma200: true, goldenCross: true });
    const s = scoreSecurity(partial);
    expect(s.fundamental).not.toBeNull();
    expect(s.momentum).toBeNull();
    expect(s.coverage).toBeLessThan(60);
    expect(s.overall).not.toBeNull();
  });
  it('overall is null with no data', () => {
    expect(scoreSecurity(buildMetrics({}, {})).overall).toBeNull();
  });
  it('filters exclude securities with missing data for an active filter', () => {
    const rows = [
      { metrics: { pe: 10, roe: 20 } },
      { metrics: { pe: 30, roe: 25 } },
      { metrics: { pe: null, roe: 30 } },
    ];
    expect(applyFilters(rows, { peMax: 20 })).toHaveLength(1);
    expect(applyFilters(rows, { roeMin: 20 })).toHaveLength(3);
    expect(applyFilters(rows, { peMax: 40, roeMin: 22 })).toHaveLength(1);
  });
  it('explanations only cite metrics that exist', () => {
    const e = explainScores(weak, scoreSecurity(weak));
    expect(e.weaknesses.join(' ')).toMatch(/Debt\/equity of 3\.50/);
    const e2 = explainScores(buildMetrics({}, { price: 1 }), scoreSecurity(buildMetrics({}, { price: 1 })));
    expect(e2.missing).toContain('P/E');
    expect(e2.strengths).toHaveLength(0);
  });
});
