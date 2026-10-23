// How trustworthy is a timestamp? Used for market prices and bank syncs. Uses PROVIDER timestamps, never "now".
export const MARKET_FRESHNESS = {
  realtime: { label: 'Real-time', tone: 'ok' },
  delayed: { label: 'Delayed', tone: 'ok' },
  end_of_day: { label: 'End of day', tone: 'muted' },
  stale: { label: 'Stale', tone: 'warn' },
  unavailable: { label: 'Unavailable', tone: 'error' },
};
const MIN = 60_000;

/**
 * asOf: provider timestamp (ms or ISO). marketOpen: from provider session data (true/false) or null if unknown.
 * feed: what the provider says it delivers ('realtime' | 'delayed'). Free web sources for NSE/BSE are delayed.
 */
export function classifyMarketFreshness({ asOf, now = Date.now(), marketOpen = null, feed = 'delayed' }) {
  const t = typeof asOf === 'string' ? Date.parse(asOf) : asOf;
  if (!Number.isFinite(t)) return 'unavailable';
  const age = now - t;
  if (age < -5 * MIN) return 'unavailable';                 // a timestamp from the future is not trustworthy
  const live = feed === 'realtime' ? 'realtime' : 'delayed';
  if (marketOpen === true) return age <= 30 * MIN ? live : 'stale';
  if (marketOpen === false) return age <= 4 * 86_400_000 ? 'end_of_day' : 'stale';
  if (age <= 30 * MIN) return live;
  return age <= 4 * 86_400_000 ? 'end_of_day' : 'stale';
}

export function ageLabel(asOf, now = Date.now()) {
  const t = typeof asOf === 'string' ? Date.parse(asOf) : asOf;
  if (!Number.isFinite(t)) return '—';
  const m = Math.max(0, Math.round((now - t) / MIN));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** Bank sync: 'never' | 'fresh' | 'stale' (default stale after 36 h, since providers refresh periodically, not instantly). */
export function classifySync(lastSyncedAt, now = Date.now(), staleHours = 36) {
  const t = typeof lastSyncedAt === 'string' ? Date.parse(lastSyncedAt) : lastSyncedAt;
  if (!Number.isFinite(t)) return 'never';
  return now - t > staleHours * 3_600_000 ? 'stale' : 'fresh';
}
