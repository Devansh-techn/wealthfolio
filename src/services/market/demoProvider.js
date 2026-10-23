// DEMO PROVIDER — synthetic, deterministic, NOT real market data.
// Only reachable in `vite dev` with VITE_MARKET_PROVIDER=demo. It is compiled out of production builds,
// its prices are never written to the database, and the UI shows a permanent DEMO banner while it is active.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const currencyFor = (sym) => (/\.(NS|BO)$/.test(sym) || sym.startsWith('^NSE') ? 'INR' : /\.L$/.test(sym) ? 'GBP' : 'USD');

function walk(symbol, days) {
  const r = rng(hash(symbol));
  let p = 50 + r() * 450;
  const out = [];
  const end = new Date();
  for (let i = days; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    p *= 1 + (r() - 0.48) * 0.03;
    out.push({ date: d.toISOString().slice(0, 10), close: Number(p.toFixed(2)), volume: Math.round(1e5 + r() * 1e6) });
  }
  return out;
}

const DAYS = { '1m': 31, '3m': 92, '6m': 183, '1y': 366, '3y': 1096, '5y': 1830 };

const demo = {
  id: 'demo',
  async quotes(symbols) {
    return symbols.map((symbol) => {
      const pts = walk(symbol, 10);
      const last = pts.at(-1);
      const prev = pts.at(-2) ?? last;
      return { symbol, ok: true, name: `${symbol} (demo)`, price: last.close, previousClose: prev.close, currency: currencyFor(symbol), exchange: 'DEMO', asOf: new Date().toISOString(), source: 'demo' };
    });
  },
  async history(symbol, period) {
    return walk(symbol, DAYS[period] ?? 366).map(({ date, close }) => ({ date, close }));
  },
  async search(query) {
    const q = query.trim().toUpperCase();
    return q ? [{ symbol: q, name: `${q} (demo)`, exchange: 'DEMO', assetType: 'Stock', provider: 'demo' }] : [];
  },
  async fundamentals(symbols) {
    return symbols.map((symbol) => {
      const r = rng(hash(`${symbol}f`));
      return { symbol, ok: true, data: { price: null, marketCap: Math.round((5 + r() * 500) * 1e9), pe: Number((8 + r() * 40).toFixed(1)), epsGrowth: Number((r() * 40 - 10).toFixed(1)), revenueGrowth: Number((r() * 30 - 5).toFixed(1)), roe: Number((r() * 30).toFixed(1)), roce: null, debtToEquity: Number((r() * 2).toFixed(2)), dividendYield: Number((r() * 4).toFixed(2)), sector: 'Demo' } };
    });
  },
  async screenerMetrics(symbols) {
    return symbols.map((symbol) => {
      const pts = walk(symbol, 366);
      const f = demo.fundamentals([symbol]);
      return f.then((x) => ({ symbol, ok: true, name: `${symbol} (demo)`, currency: currencyFor(symbol), exchange: 'DEMO', closes: pts.map((p) => p.close), volumes: pts.map((p) => p.volume), lastDate: pts.at(-1).date, fundamentals: x[0].data }));
    });
  },
};
export default demo;
