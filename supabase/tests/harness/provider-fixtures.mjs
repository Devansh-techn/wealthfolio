// TEST FIXTURES ONLY. They live under supabase/tests and are never imported by the app or by any Edge Function.
//
// They imitate the *shape* of Yahoo Finance / AMFI responses so the REAL Edge Function code (parsing, CORS, error
// handling) can be exercised offline. All prices are deliberately round, obviously synthetic numbers.
// Nothing here says anything about real market prices.

const SYMBOLS = {
  'RELIANCE.NS': { name: 'Reliance Industries Limited', currency: 'INR', exchange: 'NSE', price: 1000, prev: 990 },
  'RELIANCE.BO': { name: 'Reliance Industries Limited', currency: 'INR', exchange: 'BSE', price: 1000, prev: 990 },
  'TCS.NS': { name: 'Tata Consultancy Services Limited', currency: 'INR', exchange: 'NSE', price: 2000, prev: 2010 },
  AAPL: { name: 'Apple Inc.', currency: 'USD', exchange: 'NasdaqGS', price: 100, prev: 99 },
  '^NSEI': { name: 'NIFTY 50', currency: 'INR', exchange: 'NSE', price: 10000, prev: 9950 },
  '^BSESN': { name: 'S&P BSE SENSEX', currency: 'INR', exchange: 'BSE', price: 30000, prev: 29900 },
  '^IXIC': { name: 'NASDAQ Composite', currency: 'USD', exchange: 'NasdaqGIDS', price: 15000, prev: 15100 },
  'BTC-USD': { name: 'Bitcoin USD', currency: 'USD', exchange: 'CCC', price: 50000, prev: 49000 },
};

const SEARCH = {
  reliance: [['RELIANCE.NS', 'NSI'], ['RELIANCE.BO', 'BSE']],
  tcs: [['TCS.NS', 'NSI']],
  aapl: [['AAPL', 'NMS']],
  apple: [['AAPL', 'NMS']],
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function chart(symbol) {
  const s = SYMBOLS[symbol.toUpperCase()] ?? SYMBOLS[symbol];
  if (!s) return json({ chart: { result: null, error: { code: 'Not Found', description: 'No data found, symbol may be delisted' } } }, 404);
  const day = 86400;
  const t0 = 1759900000;
  const points = Array.from({ length: 5 }, (_, i) => t0 + i * day);
  return json({
    chart: {
      result: [{
        meta: { symbol, currency: s.currency, longName: s.name, fullExchangeName: s.exchange, instrumentType: 'EQUITY', regularMarketPrice: s.price, chartPreviousClose: s.prev,
          regularMarketTime: points.at(-1), fiftyTwoWeekHigh: s.price * 1.2, fiftyTwoWeekLow: s.price * 0.8, regularMarketVolume: 1000000 },
        timestamp: points,
        indicators: { quote: [{ close: points.map((_, i) => s.prev + ((s.price - s.prev) * i) / 4), volume: points.map(() => 1000000) }] },
      }],
      error: null,
    },
  });
}

const NAV = `Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
Open Ended Schemes(Equity Scheme - Large Cap Fund)
100001;INF000000001;-;Example Reliance Test Fund - Direct Plan - Growth;100.1234;03-Oct-2026
100002;INF000000002;-;Example Bluechip Fund - Direct Plan - Growth;123.4567;03-Oct-2026
`;

/** mode: 'fixtures' | 'yahoo-down' (HTTP 429) | 'all-down' (network failure) */
export function makeProviderFetch(realFetch, getMode) {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const host = new URL(url).hostname;
    const isYahoo = /(^|\.)yahoo\.com$/.test(host);
    const isAmfi = /(^|\.)amfiindia\.com$/.test(host);
    if (!isYahoo && !isAmfi) return realFetch(input, init);
    const mode = getMode();
    if (mode === 'all-down') throw new TypeError('fetch failed (provider unreachable)');
    if (isYahoo) {
      if (mode === 'yahoo-down') return new Response('Too Many Requests', { status: 429 });
      const u = new URL(url);
      if (u.pathname.startsWith('/v1/finance/search')) {
        const q = (u.searchParams.get('q') ?? '').toLowerCase().trim();
        const hits = (SEARCH[q] ?? []).map(([sym, exch]) => ({ symbol: sym, shortname: SYMBOLS[sym].name.toUpperCase(), longname: SYMBOLS[sym].name, exchange: exch, exchDisp: SYMBOLS[sym].exchange, quoteType: 'EQUITY' }));
        return json({ quotes: hits });
      }
      const m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/);
      if (m) return chart(decodeURIComponent(m[1]));
      return new Response('not found', { status: 404 });
    }
    if (mode === 'amfi-down') return new Response('unavailable', { status: 503 });
    return new Response(NAV, { status: 200 });
  };
}
