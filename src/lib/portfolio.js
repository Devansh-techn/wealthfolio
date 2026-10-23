import { convert } from './fx';
import { ADD_TYPES, REMOVE_TYPES } from './constants';

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** Effective unit price: cash is always 1 unit = 1 currency unit. */
export function unitPrice(asset) {
  if (!asset) return 0;
  if (asset.asset_type === 'Cash') return 1;
  return Number(asset.current_price) || 0;
}

/**
 * Turn raw holdings into valued rows. All "native" fields are in the asset's currency;
 * "*C" fields are converted to `target` (null when no FX rate is available).
 */
export function valueHoldings({ holdings, assetsById, portfolioIds = null, target, fx }) {
  const rows = [];
  for (const h of holdings) {
    if (portfolioIds && !portfolioIds.includes(h.portfolio_id)) continue;
    const asset = assetsById[h.asset_id];
    if (!asset) continue;
    const quantity = Number(h.quantity);
    const price = unitPrice(asset);
    const prev = asset.previous_close != null && asset.asset_type !== 'Cash' ? Number(asset.previous_close) : price;
    const invested = Number(h.invested_amount);
    const value = quantity * price;
    const isCash = asset.asset_type === 'Cash';
    const pnl = isCash ? 0 : value - invested;
    const dayPnl = isCash || !(prev > 0) ? 0 : quantity * (price - prev);
    const cv = (n) => convert(n, asset.currency, target, fx);
    rows.push({
      id: h.id,
      holding: h,
      asset,
      portfolioId: h.portfolio_id,
      symbol: asset.symbol,
      name: asset.name,
      type: asset.asset_type,
      currency: asset.currency,
      quantity,
      averageBuyPrice: Number(h.average_buy_price),
      currentPrice: price,
      invested,
      value,
      pnl,
      returnPct: !isCash && invested > 0 ? (pnl / invested) * 100 : 0,
      dayPnl,
      dayChangePct: !isCash && prev > 0 ? ((price - prev) / prev) * 100 : 0,
      purchaseDate: h.first_purchase_date,
      investedC: cv(invested),
      valueC: cv(value),
      pnlC: cv(pnl),
      dayPnlC: cv(dayPnl),
    });
  }
  return rows;
}

/** Aggregate valued rows into dashboard totals. */
export function summarizeHoldings(rows, liabilities = [], { target, fx } = {}) {
  const missing = rows.filter((r) => r.valueC === null).length;
  const usable = rows.filter((r) => r.valueC !== null);
  const nonCash = usable.filter((r) => r.type !== 'Cash');
  const cash = sum(usable.filter((r) => r.type === 'Cash').map((r) => r.valueC));
  const investedAmount = sum(nonCash.map((r) => r.investedC));
  const investedValue = sum(nonCash.map((r) => r.valueC));
  const portfolioValue = sum(usable.map((r) => r.valueC));
  const pnl = investedValue - investedAmount;
  const dayPnl = sum(nonCash.map((r) => r.dayPnlC ?? 0));
  const prevInvestedValue = investedValue - dayPnl;

  let liabilitiesTotal = 0;
  let liabilitiesMissing = 0;
  for (const l of liabilities) {
    const c = convert(Number(l.outstanding), l.currency, target, fx);
    if (c === null) liabilitiesMissing += 1;
    else liabilitiesTotal += c;
  }

  const byType = {};
  for (const r of usable) byType[r.type] = (byType[r.type] ?? 0) + r.valueC;
  const allocation = Object.entries(byType)
    .map(([type, value]) => ({ type, value, pct: portfolioValue > 0 ? (value / portfolioValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    portfolioValue,
    investedAmount,
    investedValue,
    cash,
    pnl,
    returnPct: investedAmount > 0 ? (pnl / investedAmount) * 100 : 0,
    dayPnl,
    dayPnlPct: prevInvestedValue > 0 ? (dayPnl / prevInvestedValue) * 100 : 0,
    liabilities: liabilitiesTotal,
    netWorth: portfolioValue - liabilitiesTotal,
    allocation,
    incomplete: missing > 0 || liabilitiesMissing > 0,
    missingCount: missing + liabilitiesMissing,
    holdingCount: rows.length,
  };
}

/**
 * Replay transactions with the same average-cost rules as the database trigger.
 * Returns realized P&L (native currency per row, summed by target) and dividend / fee totals.
 */
export function replayTransactions(transactions) {
  const sorted = [...transactions].sort(
    (a, b) =>
      a.transaction_date.localeCompare(b.transaction_date) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
  );
  const pos = new Map();
  const realized = [];
  const dividends = [];
  const fees = [];
  for (const t of sorted) {
    const q = Number(t.quantity);
    const p = Number(t.price);
    const f = Number(t.fees);
    if (t.type === 'DIVIDEND') {
      dividends.push({ date: t.transaction_date, amount: p - f, currency: t.currency, assetId: t.asset_id });
      continue;
    }
    if (t.type === 'FEE') {
      fees.push({ date: t.transaction_date, amount: p + f, currency: t.currency });
      continue;
    }
    const key = `${t.portfolio_id}|${t.asset_id}`;
    const s = pos.get(key) ?? { qty: 0, cost: 0, avg: 0 };
    if (ADD_TYPES.includes(t.type)) {
      s.cost += q * p + f;
      s.qty += q;
      s.avg = s.qty > 0 ? s.cost / s.qty : 0;
    } else if (REMOVE_TYPES.includes(t.type)) {
      const proceeds = q * p - f;
      const costBasis = s.avg * q;
      if (t.type === 'SELL') realized.push({ date: t.transaction_date, amount: proceeds - costBasis, currency: t.currency, assetId: t.asset_id });
      s.cost = Math.max(s.cost - costBasis, 0);
      s.qty -= q;
      if (s.qty <= 1e-8) s.qty = s.cost = s.avg = 0;
    }
    pos.set(key, s);
  }
  return { realized, dividends, fees };
}

export function totalIn(items, target, fx) {
  let total = 0;
  let missing = 0;
  for (const i of items) {
    const c = convert(i.amount, i.currency, target, fx);
    if (c === null) missing += 1;
    else total += c;
  }
  return { total, missing };
}

/** Concentration metrics from valued rows (uses converted value). */
export function concentration(rows) {
  const usable = rows.filter((r) => r.valueC !== null && r.valueC > 0 && r.type !== 'Cash');
  const total = sum(usable.map((r) => r.valueC));
  if (total <= 0) return { top1: 0, top5: 0, hhi: 0, effectiveN: 0, top: [] };
  const w = usable
    .map((r) => ({ name: r.name, symbol: r.symbol, weight: r.valueC / total }))
    .sort((a, b) => b.weight - a.weight);
  const hhi = sum(w.map((x) => x.weight * x.weight));
  return {
    top1: w[0].weight * 100,
    top5: sum(w.slice(0, 5).map((x) => x.weight)) * 100,
    hhi,
    effectiveN: hhi > 0 ? 1 / hhi : 0,
    top: w.slice(0, 10).map((x) => ({ ...x, weight: x.weight * 100 })),
  };
}
