// POST { action: 'quotes' | 'history' | 'search' | 'fundamentals', ... }
// Requires a valid Supabase user JWT. Provider keys/secrets (if any) stay server-side.
import { preflight, json, safeHandler } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { rateLimited } from '../_shared/ratelimit.ts';
import * as yahoo from '../_shared/yahoo.ts';
import { amfiQuote, amfiSearch } from '../_shared/amfi.ts';

const SYMBOL_RE = /^(AMFI:\d{4,8}|[A-Za-z0-9.\-^=&_]{1,32})$/;
const PERIODS: Record<string, { range: string; interval: string }> = {
  '1m': { range: '1mo', interval: '1d' },
  '3m': { range: '3mo', interval: '1d' },
  '6m': { range: '6mo', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
  '3y': { range: '3y', interval: '1d' },
  '5y': { range: '5y', interval: '1wk' },
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const safeError = (e: unknown) => {
  const m = e instanceof Error ? e.message : 'Provider error';
  return /abort/i.test(m) ? 'Provider timed out' : m.slice(0, 120);
};

async function quoteOne(symbol: string) {
  try {
    if (symbol.startsWith('AMFI:')) {
      const s = await amfiQuote(symbol.slice(5));
      if (!s) return { symbol, ok: false, error: 'Scheme not found' };
      return { symbol, ok: true, name: s.name, price: s.nav, previousClose: null, currency: 'INR', exchange: 'AMFI', asOf: `${s.date}T00:00:00Z`, high52: null, low52: null, volume: null, source: 'amfi' };
    }
    const c = await yahoo.chart(symbol, '1d', '1d');
    if (c.price === null) return { symbol, ok: false, error: 'No price available' };
    return {
      symbol,
      ok: true,
      name: c.name,
      price: c.price,
      previousClose: c.previousClose,
      currency: c.currency,
      currencySupported: yahoo.isSupportedCurrency(c.currency),
      exchange: c.exchange,
      asOf: c.asOf,
      high52: c.high52,
      low52: c.low52,
      volume: c.volume,
      source: 'yahoo',
    };
  } catch (e) {
    return { symbol, ok: false, error: safeError(e) };
  }
}

Deno.serve(safeHandler(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  if (rateLimited(`md:${auth.user.id}`, 90, 60_000)) return json(req, { error: 'Too many requests. Please slow down.' }, 429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400);
  }
  const action = body?.action;

  try {
    if (action === 'quotes') {
      const symbols: string[] = Array.isArray(body.symbols) ? [...new Set<string>(body.symbols.map(String))] : [];
      if (!symbols.length || symbols.length > 30) return json(req, { error: 'Provide 1-30 symbols' }, 400);
      if (!symbols.every((s) => SYMBOL_RE.test(s))) return json(req, { error: 'Invalid symbol' }, 400);
      const quotes = await mapLimit(symbols, 6, quoteOne);
      return json(req, { provider: 'Yahoo Finance (unofficial, delayed) / AMFI', delayed: true, asOf: new Date().toISOString(), quotes });
    }

    if (action === 'history') {
      const symbol = String(body.symbol ?? '');
      const period = PERIODS[String(body.period ?? '1y')];
      if (!SYMBOL_RE.test(symbol) || !period) return json(req, { error: 'Invalid symbol or period' }, 400);
      if (symbol.startsWith('AMFI:')) return json(req, { symbol, points: [], unavailable: true, reason: 'History is not available for AMFI schemes' });
      const c = await yahoo.chart(symbol, period.range, period.interval);
      return json(req, { symbol, currency: c.currency, points: c.points.map((p) => ({ date: p.date, close: p.close })) });
    }

    if (action === 'search') {
      const query = String(body.query ?? '').trim().slice(0, 60);
      if (query.length < 2) return json(req, { error: 'Query too short' }, 400);
      const [y, a] = await Promise.allSettled([yahoo.search(query), amfiSearch(query)]);
      const results: unknown[] = [];
      if (a.status === 'fulfilled') {
        for (const s of a.value) results.push({ symbol: `AMFI:${s.code}`, name: s.name, exchange: 'AMFI (India)', assetType: 'Mutual Fund', currency: 'INR', provider: 'amfi' });
      }
      if (y.status === 'fulfilled') results.push(...y.value);
      // Be explicit when one provider is down so the UI never silently shows an incomplete list.
      const warnings: string[] = [];
      if (y.status === 'rejected') {
        console.error('yahoo search failed:', safeError(y.reason));
        warnings.push('Stock, ETF and crypto search is temporarily unavailable.');
      }
      if (a.status === 'rejected') {
        console.error('amfi search failed:', safeError(a.reason));
        warnings.push('Mutual fund search is temporarily unavailable.');
      }
      // Yahoo is the only source of stocks/ETFs/crypto. If it is down and nothing else matched, an empty list would be
      // misleading ("no matches"), so report the outage instead.
      if (!results.length && y.status === 'rejected') return json(req, { error: 'Market data is temporarily unavailable.' }, 502);
      return json(req, { results, warnings });
    }

    if (action === 'fundamentals') {
      const symbols: string[] = Array.isArray(body.symbols) ? [...new Set<string>(body.symbols.map(String))] : [];
      if (!symbols.length || symbols.length > 10) return json(req, { error: 'Provide 1-10 symbols' }, 400);
      if (!symbols.every((s) => SYMBOL_RE.test(s) && !s.startsWith('AMFI:'))) return json(req, { error: 'Invalid symbol' }, 400);
      const items = await mapLimit(symbols, 3, async (symbol) => {
        try {
          return { symbol, ok: true, data: await yahoo.fundamentals(symbol) };
        } catch (e) {
          return { symbol, ok: false, error: safeError(e) };
        }
      });
      return json(req, { items });
    }

    return json(req, { error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('market-data error', e);
    return json(req, { error: 'Market data is temporarily unavailable.' }, 502);
  }
}));
