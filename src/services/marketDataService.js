// Market-data abstraction. UI code only talks to this module, never to a provider directly.
//   getQuote(symbol) / getQuotes(symbols) / getHistoricalPrices(symbol, period) /
//   searchAssets(query) / getFundamentals(symbol|symbols) / getScreenerMetrics(symbols)
// In production the provider is always `live`. The synthetic demo provider exists for local UI work only.
import live from './market/liveProvider';

export const isDemoMode = import.meta.env.DEV && import.meta.env.VITE_MARKET_PROVIDER === 'demo';

let demoProvider = null;
async function provider() {
  // The condition is written inline (not via a constant) so the bundler can statically remove this
  // whole branch, and the demo module with it, from production builds.
  if (import.meta.env.DEV && import.meta.env.VITE_MARKET_PROVIDER === 'demo') {
    if (!demoProvider) demoProvider = (await import('./market/demoProvider.js')).default;
    return demoProvider;
  }
  return live;
}

const quoteCache = new Map(); // symbol -> { at, quote }
const histCache = new Map(); // `${symbol}|${period}` -> { at, points }
const QUOTE_TTL = 60 * 1000;
const HIST_TTL = 30 * 60 * 1000;

export async function getQuotes(symbols, { force = false } = {}) {
  const unique = [...new Set(symbols.filter(Boolean))];
  const now = Date.now();
  const result = new Map();
  const need = [];
  for (const s of unique) {
    const c = quoteCache.get(s);
    if (!force && c && now - c.at < QUOTE_TTL) result.set(s, c.quote);
    else need.push(s);
  }
  const p = await provider();
  for (let i = 0; i < need.length; i += 30) {
    const batch = need.slice(i, i + 30);
    const quotes = await p.quotes(batch);
    for (const q of quotes) {
      result.set(q.symbol, q);
      if (q.ok) quoteCache.set(q.symbol, { at: Date.now(), quote: q });
    }
  }
  return unique.map((s) => result.get(s) ?? { symbol: s, ok: false, error: 'No data' });
}

export async function getQuote(symbol, opts) {
  return (await getQuotes([symbol], opts))[0];
}

export async function getHistoricalPrices(symbol, period = '1y') {
  const key = `${symbol}|${period}`;
  const c = histCache.get(key);
  if (c && Date.now() - c.at < HIST_TTL) return c.points;
  const p = await provider();
  const points = await p.history(symbol, period);
  histCache.set(key, { at: Date.now(), points });
  return points;
}

export async function searchAssets(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  return (await provider()).search(q);
}

export async function getFundamentals(symbols) {
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const p = await provider();
  const out = [];
  for (let i = 0; i < list.length; i += 10) out.push(...(await p.fundamentals(list.slice(i, i + 10))));
  return out;
}

export async function getScreenerMetrics(symbols) {
  const p = await provider();
  return Promise.all(await p.screenerMetrics(symbols));
}

export const clearMarketCaches = () => {
  quoteCache.clear();
  histCache.clear();
};

/** Map data from an Indian-market search hit/quote to our supported currencies. */
export const SUPPORTED_QUOTE_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];
