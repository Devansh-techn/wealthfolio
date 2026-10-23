// POST { symbols: string[] (<=12) } -> raw 1y closes/volumes + provider fundamentals per symbol.
// Scores and indicators are computed client-side from this raw data (src/lib/scoring.js) so the
// methodology is transparent and testable. Missing data is returned as null, never estimated.
import { preflight, json, safeHandler } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { rateLimited } from '../_shared/ratelimit.ts';
import * as yahoo from '../_shared/yahoo.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Best-effort, non-blocking: keep a dated, shared copy of the provider's fundamentals. The provider only exposes
// CURRENT fundamentals, so this is how point-in-time history for future ML versions accumulates without look-ahead.
// Needs SUPABASE_SERVICE_ROLE_KEY (auto-provided in Edge Functions); silently skipped otherwise. Never affects the response.
async function snapshotFundamentals(results: any[]): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  const today = new Date().toISOString().slice(0, 10);
  const rows = results.filter((r) => r?.ok && r.fundamentals && typeof r.fundamentals === 'object').map((r) => ({ symbol: r.symbol, snapshot_date: today, payload: r.fundamentals }));
  if (!rows.length) return;
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from('ml_fundamental_snapshots').upsert(rows, { onConflict: 'symbol,snapshot_date', ignoreDuplicates: true });
  if (error) console.error('fundamental snapshot failed', error.message);
}

const SYMBOL_RE = /^[A-Za-z0-9.\-^=&_]{1,32}$/;

Deno.serve(safeHandler(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  if (rateLimited(`sc:${auth.user.id}`, 30, 60_000)) return json(req, { error: 'Too many requests. Please slow down.' }, 429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400);
  }
  const symbols: string[] = Array.isArray(body?.symbols) ? [...new Set<string>(body.symbols.map(String))] : [];
  if (!symbols.length || symbols.length > 12) return json(req, { error: 'Provide 1-12 symbols' }, 400);
  if (!symbols.every((s) => SYMBOL_RE.test(s))) return json(req, { error: 'Invalid symbol' }, 400);

  const results: unknown[] = new Array(symbols.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < symbols.length) {
        const i = next++;
        const symbol = symbols[i];
        try {
          const [chartRes, fundRes] = await Promise.allSettled([yahoo.chart(symbol, '1y', '1d'), yahoo.fundamentals(symbol)]);
          if (chartRes.status === 'rejected') {
            results[i] = { symbol, ok: false, error: 'Price history unavailable' };
            continue;
          }
          const c = chartRes.value;
          results[i] = {
            symbol,
            ok: true,
            name: c.name,
            currency: c.currency,
            exchange: c.exchange,
            closes: c.points.map((p) => p.close),
            volumes: c.points.map((p) => p.volume ?? 0),
            lastDate: c.points.at(-1)?.date ?? null,
            fundamentals: fundRes.status === 'fulfilled' ? fundRes.value : null,
            fundamentalsError: fundRes.status === 'rejected' ? 'Fundamentals unavailable from provider' : null,
          };
        } catch {
          results[i] = { symbol, ok: false, error: 'Unavailable' };
        }
      }
    }),
  );
  const snap = snapshotFundamentals(results as any[]).catch((e) => console.error('fundamental snapshot error', e));
  (globalThis as any).EdgeRuntime?.waitUntil?.(snap);
  return json(req, { provider: 'Yahoo Finance (unofficial, delayed)', asOf: new Date().toISOString(), results });
}));
