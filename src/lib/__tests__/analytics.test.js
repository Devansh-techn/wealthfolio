import { describe, it, expect } from 'vitest';
import { buildValueSeries, seriesStats, riskScore } from '../analytics';

const assetsById = { a: { id: 'a', name: 'X', asset_type: 'Stock', currency: 'USD', price_source: 'market' } };
const fx = { base: 'USD', rates: { USD: 1 } };

function mkHistory(n, f) {
  const out = [];
  const d = new Date('2025-01-01T00:00:00');
  for (let i = 0; i < n; i += 1) {
    const x = new Date(d.getTime() + i * 86400000);
    out.push({ date: x.toISOString().slice(0, 10), close: f(i) });
  }
  return out;
}

describe('buildValueSeries + seriesStats', () => {
  it('time-weighted return ignores contributions', () => {
    // price doubles from 100 to 200 over 100 days; a second buy mid-way must not distort TWR
    const hist = mkHistory(101, (i) => 100 + i);
    const tx = [
      { asset_id: 'a', type: 'BUY', quantity: 10, price: 100, fees: 0, transaction_date: '2025-01-01', created_at: '1' },
      { asset_id: 'a', type: 'BUY', quantity: 10, price: 150, fees: 0, transaction_date: hist[50].date, created_at: '2' },
    ];
    const { points } = buildValueSeries({ transactions: tx, assetsById, histories: { a: hist }, target: 'USD', fx, startDate: '2025-01-01', endDate: hist[100].date });
    expect(points[0].value).toBe(1000);
    expect(points.at(-1).value).toBeCloseTo(20 * 200);
    const s = seriesStats(points);
    expect(s.totalReturn).toBeCloseTo(100, 0); // price went 100 -> 200
    expect(s.maxDrawdown).toBeCloseTo(0, 5);
  });

  it('detects drawdown and positive volatility', () => {
    const closes = [100, 110, 120, 90, 95, 100, 105, 110, 100, 95, 100, 105, 110, 115, 120, 118, 119, 121, 125, 124, 123, 126, 130, 128, 127];
    const hist = mkHistory(closes.length, (i) => closes[i]);
    const tx = [{ asset_id: 'a', type: 'BUY', quantity: 1, price: 100, fees: 0, transaction_date: '2025-01-01', created_at: '1' }];
    const { points } = buildValueSeries({ transactions: tx, assetsById, histories: { a: hist }, target: 'USD', fx, startDate: '2025-01-01', endDate: hist.at(-1).date });
    const s = seriesStats(points);
    expect(s.maxDrawdown).toBeCloseTo((90 / 120 - 1) * 100, 5);
    expect(s.volatility).toBeGreaterThan(0);
  });

  it('flags missing FX rather than inventing one', () => {
    const a2 = { a: { ...assetsById.a, currency: 'INR' } };
    const hist = mkHistory(5, () => 10);
    const tx = [{ asset_id: 'a', type: 'BUY', quantity: 1, price: 10, fees: 0, transaction_date: '2025-01-01', created_at: '1' }];
    const r = buildValueSeries({ transactions: tx, assetsById: a2, histories: { a: hist }, target: 'USD', fx: null, startDate: '2025-01-01', endDate: hist.at(-1).date });
    expect(r.missingFx).toBe(true);
  });
});

describe('riskScore', () => {
  it('rises with volatility, drawdown and concentration', () => {
    const lo = riskScore({ volatility: 8, maxDrawdown: -5, hhi: 0.08 });
    const hi = riskScore({ volatility: 45, maxDrawdown: -55, hhi: 0.6 });
    expect(lo.score).toBeLessThan(25);
    expect(hi.label).toBe('Very high');
    expect(hi.score).toBeGreaterThan(lo.score);
  });
  it('returns null with no inputs', () => {
    expect(riskScore({})).toBeNull();
  });
});
