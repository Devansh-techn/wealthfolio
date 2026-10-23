const monthsUntil = (isoDate, from = new Date()) => {
  const t = new Date(`${isoDate}T00:00:00`);
  const months = (t.getFullYear() - from.getFullYear()) * 12 + (t.getMonth() - from.getMonth()) + (t.getDate() >= from.getDate() ? 0 : -1);
  return Math.max(Math.ceil(months), 0);
};

const monthlyRate = (annualPct) => Math.pow(1 + annualPct / 100, 1 / 12) - 1;

/** Future value of a lump sum plus monthly contributions (end of month). */
export function futureValue(current, monthly, annualPct, months) {
  const i = monthlyRate(annualPct);
  if (Math.abs(i) < 1e-12) return current + monthly * months;
  const f = Math.pow(1 + i, months);
  return current * f + monthly * ((f - 1) / i);
}

export function requiredMonthly(target, current, annualPct, months) {
  if (months <= 0) return Math.max(target - current, 0);
  const i = monthlyRate(annualPct);
  if (Math.abs(i) < 1e-12) return Math.max((target - current) / months, 0);
  const f = Math.pow(1 + i, months);
  return Math.max(((target - current * f) * i) / (f - 1), 0);
}

/** Months until the balance reaches the target with the current contribution; null if never (within 100y). */
export function monthsToTarget(target, current, monthly, annualPct) {
  if (current >= target) return 0;
  const i = monthlyRate(annualPct);
  let bal = current;
  for (let m = 1; m <= 1200; m += 1) {
    bal = bal * (1 + i) + monthly;
    if (bal >= target) return m;
  }
  return null;
}

export function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

export function analyzeGoal(goal, now = new Date()) {
  const target = Number(goal.target_amount);
  const current = Number(goal.current_amount);
  const monthly = Number(goal.monthly_contribution);
  const rate = Number(goal.expected_annual_return);
  const months = monthsUntil(goal.target_date, now);
  const progress = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const remaining = Math.max(target - current, 0);
  const needed = requiredMonthly(target, current, rate, months);
  const eta = monthsToTarget(target, current, monthly, rate);
  const projectedAtDate = futureValue(current, monthly, rate, months);
  const completionDate = eta === null ? null : addMonths(now, eta);
  const onTrack = current >= target || projectedAtDate >= target;

  // projection series (monthly, capped to 120 points)
  const horizon = Math.max(months, eta ?? 0, 1);
  const step = Math.max(Math.ceil(horizon / 120), 1);
  const series = [];
  for (let m = 0; m <= horizon; m += step) {
    series.push({ month: m, value: futureValue(current, monthly, rate, m), date: addMonths(now, m).toISOString().slice(0, 10) });
  }
  return { target, current, months, progress, remaining, needed, eta, completionDate, projectedAtDate, onTrack, series };
}
