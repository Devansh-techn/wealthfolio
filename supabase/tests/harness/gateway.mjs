// Local, Supabase-like gateway for testing the REAL Edge Function source offline.
//
//   /functions/v1/<name>  -> the actual supabase/functions/<name>/index.ts, bundled and run under Node with a thin Deno shim.
//                            Like the hosted platform: OPTIONS reaches the function; every other request needs a valid
//                            HS256 JWT or gets a 401 WITHOUT CORS headers (which browsers then report as a CORS error);
//                            an undeployed function gets a 404 WITHOUT CORS headers.
//   /auth/v1/user         -> returns the user encoded in a validly signed JWT.
//   /rest/v1/*            -> optional proxy to a PostgREST instance (set postgrestUrl).
//
// Market-data providers (Yahoo/AMFI) are replaced by ./provider-fixtures.mjs. Test-only; not part of the app.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { makeProviderFetch } from './provider-fixtures.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FUNCTION_NAMES = ['market-data', 'screener-metrics', 'explain-stock', 'delete-account', 'ml-predictions'];

const b64u = (b) => Buffer.from(b).toString('base64url');
export function signJwt(claims, secret) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
export function verifyJwt(token, secret) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return null;
  const good = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (good.length !== s.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
}

let seq = 0;
// Each bundled function gets PRIVATE `Deno` and `fetch` bindings (module-scope consts), so several gateways in one
// process never share env or provider behaviour.
async function bundleFunction(name, dir, deno, providerFetch) {
  const id = `${process.pid}_${seq++}`;
  globalThis[`__wf_deno_${id}`] = deno;
  globalThis[`__wf_fetch_${id}`] = providerFetch;
  const entry = path.join(ROOT, 'supabase/functions', name, 'index.ts');
  const bundle = await rolldown({
    input: entry,
    platform: 'node',
    logLevel: 'silent',
    // Deno's `npm:` specifier -> the bare package, resolved from the project's node_modules at runtime (not bundled).
    plugins: [{ name: 'npm-specifier', resolveId: (id) => (id === 'npm:@supabase/supabase-js@2' ? { id: '@supabase/supabase-js', external: true } : null) }],
  });
  const { output } = await bundle.generate({ format: 'esm', banner: `const Deno = globalThis.__wf_deno_${id};\nconst fetch = globalThis.__wf_fetch_${id};` });
  const file = path.join(dir, `${name}.mjs`);
  fs.writeFileSync(file, output[0].code);
  await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  if (!deno.handler) throw new Error(`${name} did not register a Deno.serve handler`);
  return deno.handler;
}

export async function startGateway({ port = 0, jwtSecret = 'test-jwt-secret-test-jwt-secret-1234', env = {}, deployed = FUNCTION_NAMES, postgrestUrl = null, provider = { mode: 'fixtures' } } = {}) {
  const cache = path.join(ROOT, 'node_modules', '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cache, 'wf-edge-'));
  const fnEnv = { ...env };
  const realFetch = globalThis.fetch;
  const providerFetch = makeProviderFetch(realFetch, () => provider.mode);

  const log = [];
  const makeDeno = () => { const d = { env: { get: (k) => fnEnv[k], set: (k, v) => { fnEnv[k] = v; }, delete: (k) => { delete fnEnv[k]; } }, handler: null, serve(h) { d.handler = h; } }; return d; };
  const handlers = {};
  for (const n of deployed) handlers[n] = await bundleFunction(n, dir, makeDeno(), providerFetch);

  const server = http.createServer(async (nreq, nres) => {
    const url = new URL(nreq.url, 'http://gateway');
    const chunks = [];
    for await (const c of nreq) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (status, headers, data) => { nres.writeHead(status, headers); nres.end(data); };
    const restCors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': '*' };
    log.push(`${nreq.method} ${url.pathname}`);

    try {
      // Test-only control channel (flip provider behaviour / function env while a browser test is running).
      if (url.pathname === '/__control' && nreq.method === 'POST') {
        const c = JSON.parse(body.toString() || '{}');
        if (c.provider) provider.mode = c.provider;
        for (const [k, v] of Object.entries(c.env ?? {})) { if (v === null) delete fnEnv[k]; else fnEnv[k] = v; }
        return send(200, { 'content-type': 'application/json' }, JSON.stringify({ provider: provider.mode }));
      }
      const fm = url.pathname.match(/^\/functions\/v1\/([\w-]+)$/);
      if (fm) {
        const name = fm[1];
        if (!handlers[name]) return send(404, { 'content-type': 'application/json' }, JSON.stringify({ code: 'NOT_FOUND', message: 'Requested function was not found' }));
        if (nreq.method !== 'OPTIONS') {
          const tok = (nreq.headers.authorization ?? '').replace(/^Bearer /i, '');
          if (!verifyJwt(tok, jwtSecret)) return send(401, { 'content-type': 'application/json' }, JSON.stringify({ code: 401, message: 'Invalid JWT' }));
        }
        const headers = new Headers();
        for (const [k, v] of Object.entries(nreq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(',') : v);
        const req = new Request(`http://gateway${url.pathname}${url.search}`, { method: nreq.method, headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(nreq.method) ? undefined : body });
        const res = await handlers[name](req);
        const out = {};
        res.headers.forEach((v, k) => { out[k] = v; });
        return send(res.status, out, Buffer.from(await res.arrayBuffer()));
      }
      if (url.pathname === '/auth/v1/user') {
        if (nreq.method === 'OPTIONS') return send(204, restCors, '');
        const claims = verifyJwt((nreq.headers.authorization ?? '').replace(/^Bearer /i, ''), jwtSecret);
        if (!claims) return send(401, { ...restCors, 'content-type': 'application/json' }, JSON.stringify({ code: 401, msg: 'invalid JWT' }));
        return send(200, { ...restCors, 'content-type': 'application/json' }, JSON.stringify({ id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email, app_metadata: {}, user_metadata: claims.user_metadata ?? {}, created_at: '2026-01-01T00:00:00Z' }));
      }
      if (url.pathname.startsWith('/rest/v1/') && postgrestUrl) {
        if (nreq.method === 'OPTIONS') return send(204, restCors, '');
        const headers = { ...nreq.headers };
        delete headers.host; delete headers.origin; delete headers['content-length'];
        const r = await realFetch(`${postgrestUrl}${url.pathname.replace('/rest/v1', '')}${url.search}`, { method: nreq.method, headers, body: ['GET', 'HEAD'].includes(nreq.method) ? undefined : body });
        const out = { ...restCors };
        r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(k)) out[k] = v; });
        return send(r.status, out, Buffer.from(await r.arrayBuffer()));
      }
      if (nreq.method === 'OPTIONS') return send(204, restCors, '');
      return send(404, { ...restCors, 'content-type': 'application/json' }, JSON.stringify({ message: `no route ${url.pathname}` }));
    } catch (e) {
      return send(500, { 'content-type': 'application/json' }, JSON.stringify({ message: String(e).slice(0, 200) }));
    }
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  fnEnv.SUPABASE_URL ??= base;
  fnEnv.SUPABASE_ANON_KEY ??= signJwt({ role: 'anon', iss: 'supabase' }, jwtSecret);
  return {
    url: base, port: address.port, jwtSecret, env: fnEnv, provider, log,
    token: (user = { sub: '11111111-1111-1111-1111-111111111111', email: 'dev@wealthfolio.test' }, ttl = 86400) => signJwt({ role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + ttl, ...user }, jwtSecret),
    close: () => new Promise((r) => { server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); r(); }); }),
  };
}
