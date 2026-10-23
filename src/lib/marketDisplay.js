import { classifyMarketFreshness } from './bank/freshness';

/** Real-time / Delayed / End of day / Stale / Unavailable for one quote, from the provider's timestamp. */
export function quoteFreshness(q) {
  if (!q || q.ok === false) return 'unavailable';
  const f = classifyMarketFreshness({ asOf: q.asOf, marketOpen: q.marketOpen ?? null, feed: q.feed ?? 'delayed' });
  return q.lastKnown && f !== 'unavailable' ? 'stale' : f;      // a carried-over observation is never shown as current
}

export const INDICES = [
  { symbol: '^NSEI', name: 'NIFTY 50' },
  { symbol: '^NSEBANK', name: 'NIFTY BANK' },
  { symbol: '^BSESN', name: 'SENSEX' },
];
export const points = (v) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
