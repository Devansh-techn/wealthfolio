// Pure view-model helpers for the dashboard. Everything is derived from real application data; nothing is estimated.

const CATEGORY_OF = { Stock: 'Equities', ETF: 'Equities', 'Mutual Fund': 'Mutual Funds', Crypto: 'Crypto', 'Real Estate': 'Real Estate', Cash: 'Cash', Gold: 'Other', Bond: 'Other', Other: 'Other' };
export const ALLOCATION_CATEGORIES = ['Equities', 'Mutual Funds', 'Crypto', 'Real Estate', 'Cash', 'Other'];
// Restrained palette: emerald family, champagne, bronze, slate. No purple/blue.
export const ALLOCATION_COLORS = { Equities: '#3da679', 'Mutual Funds': '#79c4a5', Crypto: '#c8a96b', 'Real Estate': '#8c7a52', Cash: '#6f8f99', Other: '#5b5d60' };

/** summary.allocation = [{ type, value }] (already converted to the display currency) -> six fixed categories. */
export function groupAllocation(allocation = []) {
  const totals = Object.fromEntries(ALLOCATION_CATEGORIES.map((c) => [c, 0]));
  for (const a of allocation) {
    if (a.value > 0) totals[CATEGORY_OF[a.type] ?? 'Other'] += a.value;
  }
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  return { total, rows: ALLOCATION_CATEGORIES.map((label) => ({ label, value: totals[label], color: ALLOCATION_COLORS[label], pct: total > 0 ? (totals[label] / total) * 100 : 0 })) };
}

/**
 * Performance over the visible period = change in value MINUS new money put in, so deposits are not shown as gains.
 * points: [{ value, netInvested }] ascending. Returns null when it cannot be computed honestly.
 */
export function periodPerformance(points) {
  if (!points || points.length < 2) return null;
  const a = points[0];
  const b = points[points.length - 1];
  if (![a.value, b.value, a.netInvested, b.netInvested].every(Number.isFinite)) return null;
  const pnl = b.value - a.value - (b.netInvested - a.netInvested);
  return { pnl, pct: a.value > 0 ? (pnl / a.value) * 100 : null, valueChange: b.value - a.value };
}

const ts = (v) => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Merge real records into one chronological feed. */
export function buildActivity({ transactions = [], assets = [], watchlist = [], portfolios = [], assetsById = {}, pricesUpdatedAt = null, limit = 8 }) {
  const items = [];
  for (const t of transactions) {
    const at = ts(t.created_at) ?? ts(t.transaction_date);
    if (at === null) continue;
    const a = assetsById[t.asset_id];
    items.push({ id: `tx-${t.id}`, kind: 'transaction', at, title: `${t.type}${a ? ` · ${a.name}` : ''}`, detail: t.transaction_date, amount: { value: Number(t.quantity) * Number(t.price), currency: t.currency } });
  }
  for (const a of assets) {
    const at = ts(a.created_at);
    if (at !== null) items.push({ id: `as-${a.id}`, kind: 'asset', at, title: 'Asset added', detail: `${a.name}${a.symbol ? ` · ${a.symbol}` : ''}` });
  }
  for (const w of watchlist) {
    const at = ts(w.created_at);
    if (at !== null) items.push({ id: `wl-${w.id}`, kind: 'watchlist', at, title: 'Added to watchlist', detail: w.symbol });
  }
  // The earliest portfolio is the default one created automatically with the account, not something the user did.
  const created = [...portfolios].sort((a, b) => (ts(a.created_at) ?? 0) - (ts(b.created_at) ?? 0)).slice(1);
  for (const p of created) {
    const at = ts(p.created_at);
    if (at !== null) items.push({ id: `pf-${p.id}`, kind: 'portfolio', at, title: 'Portfolio created', detail: p.name });
  }
  const priced = ts(pricesUpdatedAt);
  if (priced !== null) items.push({ id: 'prices', kind: 'prices', at: priced, title: 'Prices updated', detail: 'Market prices refreshed' });
  return items.sort((x, y) => y.at - x.at).slice(0, limit);
}

/** Last N points (used for 1D: previous close -> latest, since the data source provides daily history only). */
export const lastPoints = (points, n) => (points.length > n ? points.slice(points.length - n) : points);
