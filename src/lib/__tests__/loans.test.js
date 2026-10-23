import { describe, it, expect } from 'vitest';
import { calcEmi, buildSchedule, summarizeByYear } from '../loans';

describe('loans', () => {
  it('computes the standard EMI', () => {
    // 10,00,000 @ 8.5% for 20y => ~8678.23 (well-known reference value)
    expect(calcEmi(1_000_000, 8.5, 240)).toBeCloseTo(8678.23, 1);
  });
  it('handles zero interest', () => {
    expect(calcEmi(120000, 0, 12)).toBe(10000);
  });
  it('schedule amortises to zero and totals reconcile', () => {
    const s = buildSchedule({ principal: 500000, annualRate: 9, months: 60 });
    expect(s.rows.length).toBe(60);
    expect(s.rows.at(-1).balance).toBeCloseTo(0, 2);
    expect(s.totalPaid).toBeCloseTo(500000 + s.totalInterest, 2);
    expect(s.totalInterest).toBeCloseTo(s.emi * 60 - 500000, 1);
  });
  it('prepayment shortens tenure and saves interest', () => {
    const base = buildSchedule({ principal: 1_000_000, annualRate: 8.5, months: 240 });
    const pre = buildSchedule({ principal: 1_000_000, annualRate: 8.5, months: 240, extraMonthly: 5000, lumpSums: [{ month: 12, amount: 100000 }] });
    expect(pre.months).toBeLessThan(base.months);
    expect(pre.totalInterest).toBeLessThan(base.totalInterest);
    expect(pre.rows.at(-1).balance).toBeCloseTo(0, 2);
  });
  it('yearly summary balance matches schedule', () => {
    const s = buildSchedule({ principal: 300000, annualRate: 10, months: 36 });
    const y = summarizeByYear(s.rows);
    expect(y).toHaveLength(3);
    expect(y[2].balance).toBeCloseTo(0, 2);
  });
});
