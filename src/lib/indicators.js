// Pure technical-indicator maths. Input: arrays of closes (oldest -> newest).

export const last = (a) => (a.length ? a[a.length - 1] : null);

export function sma(closes, n) {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i += 1) s += closes[i];
  return s / n;
}

/** Wilder's RSI. Needs n+1 closes. */
export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / n;
  let avgL = loss / n;
  for (let i = n + 1; i < closes.length; i += 1) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (n - 1) + (d > 0 ? d : 0)) / n;
    avgL = (avgL * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

/** Percent return over the last `lookback` observations. */
export function pctReturn(closes, lookback, skip = 0) {
  const end = closes.length - 1 - skip;
  const start = end - lookback;
  if (start < 0 || !(closes[start] > 0)) return null;
  return (closes[end] / closes[start] - 1) * 100;
}

export function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i += 1) if (closes[i - 1] > 0) r.push(closes[i] / closes[i - 1] - 1);
  return r;
}

export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

/** Annualised volatility in percent. */
export function annualVolatility(closes, periodsPerYear = 252) {
  const r = dailyReturns(closes);
  if (r.length < 20) return null;
  return stdev(r) * Math.sqrt(periodsPerYear) * 100;
}

/** Max drawdown in percent (negative number, e.g. -23.4). */
export function maxDrawdown(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.min(worst, v / peak - 1);
  }
  return worst * 100;
}

export function drawdownSeries(series) {
  let peak = -Infinity;
  return series.map((v) => {
    if (v > peak) peak = v;
    return peak > 0 ? (v / peak - 1) * 100 : 0;
  });
}

/** Position within the 52-week range, 0..100. */
export function rangePosition(closes, lookback = 252) {
  const w = closes.slice(-lookback);
  if (w.length < 20) return null;
  const hi = Math.max(...w);
  const lo = Math.min(...w);
  if (hi === lo) return 50;
  return ((closes[closes.length - 1] - lo) / (hi - lo)) * 100;
}

/** All technical metrics the screener needs, derived from closes + volumes. */
export function technicalMetrics(closes, volumes = []) {
  if (!closes || closes.length < 30) return null;
  const price = closes[closes.length - 1];
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const vols = volumes.filter((v) => Number.isFinite(v) && v > 0);
  return {
    price,
    rsi14: rsi(closes, 14),
    sma50,
    sma200,
    aboveSma50: sma50 ? price > sma50 : null,
    aboveSma200: sma200 ? price > sma200 : null,
    goldenCross: sma50 && sma200 ? sma50 > sma200 : null,
    momentum1m: pctReturn(closes, 21),
    momentum3m: pctReturn(closes, 63),
    momentum6m: pctReturn(closes, 126),
    momentum12m1m: pctReturn(closes, 231, 21), // 12-month return skipping the latest month
    volatility: annualVolatility(closes),
    maxDrawdown1y: maxDrawdown(closes.slice(-252)),
    rangePosition: rangePosition(closes),
    avgVolume20: vols.length >= 20 ? mean(vols.slice(-20)) : null,
    observations: closes.length,
  };
}
