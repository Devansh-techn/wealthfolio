// Symbol lists only (no prices or fundamentals). Lists are curated convenience sets, NOT official index
// constituents — index membership changes, so verify against the exchange before relying on them.
export const UNIVERSES = [
  {
    id: 'in-largecap',
    label: 'India large caps (NSE, curated)',
    symbols: [
      'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', 'INFY.NS', 'HINDUNILVR.NS', 'ITC.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'KOTAKBANK.NS',
      'LT.NS', 'AXISBANK.NS', 'BAJFINANCE.NS', 'ASIANPAINT.NS', 'MARUTI.NS', 'HCLTECH.NS', 'SUNPHARMA.NS', 'TITAN.NS', 'ULTRACEMCO.NS', 'NESTLEIND.NS',
      'WIPRO.NS', 'ONGC.NS', 'NTPC.NS', 'POWERGRID.NS', 'M&M.NS', 'TATAMOTORS.NS', 'TATASTEEL.NS', 'JSWSTEEL.NS', 'ADANIENT.NS', 'ADANIPORTS.NS',
      'COALINDIA.NS', 'BAJAJFINSV.NS', 'TECHM.NS', 'INDUSINDBK.NS', 'GRASIM.NS', 'DRREDDY.NS', 'CIPLA.NS', 'EICHERMOT.NS', 'HEROMOTOCO.NS', 'BPCL.NS',
      'BRITANNIA.NS', 'DIVISLAB.NS', 'APOLLOHOSP.NS', 'HINDALCO.NS', 'TATACONSUM.NS', 'BAJAJ-AUTO.NS', 'SHRIRAMFIN.NS', 'TRENT.NS', 'BEL.NS',
    ],
  },
  {
    id: 'us-largecap',
    label: 'US large caps (curated)',
    symbols: [
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'BRK-B', 'JPM', 'V', 'MA', 'UNH', 'JNJ', 'PG', 'XOM', 'HD', 'COST', 'KO', 'PEP', 'ABBV', 'MRK',
      'AVGO', 'CVX', 'WMT', 'LLY', 'ORCL', 'ADBE', 'CRM', 'MCD', 'TMO', 'CSCO',
    ],
  },
  { id: 'custom', label: 'Custom list…', symbols: [] },
];
