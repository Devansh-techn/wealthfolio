import { describe, it, expect } from 'vitest';
import { ALLOCATION, NET_WORTH, NET_WORTH_GROWTH_PCT, NET_WORTH_SERIES, PORTFOLIO_GAIN, PORTFOLIO_GROWTH_PCT, PORTFOLIO_SERIES, PORTFOLIO_VALUE, amountLakh, fmtLakh } from '../components/hero/heroData';

describe('hero demo data is internally consistent', () => {
  it('allocation totals 100% and amounts add up to net worth', () => {
    expect(ALLOCATION.reduce((s, a) => s + a.pct, 0)).toBe(100);
    expect(ALLOCATION.reduce((s, a) => s + amountLakh(a.pct), 0)).toBeCloseTo(NET_WORTH, 9);
    // displayed (2-dp) amounts also sum to the displayed net worth
    expect(ALLOCATION.reduce((s, a) => s + Number(amountLakh(a.pct).toFixed(2)), 0)).toBeCloseTo(NET_WORTH, 6);
  });
  it('portfolio chart rises and matches the headline numbers', () => {
    expect(PORTFOLIO_SERIES.length).toBe(12);
    expect(PORTFOLIO_SERIES[11]).toBeGreaterThan(PORTFOLIO_SERIES[0]);
    // every 3-month window is higher than the one before (clearly rising, no fake crash)
    for (let i = 3; i < 12; i++) expect(PORTFOLIO_SERIES[i]).toBeGreaterThan(PORTFOLIO_SERIES[i - 3]);
    expect(PORTFOLIO_GROWTH_PCT.toFixed(2)).toBe('18.42');
    expect(fmtLakh(PORTFOLIO_VALUE)).toBe('₹17.4L');
    expect(Number(fmtLakh(PORTFOLIO_SERIES[0]).replace(/[₹L]/g, '')) + Number(fmtLakh(PORTFOLIO_GAIN).replace(/[₹L]/g, ''))).toBeCloseTo(17.4, 6);
  });
  it('net worth series ends at net worth and grows 12.6%', () => {
    expect(NET_WORTH_SERIES[11]).toBeCloseTo(NET_WORTH, 9);
    expect(NET_WORTH_GROWTH_PCT.toFixed(1)).toBe('12.6');
  });
});
