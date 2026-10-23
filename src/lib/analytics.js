import { convert } from './fx';
import { ADD_TYPES, REMOVE_TYPES } from './constants';
import { mean, stdev, maxDrawdown, drawdownSeries } from './indicators';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Reconstruct a daily portfolio value series from the transaction ledger and historical prices.
 *
 * Method (documented in the UI):
 *  - quantity on each date comes from replaying BUY/DEPOSIT/SELL/WITHDRAWAL up to that date
 *  - market-priced assets use the latest close on or before the date (history in native currency)
 *  - cash is valued at 1; manual-priced assets use the latest transaction price on or before the date
 *  - everything is converted at the *current* FX rate (historical FX is not used)
 *  - external flows (buys/deposits in, sells/withdrawals out) are removed from returns (time-weighted)
 *
 * @param transactions ledger rows already filtered to the selected portfolios
 * @param assetsById
 * @param histories { [assetId]: [{date:'YYYY-MM-DD', close:number}] }
 */
export function buildValueSeries({ transactions, assetsById, histories, target, fx, startDate, endDate }) {
  const txs = transactions
    .filter((t) => t.asset_id && assetsById[t.asset_id] && [...ADD_TYPES, ...REMOVE_TYPES].includes(t.type))
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  if (!txs.length) return { points: [], missingFx: false, unpricedAssets: [] };

  const first = txs[0].transaction_date;
  const start = startDate && startDate > first ? startDate : first;
  const end = endDate;

  // Trading-day axis = union of all history dates in range (+ transaction dates + endpoints).
  const axis = new Set([start, end]);
  for (const id of Object.keys(histories)) for (const p of histories[id]) if (p.date >= start && p.date <= end) axis.add(p.date);
  for (const t of txs) if (t.transaction_date >= start && t.transaction_date <= end) axis.add(t.transaction_date);
  const dates = [...axis].sort();

  const assetIds = [...new Set(txs.map((t) => t.asset_id))];
  const rateOf = {};
  let missingFx = false;
  for (const id of assetIds) {
    const r = convert(1, assetsById[id].currency, target, fx);
    if (r === null) missingFx = true;
    rateOf[id] = r ?? 0;
  }

  // Per-asset pointers
  const hist = {};
  for (const id of assetIds) hist[id] = { arr: histories[id] ?? [], i: -1, lastClose: null };
  const lastTxPrice = {};
  const qty = {};
  let ti = 0;
  const points = [];
  let netInvested = 0;
  const unpriced = new Set();

  for (const d of dates) {
    let flow = 0;
    while (ti < txs.length && txs[ti].transaction_date <= d) {
      const t = txs[ti];
      const q = Number(t.quantity);
      const p = Number(t.price);
      const f = Number(t.fees);
      const r = rateOf[t.asset_id];
      if (ADD_TYPES.includes(t.type)) {
        qty[t.asset_id] = (qty[t.asset_id] ?? 0) + q;
        if (t.transaction_date >= start) flow += (q * p + f) * r;
        else netInvested += (q * p + f) * r;
      } else {
        qty[t.asset_id] = Math.max((qty[t.asset_id] ?? 0) - q, 0);
        if (t.transaction_date >= start) flow -= (q * p - f) * r;
        else netInvested -= (q * p - f) * r;
      }
      lastTxPrice[t.asset_id] = p;
      ti += 1;
    }
    netInvested += flow;

    let value = 0;
    for (const id of assetIds) {
      const q = qty[id] ?? 0;
      if (q <= 0) continue;
      const asset = assetsById[id];
      let price;
      if (asset.asset_type === 'Cash') price = 1;
      else if (asset.price_source === 'market' && hist[id].arr.length) {
        const h = hist[id];
        while (h.i + 1 < h.arr.length && h.arr[h.i + 1].date <= d) {
          h.i += 1;
          h.lastClose = h.arr[h.i].close;
        }
        price = h.lastClose ?? h.arr[0].close;
      } else {
        price = lastTxPrice[id] ?? 0;
        if (asset.asset_type !== 'Real Estate' && asset.asset_type !== 'Other' && asset.price_source === 'market') unpriced.add(asset.name);
      }
      value += q * price * rateOf[id];
    }
    points.push({ date: d, value, netInvested, flow });
  }

  return { points, missingFx, unpricedAssets: [...unpriced] };
}

/** Time-weighted return index and risk statistics from a value series. */
export function seriesStats(points, { riskFree = 0 } = {}) {
  if (points.length < 2) return null;
  const index = [100];
  const returns = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].value;
    if (prev > 0) {
      const r = (points[i].value - points[i].flow) / prev - 1;
      returns.push(r);
      index.push(index[index.length - 1] * (1 + r));
    } else {
      index.push(index[index.length - 1]);
    }
  }
  const t0 = new Date(`${points[0].date}T00:00:00`).getTime();
  const t1 = new Date(`${points[points.length - 1].date}T00:00:00`).getTime();
  const years = (t1 - t0) / (365.25 * 86400000);
  const ppy = years > 0 ? Math.min(Math.max((points.length - 1) / years, 1), 366) : 252;

  const totalReturn = (index[index.length - 1] / index[0] - 1) * 100;
  const cagr = years >= 0.25 ? (Math.pow(index[index.length - 1] / index[0], 1 / years) - 1) * 100 : null;
  const vol = returns.length >= 20 ? stdev(returns) * Math.sqrt(ppy) * 100 : null;
  const annRet = mean(returns) * ppy;
  const sharpe = vol && vol > 0 ? (annRet - riskFree) / (vol / 100) : null;
  return {
    index,
    drawdowns: drawdownSeries(index),
    totalReturn,
    cagr,
    volatility: vol,
    sharpe,
    maxDrawdown: maxDrawdown(index),
    years,
    observations: points.length,
  };
}

/**
 * Composite risk score 0-100 (higher = riskier) with a transparent formula:
 *   volatility (40%): 0% -> 0, 40%+ -> 100
 *   max drawdown (30%): 0% -> 0, 50%+ -> 100
 *   concentration HHI (30%): 0.05 -> 0, 0.5+ -> 100
 * Components that cannot be computed are dropped and the weights renormalised.
 */
export function riskScore({ volatility, maxDrawdown: mdd, hhi }) {
  const parts = [];
  if (volatility != null) parts.push({ w: 0.4, v: clamp01(volatility / 40) * 100, label: 'Volatility' });
  if (mdd != null) parts.push({ w: 0.3, v: clamp01(Math.abs(mdd) / 50) * 100, label: 'Max drawdown' });
  if (hhi != null && hhi > 0) parts.push({ w: 0.3, v: clamp01((hhi - 0.05) / 0.45) * 100, label: 'Concentration' });
  if (!parts.length) return null;
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const score = parts.reduce((a, p) => a + p.v * p.w, 0) / wsum;
  const label = score < 25 ? 'Low' : score < 50 ? 'Moderate' : score < 75 ? 'High' : 'Very high';
  return { score, label, parts: parts.map((p) => ({ label: p.label, score: p.v })) };
}
