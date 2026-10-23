import { describe, it, expect } from 'vitest';
import { groupAllocation, periodPerformance, buildActivity, lastPoints, ALLOCATION_CATEGORIES } from '../lib/dashboardData';
import { exchangeStatus, EXCHANGES } from '../lib/marketHours';

describe('groupAllocation', () => {
  it('maps asset types onto the six categories and computes real percentages', () => {
    const g = groupAllocation([{ type: 'Stock', value: 500 }, { type: 'ETF', value: 100 }, { type: 'Mutual Fund', value: 200 }, { type: 'Gold', value: 50 }, { type: 'Cash', value: 150 }]);
    expect(g.rows.map((r) => r.label)).toEqual(ALLOCATION_CATEGORIES);
    expect(g.total).toBe(1000);
    expect(Object.fromEntries(g.rows.map((r) => [r.label, r.value]))).toEqual({ Equities: 600, 'Mutual Funds': 200, Crypto: 0, 'Real Estate': 0, Cash: 150, Other: 50 });
    expect(g.rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 9);
  });
  it('invents nothing when there are no assets', () => {
    const g = groupAllocation([]);
    expect(g.total).toBe(0);
    expect(g.rows.every((r) => r.value === 0 && r.pct === 0)).toBe(true);
  });
  it('ignores non-positive values', () => expect(groupAllocation([{ type: 'Stock', value: -5 }]).total).toBe(0));
});

describe('periodPerformance', () => {
  it('excludes new money: a deposit is not a gain', () => {
    const p = periodPerformance([{ value: 1000, netInvested: 1000 }, { value: 2100, netInvested: 2000 }]);
    expect(p.pnl).toBe(100); expect(p.valueChange).toBe(1100); expect(p.pct).toBeCloseTo(10);
  });
  it('is null (shown as —) when it cannot be computed honestly', () => {
    expect(periodPerformance([])).toBeNull();
    expect(periodPerformance([{ value: 1, netInvested: 1 }])).toBeNull();
    expect(periodPerformance([{ value: NaN, netInvested: 1 }, { value: 2, netInvested: 1 }])).toBeNull();
    expect(periodPerformance([{ value: 0, netInvested: 0 }, { value: 50, netInvested: 50 }]).pct).toBeNull();
  });
  it('lastPoints keeps the tail', () => expect(lastPoints([1, 2, 3, 4], 2)).toEqual([3, 4]));
});

describe('buildActivity', () => {
  const assetsById = { a1: { id: 'a1', name: 'Reliance Industries', symbol: 'RELIANCE.NS' } };
  it('merges real records newest-first and labels them', () => {
    const feed = buildActivity({
      transactions: [{ id: 't1', asset_id: 'a1', type: 'BUY', quantity: 2, price: 1000, currency: 'INR', transaction_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z' }],
      assets: [{ id: 'a1', name: 'Reliance Industries', symbol: 'RELIANCE.NS', created_at: '2026-10-01T09:59:00Z' }],
      watchlist: [{ id: 'w1', symbol: 'TCS.NS', created_at: '2026-10-02T08:00:00Z' }],
      portfolios: [{ id: 'p0', name: 'Main (default)', created_at: '2026-09-29T00:00:00Z' }, { id: 'p1', name: 'Retirement', created_at: '2026-09-30T00:00:00Z' }],
      assetsById, pricesUpdatedAt: '2026-10-03T12:00:00Z',
    });
    expect(feed.map((f) => f.kind)).toEqual(['prices', 'watchlist', 'transaction', 'asset', 'portfolio']);
    expect(feed[2]).toMatchObject({ title: 'BUY · Reliance Industries', amount: { value: 2000, currency: 'INR' } });
  });
  it('does not count the auto-created default portfolio as activity', () => {
    expect(buildActivity({ portfolios: [{ id: 'p0', name: 'Main', created_at: '2026-09-29T00:00:00Z' }] })).toEqual([]);
  });
  it('is empty for an empty account and skips unparseable dates', () => {
    expect(buildActivity({})).toEqual([]);
    expect(buildActivity({ assets: [{ id: 'x', name: 'n', created_at: 'garbage' }] })).toEqual([]);
  });
  it('respects the limit', () => {
    const assets = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: `A${i}`, created_at: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
    expect(buildActivity({ assets, limit: 5 })).toHaveLength(5);
  });
});

describe('market hours (regular sessions only)', () => {
  const [nse, us] = EXCHANGES;
  it('NSE: open Thursday 11:00 IST, closed before 09:15, after 15:30, and at weekends', () => {
    expect(exchangeStatus(nse, new Date('2026-10-08T05:30:00Z')).open).toBe(true);   // 11:00 IST Thursday
    expect(exchangeStatus(nse, new Date('2026-10-08T03:30:00Z')).open).toBe(false);  // 09:00 IST
    expect(exchangeStatus(nse, new Date('2026-10-08T10:30:00Z')).open).toBe(false);  // 16:00 IST
    expect(exchangeStatus(nse, new Date('2026-10-10T05:30:00Z')).open).toBe(false);  // Saturday
  });
  it('US: handles daylight saving (EDT in October)', () => {
    expect(exchangeStatus(us, new Date('2026-10-08T14:00:00Z')).open).toBe(true);    // 10:00 EDT
    expect(exchangeStatus(us, new Date('2026-10-08T13:00:00Z')).open).toBe(false);   // 09:00 EDT
    expect(exchangeStatus(us, new Date('2026-10-08T20:30:00Z')).open).toBe(false);   // 16:30 EDT
  });
});

import { formatMoney } from '../lib/format';
describe('compact money (regression: Indian locale printed ₹10,000 as "₹10T")', () => {
  it('uses K / L / Cr for rupees', () => {
    expect(formatMoney(10000, 'INR', { compact: true })).toBe('₹10K');
    expect(formatMoney(150000, 'INR', { compact: true })).toBe('₹1.5L');
    expect(formatMoney(1284320.5, 'INR', { compact: true })).toBe('₹12.84L');
    expect(formatMoney(25000000, 'INR', { compact: true })).toBe('₹2.5Cr');
    expect(formatMoney(950, 'INR', { compact: true })).toBe('₹950');
    expect(formatMoney(-150000, 'INR', { compact: true })).toBe('-₹1.5L');
  });
  it('never produces a "T" (trillion-looking) unit for small rupee amounts, and leaves other currencies alone', () => {
    expect(formatMoney(10000, 'INR', { compact: true })).not.toMatch(/T/);
    expect(formatMoney(10000, 'USD', { compact: true })).toBe('$10K');
  });
  it('keeps full-precision INR grouping for the hero figure', () => {
    expect(formatMoney(1284320.5, 'INR', { maxFraction: 2 })).toBe('₹12,84,320.50');
  });
});
