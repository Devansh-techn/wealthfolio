import { convert } from './fx';

export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + delta, 1));
};
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
};

/**
 * Items (income/expense rows) that fall in month `ym`.
 * Recurring items count once per month from their start month until recurrence_end.
 */
export function itemsForMonth(items, dateKey, ym) {
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-31`;
  return items.filter((it) => {
    const d = it[dateKey];
    if (!it.is_recurring) return d >= monthStart && d <= monthEnd;
    const startYm = d.slice(0, 7);
    if (startYm > ym) return false;
    if (it.recurrence_end && it.recurrence_end.slice(0, 7) < ym) return false;
    return true;
  });
}

export function totalFor(items, target, fx) {
  let total = 0;
  let missing = 0;
  for (const it of items) {
    const c = convert(Number(it.amount), it.currency, target, fx);
    if (c === null) missing += 1;
    else total += c;
  }
  return { total, missing };
}

export function breakdownByCategory(items, target, fx) {
  const map = {};
  for (const it of items) {
    const c = convert(Number(it.amount), it.currency, target, fx);
    if (c === null) continue;
    map[it.category] = (map[it.category] ?? 0) + c;
  }
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  return Object.entries(map)
    .map(([category, value]) => ({ category, value, pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function budgetProgress(budgets, spendByCategory, target, fx) {
  return budgets.map((b) => {
    const limit = convert(Number(b.monthly_limit), b.currency, target, fx);
    const spent = spendByCategory.find((s) => s.category === b.category)?.value ?? 0;
    const pct = limit && limit > 0 ? (spent / limit) * 100 : 0;
    return { budget: b, limit, spent, pct, status: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
  });
}
