import { describe, it, expect } from 'vitest';
import { valueHoldings, summarizeHoldings, replayTransactions, concentration } from '../portfolio';
import { convert } from '../fx';

const fx = { base: 'USD', rates: { USD: 1, INR: 80, EUR: 0.9, GBP: 0.8 } };
const assets = {
  a1: { id: 'a1', symbol: 'AAPL', name: 'Apple', asset_type: 'Stock', currency: 'USD', current_price: 120, previous_close: 100 },
  a2: { id: 'a2', symbol: 'TCS.NS', name: 'TCS', asset_type: 'Stock', currency: 'INR', current_price: 4000, previous_close: 4000 },
  a3: { id: 'a3', name: 'Cash', asset_type: 'Cash', currency: 'INR', current_price: 999 },
};
const holdings = [
  { id: 'h1', portfolio_id: 'p', asset_id: 'a1', quantity: '10', average_buy_price: '90', invested_amount: '900' },
  { id: 'h2', portfolio_id: 'p', asset_id: 'a2', quantity: '5', average_buy_price: '3000', invested_amount: '15000' },
  { id: 'h3', portfolio_id: 'p', asset_id: 'a3', quantity: '8000', average_buy_price: '1', invested_amount: '8000' },
];

describe('fx', () => {
  it('converts via base and returns null when rate missing', () => {
    expect(convert(80, 'INR', 'USD', fx)).toBeCloseTo(1);
    expect(convert(1, 'USD', 'EUR', fx)).toBeCloseTo(0.9);
    expect(convert(1, 'USD', 'JPY', fx)).toBeNull();
    expect(convert(5, 'USD', 'USD', null)).toBe(5);
  });
});

describe('portfolio valuation', () => {
  const rows = valueHoldings({ holdings, assetsById: assets, target: 'USD', fx });
  it('computes P&L and return per row', () => {
    const apple = rows.find((r) => r.symbol === 'AAPL');
    expect(apple.value).toBe(1200);
    expect(apple.pnl).toBe(300);
    expect(apple.returnPct).toBeCloseTo(33.333, 2);
    expect(apple.dayPnl).toBe(200);
  });
  it('treats cash as 1:1 regardless of stored price', () => {
    const cash = rows.find((r) => r.type === 'Cash');
    expect(cash.value).toBe(8000);
    expect(cash.pnl).toBe(0);
  });
  it('summarises across currencies, with liabilities', () => {
    const s = summarizeHoldings(rows, [{ outstanding: '8000', currency: 'INR' }], { target: 'USD', fx });
    // AAPL 1200 + TCS 20000/80=250 + cash 8000/80=100 = 1550
    expect(s.portfolioValue).toBeCloseTo(1550);
    expect(s.cash).toBeCloseTo(100);
    expect(s.investedAmount).toBeCloseTo(900 + 15000 / 80);
    expect(s.pnl).toBeCloseTo(300 + (20000 - 15000) / 80);
    expect(s.netWorth).toBeCloseTo(1550 - 100);
    expect(s.incomplete).toBe(false);
    const total = s.allocation.reduce((a, x) => a + x.pct, 0);
    expect(total).toBeCloseTo(100);
  });
  it('flags incomplete totals instead of inventing a rate', () => {
    const s = summarizeHoldings(valueHoldings({ holdings, assetsById: assets, target: 'USD', fx: null }), [], { target: 'USD', fx: null });
    expect(s.incomplete).toBe(true);
    expect(s.missingCount).toBe(2);
  });
});

describe('replayTransactions', () => {
  it('matches average-cost realized P&L and tracks dividends', () => {
    const tx = [
      { portfolio_id: 'p', asset_id: 'a', type: 'BUY', quantity: 10, price: 100, fees: 10, currency: 'INR', transaction_date: '2025-01-01' },
      { portfolio_id: 'p', asset_id: 'a', type: 'BUY', quantity: 10, price: 200, fees: 0, currency: 'INR', transaction_date: '2025-02-01' },
      { portfolio_id: 'p', asset_id: 'a', type: 'SELL', quantity: 5, price: 300, fees: 0, currency: 'INR', transaction_date: '2025-03-01' },
      { portfolio_id: 'p', asset_id: 'a', type: 'DIVIDEND', quantity: 1, price: 50, fees: 0, currency: 'INR', transaction_date: '2025-03-02' },
    ];
    const r = replayTransactions(tx);
    // avg cost 150.5 -> realized = 5*300 - 5*150.5 = 747.5 (same as DB trigger result)
    expect(r.realized[0].amount).toBeCloseTo(747.5);
    expect(r.dividends[0].amount).toBe(50);
  });
});

describe('concentration', () => {
  it('computes weights, HHI and effective N', () => {
    const rows = [
      { valueC: 50, type: 'Stock', name: 'A' },
      { valueC: 50, type: 'Stock', name: 'B' },
      { valueC: 100, type: 'Cash', name: 'Cash' },
    ];
    const c = concentration(rows);
    expect(c.top1).toBeCloseTo(50);
    expect(c.hhi).toBeCloseTo(0.5);
    expect(c.effectiveN).toBeCloseTo(2);
  });
});
