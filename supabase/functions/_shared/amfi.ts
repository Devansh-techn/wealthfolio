// AMFI India publishes the official daily NAV file for every Indian mutual-fund scheme.
// Symbols for these schemes are stored as "AMFI:<schemeCode>". Only the latest NAV is available here
// (no history, no previous close), so day-change is reported as unavailable.
const NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';

export interface AmfiScheme {
  code: string;
  name: string;
  nav: number;
  date: string; // ISO
}

let cache: { at: number; schemes: AmfiScheme[] } | null = null;

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

export function parseAmfi(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(';');
    if (parts.length < 6) continue;
    const code = parts[0].trim();
    if (!/^\d{4,8}$/.test(code)) continue;
    const nav = Number(parts[4]);
    if (!Number.isFinite(nav) || nav <= 0) continue;
    const m = parts[5].trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (!m || !MONTHS[m[2]]) continue;
    out.push({ code, name: parts[3].trim(), nav, date: `${m[3]}-${MONTHS[m[2]]}-${m[1]}` });
  }
  return out;
}

async function load(): Promise<AmfiScheme[]> {
  if (cache && Date.now() - cache.at < 3 * 60 * 60 * 1000) return cache.schemes;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(NAV_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`AMFI unavailable (${res.status})`);
    const schemes = parseAmfi(await res.text());
    if (!schemes.length) throw new Error('AMFI returned no data');
    cache = { at: Date.now(), schemes };
    return schemes;
  } finally {
    clearTimeout(t);
  }
}

export async function amfiQuote(code: string): Promise<AmfiScheme | null> {
  const all = await load();
  return all.find((s) => s.code === code) ?? null;
}

export async function amfiSearch(query: string, limit = 8): Promise<AmfiScheme[]> {
  const terms = query.toLowerCase().split(/\s+/).filter((x) => x.length > 1);
  if (!terms.length) return [];
  const all = await load();
  const hits: AmfiScheme[] = [];
  for (const s of all) {
    const n = s.name.toLowerCase();
    if (terms.every((t) => n.includes(t))) {
      hits.push(s);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
