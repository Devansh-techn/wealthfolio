// Run: deno test --allow-env supabase/functions/_shared/shared_test.ts
// Dependency-free assertions so the tests run offline.
function assertEquals(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e} but got ${a}`);
}
function assert(cond: unknown, msg = 'Assertion failed') {
  if (!cond) throw new Error(msg);
}
import { parseAmfi } from './amfi.ts';
import { rateLimited } from './ratelimit.ts';
import { corsHeaders, originBlocked, preflight, safeHandler, json } from './cors.ts';
import * as yahoo from './yahoo.ts';

Deno.test('parseAmfi parses NAV rows and skips headers/garbage', () => {
  const sample = [
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
    '',
    'Open Ended Schemes(Equity Scheme - Large Cap Fund)',
    '',
    'Example Mutual Fund',
    '',
    '100001;INF000A01011;-;Example Bluechip Fund - Direct Plan - Growth;123.4567;03-Oct-2026',
    '100002;-;-;Bad Fund;N.A.;03-Oct-2026',
    '100003;-;-;Bad Date Fund;10.0;2026-10-03',
  ].join('\n');
  const out = parseAmfi(sample);
  assertEquals(out.length, 1);
  assertEquals(out[0], { code: '100001', name: 'Example Bluechip Fund - Direct Plan - Growth', nav: 123.4567, date: '2026-10-03' });
});

Deno.test('rateLimited blocks after max within window', () => {
  const k = `t:${Math.random()}`;
  assertEquals(rateLimited(k, 3, 1000), false);
  assertEquals(rateLimited(k, 3, 1000), false);
  assertEquals(rateLimited(k, 3, 1000), false);
  assertEquals(rateLimited(k, 3, 1000), true);
});

Deno.test('CORS only echoes allow-listed origins and blocks others', () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://app.example.com, http://localhost:5173');
  const ok = new Request('https://x/fn', { method: 'POST', headers: { Origin: 'https://app.example.com' } });
  const bad = new Request('https://x/fn', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  const none = new Request('https://x/fn', { method: 'POST' });
  assertEquals(corsHeaders(ok)['Access-Control-Allow-Origin'], 'https://app.example.com');
  assertEquals(corsHeaders(bad)['Access-Control-Allow-Origin'], undefined);
  assertEquals(originBlocked(ok), false);
  assertEquals(originBlocked(bad), true);
  assertEquals(originBlocked(none), false);
});

Deno.test('yahoo.chart parses payload and converts GBp pence to GBP', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: { symbol: 'VOD.L', currency: 'GBp', longName: 'Vodafone', fullExchangeName: 'LSE', regularMarketPrice: 70.5, chartPreviousClose: 69, regularMarketTime: 1760000000, fiftyTwoWeekHigh: 90, fiftyTwoWeekLow: 60, regularMarketVolume: 1000 },
                timestamp: [1759900000, 1759986400, 1760000000],
                indicators: { quote: [{ close: [68, null, 70.5], volume: [10, 20, 30] }] },
              },
            ],
          },
        }),
        { status: 200 },
      ),
    )) as typeof fetch;
  try {
    const c = await yahoo.chart('VOD.L', '1mo', '1d');
    assertEquals(c.currency, 'GBP');
    assertEquals(c.price, 0.705);
    assertEquals(c.previousClose, 0.69);
    assertEquals(c.points.length, 2); // null close skipped
    assertEquals(c.points[0].close, 0.68);
    assert(yahoo.isSupportedCurrency(c.currency));
    assertEquals(yahoo.isSupportedCurrency('JPY'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test('yahoo.chart surfaces provider errors', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 404 }))) as typeof fetch;
  try {
    let msg = '';
    try {
      await yahoo.chart('NOPE', '1d', '1d');
    } catch (e) {
      msg = (e as Error).message;
    }
    assertEquals(msg, 'Symbol not found');
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test('CORS: any localhost port, trailing slashes, and the production opt-out', () => {
  Deno.env.set('ALLOWED_ORIGINS', 'https://app.example.com/');            // trailing slash must not break matching
  for (const origin of ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5175', 'https://app.example.com']) {
    assertEquals(corsHeaders(new Request('https://x/fn', { method: 'POST', headers: { Origin: origin } }))['Access-Control-Allow-Origin'], origin);
  }
  for (const origin of ['https://localhost:5173', 'http://localhost.evil.com:5173', 'http://evil.com', 'null']) {
    assertEquals(corsHeaders(new Request('https://x/fn', { method: 'POST', headers: { Origin: origin } }))['Access-Control-Allow-Origin'], undefined);
  }
  Deno.env.set('ALLOW_LOCALHOST_ORIGINS', 'false');
  assertEquals(corsHeaders(new Request('https://x/fn', { method: 'POST', headers: { Origin: 'http://localhost:5173' } }))['Access-Control-Allow-Origin'], undefined);
  Deno.env.delete('ALLOW_LOCALHOST_ORIGINS');
});

Deno.test('CORS: OPTIONS preflight is answered without auth and echoes requested headers', () => {
  Deno.env.set('ALLOWED_ORIGINS', '');
  const res = preflight(new Request('https://x/fn', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5174', 'Access-Control-Request-Headers': 'authorization, content-type, x-supabase-api-version' } }))!;
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5174');
  assert(res.headers.get('Access-Control-Allow-Headers')!.includes('x-supabase-api-version'));
});

Deno.test('safeHandler turns a crash into a JSON 500 that still carries CORS headers', async () => {
  const h = safeHandler(() => {
    throw new Error('boom');
  });
  const res = await h(new Request('https://x/fn', { method: 'POST', headers: { Origin: 'http://localhost:5173' } }));
  assertEquals(res.status, 500);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assertEquals((await res.json()).error, 'Internal error. Please try again.');
  assert(json(new Request('https://x/fn'), {}, 200).status === 200);
});
