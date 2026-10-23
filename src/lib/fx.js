/**
 * Pure currency helpers. `fx` shape: { base: 'USD', rates: { USD: 1, INR: n, EUR: n, GBP: n }, asOf: ISO string }
 * Returns null whenever a rate is unavailable — callers must treat null as "unknown",
 * never substitute a made-up rate.
 */
export function convert(amount, from, to, fx) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return null;
  if (!from || !to || from === to) return amount;
  const r = fx?.rates;
  if (!r || !r[from] || !r[to]) return null;
  return (amount / r[from]) * r[to];
}
export const hasRate = (from, to, fx) => from === to || Boolean(fx?.rates?.[from] && fx?.rates?.[to]);
