// CORS for every Edge Function.
//
// Who may call the functions from a browser:
//   1. origins listed in the ALLOWED_ORIGINS secret (comma separated; trailing slashes are ignored), and
//   2. local development origins  http://localhost:<any port>  /  http://127.0.0.1:<any port>
//      (Vite silently moves to :5174, :5175 … when a port is busy, so a single hard-coded port keeps breaking).
//      Set the secret ALLOW_LOCALHOST_ORIGINS=false in production to turn (2) off.
// This is not the security boundary: every function also requires a valid Supabase user JWT (Bearer token,
// never cookies), so a foreign site cannot act as the user. CORS only decides which pages may READ responses.
//
// Why this file matters: if no Access-Control-Allow-Origin header is returned (secret unset, wrong origin,
// unhandled exception, function not deployed) the browser reports a misleading "blocked by CORS policy" error and
// hides the real status. `safeHandler` guarantees every response path, including crashes, carries CORS headers.

const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{2,5}$/;
const BASE_HEADERS = ['authorization', 'x-client-info', 'apikey', 'content-type'];

const norm = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();

export function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(norm).filter(Boolean);
}

function allowLocalhost(): boolean {
  const v = Deno.env.get('ALLOW_LOCALHOST_ORIGINS');
  return v === undefined || !/^(false|0|no|off)$/i.test(v.trim());
}

export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const o = norm(origin);
  if (allowedOrigins().includes(o)) return true;
  return allowLocalhost() && LOCALHOST_RE.test(o);
}

/** Headers the browser announces it will send; echoed back (sanitised) so new SDK headers never break preflight. */
function requestedHeaders(req: Request): string[] {
  const raw = req.headers.get('Access-Control-Request-Headers') ?? '';
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9-]{1,64}$/.test(h)).slice(0, 20);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const h: Record<string, string> = {
    Vary: 'Origin, Access-Control-Request-Headers',
    'Access-Control-Allow-Headers': [...new Set([...BASE_HEADERS, ...requestedHeaders(req)])].join(', '),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
  if (isOriginAllowed(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

/** Browsers always send Origin on cross-origin POSTs; reject any that are not allowed. (Non-browser clients send none.) */
export function originBlocked(req: Request): boolean {
  const origin = req.headers.get('Origin');
  return Boolean(origin) && !isOriginAllowed(origin);
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Common preamble: OPTIONS (answered BEFORE authentication), origin check, method check. Returns a Response to short-circuit, or null. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (originBlocked(req)) return json(req, { error: 'Origin not allowed' }, 403);
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  return null;
}

/** Wraps a handler so an unexpected exception becomes a JSON 500 WITH CORS headers instead of an opaque, header-less crash. */
export function safeHandler(fn: (req: Request) => Response | Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (e) {
      console.error('Unhandled Edge Function error', e);
      return json(req, { error: 'Internal error. Please try again.' }, 500);
    }
  };
}
