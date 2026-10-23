// @vitest-environment node
// Runs the REAL supabase/functions/*/index.ts through a Supabase-like gateway (supabase/tests/harness) and asserts
// exactly what a browser would evaluate: status + CORS headers on preflight, success, error and crash paths.
// Yahoo / AMFI are replaced by synthetic fixtures (supabase/tests/harness/provider-fixtures.mjs); this verifies OUR code's
// CORS/parsing/error handling, not the live availability of those providers.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startGateway } from '../../supabase/tests/harness/gateway.mjs';

let gw;
let token;
const FN = (n) => `${gw.url}/functions/v1/${n}`;
const preflight = (origin, fn = 'market-data', headers = 'authorization,content-type,apikey,x-client-info') =>
  fetch(FN(fn), { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': headers } });
const post = (body, { origin = 'http://localhost:5174', auth = token, fn = 'market-data', raw = false } = {}) =>
  fetch(FN(fn), { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: raw ? body : JSON.stringify(body) });
const acao = (r) => r.headers.get('access-control-allow-origin');

beforeAll(async () => {
  gw = await startGateway({ env: {} });
  token = gw.token();
}, 60_000);
afterAll(() => gw?.close());
beforeEach(() => {
  gw.provider.mode = 'fixtures';
  delete gw.env.ALLOWED_ORIGINS;
  delete gw.env.ALLOW_LOCALHOST_ORIGINS;
});

describe('CORS configuration (the reported failure)', () => {
  it('reproduces the original failure: no allow-list secret and no localhost allowance => no Allow-Origin header', async () => {
    gw.env.ALLOW_LOCALHOST_ORIGINS = 'false';
    const r = await preflight('http://localhost:5174');
    expect(r.status).toBe(204);
    expect(acao(r)).toBeNull(); // browser: "No 'Access-Control-Allow-Origin' header is present on the requested resource"
  });
  it('a secret listing only :5173 still blocks :5174 (Vite moved port) when localhost is not auto-allowed', async () => {
    gw.env.ALLOWED_ORIGINS = 'http://localhost:5173';
    gw.env.ALLOW_LOCALHOST_ORIGINS = 'false';
    expect(acao(await preflight('http://localhost:5173'))).toBe('http://localhost:5173');
    expect(acao(await preflight('http://localhost:5174'))).toBeNull();
  });
  it('FIXED: with NO secret configured, local dev ports 5173/5174/5175 and 127.0.0.1 all work', async () => {
    for (const o of ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://127.0.0.1:5174']) {
      const r = await preflight(o);
      expect([r.status, acao(r)]).toEqual([204, o]);
    }
  });
  it('production origin from ALLOWED_ORIGINS works (even with a trailing slash); unknown origins do not', async () => {
    gw.env.ALLOWED_ORIGINS = 'https://app.wealthfolio.example/, https://www.wealthfolio.example';
    gw.env.ALLOW_LOCALHOST_ORIGINS = 'false';
    expect(acao(await preflight('https://app.wealthfolio.example'))).toBe('https://app.wealthfolio.example');
    expect(acao(await preflight('https://www.wealthfolio.example'))).toBe('https://www.wealthfolio.example');
    expect(acao(await preflight('https://evil.example'))).toBeNull();
    expect(acao(await preflight('http://localhost:5174'))).toBeNull();
    expect(acao(await preflight('http://localhost.evil.com:5174'))).toBeNull();
  });
  it('preflight is answered BEFORE authentication and accepts the headers the browser announces', async () => {
    const r = await preflight('http://localhost:5174', 'market-data', 'authorization,content-type,apikey,x-client-info,x-supabase-api-version');
    expect(r.status).toBe(204); // note: no Authorization header was sent on this request
    const allowed = r.headers.get('access-control-allow-headers');
    for (const h of ['authorization', 'content-type', 'apikey', 'x-client-info', 'x-supabase-api-version']) expect(allowed).toContain(h);
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
  });
  it('every deployed function answers preflight identically', async () => {
    for (const fn of ['market-data', 'screener-metrics', 'explain-stock', 'delete-account', 'ml-predictions']) expect(acao(await preflight('http://localhost:5174', fn))).toBe('http://localhost:5174');
  });
});

describe('market-data: acceptance (Reliance / TCS / AAPL)', () => {
  it('search "Reliance" succeeds with CORS headers and real-shaped results', async () => {
    const r = await post({ action: 'search', query: 'Reliance' });
    expect([r.status, acao(r)]).toEqual([200, 'http://localhost:5174']);
    const j = await r.json();
    const syms = j.results.map((x) => x.symbol);
    expect(syms).toEqual(expect.arrayContaining(['RELIANCE.NS', 'RELIANCE.BO']));
    expect(j.results.find((x) => x.symbol === 'RELIANCE.NS')).toMatchObject({ name: 'Reliance Industries Limited', assetType: 'Stock', exchange: 'NSE', provider: 'yahoo' });
    expect(j.results.some((x) => x.symbol.startsWith('AMFI:') && x.assetType === 'Mutual Fund')).toBe(true);
    expect(j.warnings).toEqual([]);
  });
  it.each([['tcs', 'TCS.NS'], ['AAPL', 'AAPL']])('search %s finds %s', async (q, sym) => {
    const j = await (await post({ action: 'search', query: q })).json();
    expect(j.results.map((x) => x.symbol)).toContain(sym);
  });
  it('quotes for RELIANCE.NS, TCS.NS, AAPL carry the right currency; an unknown symbol is a clean per-item error', async () => {
    const r = await post({ action: 'quotes', symbols: ['RELIANCE.NS', 'TCS.NS', 'AAPL', 'NOSUCH.NS'] });
    expect(r.status).toBe(200);
    const q = Object.fromEntries((await r.json()).quotes.map((x) => [x.symbol, x]));
    expect(q['RELIANCE.NS']).toMatchObject({ ok: true, currency: 'INR', currencySupported: true, source: 'yahoo' });
    expect(q['TCS.NS'].currency).toBe('INR');
    expect(q.AAPL).toMatchObject({ ok: true, currency: 'USD' });
    expect(q['NOSUCH.NS']).toMatchObject({ ok: false, error: 'Symbol not found' });
  });
  it('history works and unsupported input is rejected cleanly (with CORS)', async () => {
    const ok = await (await post({ action: 'history', symbol: 'RELIANCE.NS', period: '1m' })).json();
    expect(ok.points.length).toBeGreaterThan(1);
    const bad = await post({ action: 'history', symbol: 'bad symbol!', period: '1m' });
    expect([bad.status, acao(bad)]).toEqual([400, 'http://localhost:5174']);
  });
});

describe('error responses always carry CORS headers and a safe message', () => {
  it.each([
    ['invalid JSON body', () => post('{not json', { raw: true }), 400, 'Invalid JSON body'],
    ['unknown action', () => post({ action: 'nope' }), 400, 'Unknown action'],
    ['query too short', () => post({ action: 'search', query: 'a' }), 400, 'Query too short'],
  ])('%s', async (_n, call, status, msg) => {
    const r = await call();
    expect([r.status, acao(r)]).toEqual([status, 'http://localhost:5174']);
    expect((await r.json()).error).toBe(msg);
  });
  it('a token the platform accepts but Auth rejects => 401 JSON with CORS (not an opaque failure)', async () => {
    const r = await post({ action: 'search', query: 'Reliance' }, { auth: gw.token({ sub: 'x', email: 'x@y.z' }, -10) });
    expect(r.status).toBe(401); // platform-level JWT check
  });
  it('Yahoo down, AMFI up => 200 with funds AND an explicit warning (never a silent partial list)', async () => {
    gw.provider.mode = 'yahoo-down';
    const r = await post({ action: 'search', query: 'Reliance' });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j.results.every((x) => x.symbol.startsWith('AMFI:'))).toBe(true);
    expect(j.warnings.join(' ')).toMatch(/stock, etf and crypto search is temporarily unavailable/i);
  });
  it('Yahoo down and nothing else matches => 502 (an outage), never a misleading empty "no matches"', async () => {
    gw.provider.mode = 'yahoo-down';
    const r = await post({ action: 'search', query: 'tcs' });   // no AMFI fund matches "tcs"
    expect([r.status, acao(r)]).toEqual([502, 'http://localhost:5174']);
    expect((await r.json()).error).toBe('Market data is temporarily unavailable.');
  });
  it('every provider down (cold start) => 502 with CORS and the safe message the UI shows', async () => {
    // A fresh gateway = fresh function instance: AMFI's 3-hour in-memory cache is empty, as on a cold start.
    const cold = await startGateway({ env: {}, provider: { mode: 'all-down' }, deployed: ['market-data'] });
    try {
      const call = (body) => fetch(`${cold.url}/functions/v1/market-data`, { method: 'POST', headers: { Origin: 'http://localhost:5174', 'Content-Type': 'application/json', Authorization: `Bearer ${cold.token()}` }, body: JSON.stringify(body) });
      const r = await call({ action: 'search', query: 'Reliance' });
      expect([r.status, acao(r)]).toEqual([502, 'http://localhost:5174']);
      expect((await r.json()).error).toBe('Market data is temporarily unavailable.');
      const q = await (await call({ action: 'quotes', symbols: ['RELIANCE.NS'] })).json();
      expect(q.quotes[0]).toMatchObject({ ok: false });      // per-item failure; the request itself is still a clean 200
      expect(q.quotes[0].error).not.toMatch(/http|stack|\bat /i);
    } finally {
      await cold.close();
    }
  });
  it('an unexpected crash (misconfigured function env) is a JSON 500 WITH CORS, not an opaque CORS-looking failure', async () => {
    const saved = gw.env.SUPABASE_URL;
    delete gw.env.SUPABASE_URL;
    try {
      const r = await post({ action: 'search', query: 'Reliance' });
      expect([r.status, acao(r)]).toEqual([500, 'http://localhost:5174']);
      expect((await r.json()).error).toMatch(/internal error/i);
    } finally {
      gw.env.SUPABASE_URL = saved;
    }
  });
  it('a disallowed browser origin gets 403 JSON and no Allow-Origin; a non-browser client (no Origin) is unaffected', async () => {
    gw.env.ALLOWED_ORIGINS = 'https://app.wealthfolio.example';
    gw.env.ALLOW_LOCALHOST_ORIGINS = 'false';
    const blocked = await post({ action: 'search', query: 'Reliance' }, { origin: 'https://evil.example' });
    expect([blocked.status, acao(blocked)]).toEqual([403, null]);
    const noOrigin = await fetch(FN('market-data'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search', query: 'tcs' }) });
    expect(noOrigin.status).toBe(200);
  });
});

describe('what the platform does BEFORE our code (why the browser shows a CORS error)', () => {
  it('a missing/invalid JWT is answered by the platform with 401 and NO CORS headers', async () => {
    const r = await post({ action: 'search', query: 'Reliance' }, { auth: null });
    expect(r.status).toBe(401);
    expect(acao(r)).toBeNull();
  });
  it('an undeployed function is a 404 with NO CORS headers (browser reports it as a CORS failure)', async () => {
    const r = await fetch(`${gw.url}/functions/v1/not-deployed`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5174' } });
    expect(r.status).toBe(404);
    expect(acao(r)).toBeNull();
  });
});
