// Yahoo Finance adapter (UNOFFICIAL, no API key). Data is typically delayed ~15 min for NSE/BSE
// and may be rate-limited or changed by Yahoo without notice. Swap this module to change provider.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SUPPORTED = new Set(['INR', 'USD', 'EUR', 'GBP']);

async function yfetch(url: string, headers: Record<string, string> = {}, timeoutMs = 9000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface ChartResult {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  instrumentType: string | null;
  price: number | null;
  previousClose: number | null;
  asOf: string | null;
  high52: number | null;
  low52: number | null;
  volume: number | null;
  points: { date: string; close: number; volume: number | null }[];
}

/** Normalise pence-quoted LSE prices (GBp) to pounds. */
function normaliseCurrency(cur: string | null): { cur: string | null; factor: number } {
  if (cur === 'GBp' || cur === 'GBX') return { cur: 'GBP', factor: 0.01 };
  return { cur: cur ? cur.toUpperCase() : null, factor: 1 };
}

export async function chart(symbol: string, range: string, interval: string): Promise<ChartResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await yfetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? 'Symbol not found' : `Provider error (${res.status})`);
  const body = await res.json();
  const r = body?.chart?.result?.[0];
  if (!r) throw new Error(body?.chart?.error?.description ?? 'Symbol not found');
  const m = r.meta ?? {};
  const { cur, factor } = normaliseCurrency(m.currency ?? null);
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const closes: (number | null)[] = q.close ?? [];
  const vols: (number | null)[] = q.volume ?? [];
  const points: ChartResult['points'] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = closes[i];
    if (c === null || c === undefined || !Number.isFinite(c)) continue;
    points.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      close: Number((c * factor).toFixed(6)),
      volume: vols[i] ?? null,
    });
  }
  const scaleN = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Number((n * factor).toFixed(6)) : null);
  return {
    symbol: m.symbol ?? symbol,
    name: m.longName ?? m.shortName ?? null,
    currency: cur,
    exchange: m.fullExchangeName ?? m.exchangeName ?? null,
    instrumentType: m.instrumentType ?? null,
    price: scaleN(m.regularMarketPrice),
    previousClose: scaleN(m.chartPreviousClose ?? m.previousClose),
    asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    high52: scaleN(m.fiftyTwoWeekHigh),
    low52: scaleN(m.fiftyTwoWeekLow),
    volume: typeof m.regularMarketVolume === 'number' ? m.regularMarketVolume : null,
    points,
  };
}

export const isSupportedCurrency = (c: string | null) => Boolean(c && SUPPORTED.has(c));

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string | null;
  assetType: string;
  provider: 'yahoo';
}

const TYPE_MAP: Record<string, string> = {
  EQUITY: 'Stock',
  ETF: 'ETF',
  MUTUALFUND: 'Mutual Fund',
  CRYPTOCURRENCY: 'Crypto',
};

export async function search(query: string): Promise<SearchHit[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0&listsCount=0`;
  const res = await yfetch(url);
  if (!res.ok) throw new Error(`Provider error (${res.status})`);
  const body = await res.json();
  const out: SearchHit[] = [];
  for (const q of body?.quotes ?? []) {
    const type = TYPE_MAP[String(q.quoteType ?? '').toUpperCase()];
    if (!type || !q.symbol) continue;
    out.push({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      exchange: q.exchDisp ?? q.exchange ?? null,
      assetType: type,
      provider: 'yahoo',
    });
  }
  return out;
}

// --- Fundamentals (requires cookie + crumb; fragile by nature) --------------------------------
let crumbCache: { crumb: string; cookie: string; at: number } | null = null;

async function getCrumb(force = false) {
  if (!force && crumbCache && Date.now() - crumbCache.at < 30 * 60 * 1000) return crumbCache;
  const r1 = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' });
  const raw = r1.headers.get('set-cookie') ?? '';
  const cookie = raw.split(';')[0];
  if (!cookie) throw new Error('Could not obtain provider session');
  const r2 = await yfetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { Cookie: cookie });
  const crumb = (await r2.text()).trim();
  if (!r2.ok || !crumb || crumb.includes('<')) throw new Error('Could not obtain provider crumb');
  crumbCache = { crumb, cookie, at: Date.now() };
  return crumbCache;
}

export interface Fundamentals {
  price: number | null;
  marketCap: number | null;
  pe: number | null;
  epsGrowth: number | null; // % (quarterly YoY, as reported by provider)
  revenueGrowth: number | null; // %
  roe: number | null; // %
  roce: null; // not provided by this provider; never estimated
  debtToEquity: number | null; // ratio
  dividendYield: number | null; // %
  sector: string | null;
}

const raw = (o: any): number | null => (o && typeof o.raw === 'number' && Number.isFinite(o.raw) ? o.raw : null);
const pct = (n: number | null) => (n === null ? null : Number((n * 100).toFixed(4)));

export async function fundamentals(symbol: string): Promise<Fundamentals> {
  const modules = 'summaryDetail,financialData,defaultKeyStatistics,assetProfile,price';
  let attempt = 0;
  for (;;) {
    const { crumb, cookie } = await getCrumb(attempt > 0);
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
    const res = await yfetch(url, { Cookie: cookie });
    if ((res.status === 401 || res.status === 403) && attempt === 0) {
      attempt += 1;
      continue;
    }
    if (!res.ok) throw new Error(`Fundamentals unavailable (${res.status})`);
    const body = await res.json();
    const r = body?.quoteSummary?.result?.[0];
    if (!r) throw new Error('Fundamentals unavailable');
    const sd = r.summaryDetail ?? {};
    const fd = r.financialData ?? {};
    const dev = raw(fd.debtToEquity);
    const { factor } = normaliseCurrency(r.price?.currency ?? null);
    const pe = raw(sd.trailingPE);
    const dy = raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield);
    const cap = raw(r.price?.marketCap) ?? raw(sd.marketCap);
    const price = raw(fd.currentPrice);
    return {
      price: price === null ? null : price * factor,
      marketCap: cap,
      pe,
      epsGrowth: pct(raw(fd.earningsGrowth)),
      revenueGrowth: pct(raw(fd.revenueGrowth)),
      roe: pct(raw(fd.returnOnEquity)),
      roce: null,
      debtToEquity: dev === null ? null : Number((dev / 100).toFixed(4)),
      dividendYield: pct(dy),
      sector: r.assetProfile?.sector ?? null,
    };
  }
}
