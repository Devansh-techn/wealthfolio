// Illustrative demo data for the landing-page hero. Everything shown in the hero is derived from this
// one file so the numbers can never contradict each other. These are NOT real returns or guarantees.

export const NET_WORTH = 24.8; // ₹ lakh

// Percentages must total 100. Amounts are derived from NET_WORTH.
export const ALLOCATION = [
  { key: 'stocks', label: 'Stocks', pct: 35, color: '#34d399' },
  { key: 'realestate', label: 'Real Estate', pct: 25, color: '#d9ae5a' },
  { key: 'funds', label: 'Funds', pct: 18, color: '#6b8cff' },
  { key: 'gold', label: 'Gold', pct: 10, color: '#f2dca0' },
  { key: 'crypto', label: 'Crypto', pct: 7, color: '#a78bfa' },
  { key: 'cash', label: 'Cash', pct: 5, color: '#94a3b8' },
];

export const amountLakh = (pct) => (NET_WORTH * pct) / 100;
export const fmtLakh = (v, digits = 1) => `₹${v.toFixed(digits)}L`;

// "Portfolio" = market-linked holdings only (stocks + funds + gold + crypto). Real estate and cash are
// part of net worth but not of the investment portfolio.
const MARKET_KEYS = ['stocks', 'funds', 'gold', 'crypto'];
export const PORTFOLIO_VALUE = ALLOCATION.filter((a) => MARKET_KEYS.includes(a.key)).reduce((s, a) => s + amountLakh(a.pct), 0);

export const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

// 12 monthly portfolio values (₹ lakh). Gentle, realistic path with small pullbacks; last point = PORTFOLIO_VALUE.
export const PORTFOLIO_SERIES = [14.66, 14.82, 14.71, 15.05, 15.34, 15.28, 15.71, 16.02, 16.18, 16.55, 16.93, PORTFOLIO_VALUE];

const first = PORTFOLIO_SERIES[0];
export const PORTFOLIO_GAIN = PORTFOLIO_VALUE - first;
export const PORTFOLIO_GROWTH_PCT = (PORTFOLIO_VALUE / first - 1) * 100;

// Real estate + cash drift slowly upward; net worth = portfolio + those.
const NON_MARKET_END = NET_WORTH - PORTFOLIO_VALUE;
const NON_MARKET_START = 7.37;
export const NET_WORTH_SERIES = PORTFOLIO_SERIES.map((v, i) => v + NON_MARKET_START + ((NON_MARKET_END - NON_MARKET_START) * i) / (PORTFOLIO_SERIES.length - 1));
export const NET_WORTH_GROWTH_PCT = (NET_WORTH_SERIES[NET_WORTH_SERIES.length - 1] / NET_WORTH_SERIES[0] - 1) * 100;

export const DIVERSIFICATION_SCORE = 84;
