// Live FX rates from Frankfurter (European Central Bank reference rates, free, no key).
// Rates are cached locally; if the network fails we fall back to the last cached rates (flagged stale).
// There are NO built-in fallback rates: if nothing is available the UI says so instead of guessing.
const URL_ = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR,EUR,GBP';
const KEY = 'wf.fx.v1';
const TTL_MS = 6 * 60 * 60 * 1000;

function readCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c?.fx?.rates || !c.fetchedAt) return null;
    return c;
  } catch {
    return null;
  }
}

export async function getRates({ force = false } = {}) {
  const cached = readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < TTL_MS) return { fx: cached.fx, stale: false, error: null };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(URL_, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`FX provider responded ${res.status}`);
    const j = await res.json();
    const rates = { USD: 1, ...j.rates };
    if (!rates.INR || !rates.EUR || !rates.GBP) throw new Error('Incomplete FX response');
    const fx = { base: 'USD', rates, asOf: j.date };
    try {
      localStorage.setItem(KEY, JSON.stringify({ fx, fetchedAt: Date.now() }));
    } catch {
      /* storage may be unavailable */
    }
    return { fx, stale: false, error: null };
  } catch (e) {
    if (cached) return { fx: cached.fx, stale: true, error: null };
    return { fx: null, stale: false, error: e?.message ?? 'Exchange rates unavailable' };
  }
}
