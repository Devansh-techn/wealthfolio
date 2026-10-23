import { describe, it, expect } from 'vitest';
import { futureValue, requiredMonthly, monthsToTarget, analyzeGoal } from '../goals';

describe('goals', () => {
  it('future value with zero return is linear', () => {
    expect(futureValue(1000, 100, 0, 10)).toBe(2000);
  });
  it('required monthly inverts future value', () => {
    const pmt = requiredMonthly(100000, 10000, 8, 60);
    expect(futureValue(10000, pmt, 8, 60)).toBeCloseTo(100000, 0);
  });
  it('months to target with zero return', () => {
    expect(monthsToTarget(1200, 0, 100, 0)).toBe(12);
  });
  it('returns null when never reachable', () => {
    expect(monthsToTarget(1000, 0, 0, 0)).toBeNull();
  });
  it('analyzeGoal reports progress and remaining', () => {
    const now = new Date('2026-01-15T00:00:00');
    const a = analyzeGoal({ target_amount: 10000, current_amount: 2500, monthly_contribution: 500, expected_annual_return: 0, target_date: '2027-01-15' }, now);
    expect(a.progress).toBe(25);
    expect(a.remaining).toBe(7500);
    expect(a.months).toBe(12);
    expect(a.needed).toBeCloseTo(625, 5);
    expect(a.eta).toBe(15);
    expect(a.onTrack).toBe(false);
  });
});
