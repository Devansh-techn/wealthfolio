import { useEffect, useMemo, useState } from 'react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { valueHoldings, summarizeHoldings, concentration } from '../lib/portfolio';
import { buildValueSeries, seriesStats } from '../lib/analytics';
import { getHistoricalPrices } from '../services/marketDataService';
import { toISODate } from '../lib/format';

/** Valued holdings + totals for the selected portfolio scope, in the display currency. */
export function usePortfolioValuation() {
  const { holdings, assetsById, portfolioIds, liabilities } = useAppData();
  const { currency, fx } = useCurrency();
  return useMemo(() => {
    const rows = valueHoldings({ holdings, assetsById, portfolioIds, target: currency, fx });
    const summary = summarizeHoldings(rows, portfolioIds ? [] : liabilities, { target: currency, fx });
    return { rows, summary, conc: concentration(rows), currency, fx };
  }, [holdings, assetsById, portfolioIds, liabilities, currency, fx]);
}

const PERIOD_DAYS = { '1d': 6, '1w': 9, '1m': 32, '3m': 92, '6m': 183, '1y': 366, '3y': 1096 };
// Short windows reuse the 1-month daily history from the provider.
const PROVIDER_PERIOD = { '1d': '1m', '1w': '1m', '1m': '1m' };
export const DASHBOARD_PERIODS = [
  { id: '1d', label: '1D' }, { id: '1w', label: '1W' }, { id: '1m', label: '1M' },
  { id: '3m', label: '3M' }, { id: '1y', label: '1Y' }, { id: 'max', label: 'ALL' },
];
export const SERIES_PERIODS = [
  { id: '3m', label: '3M' },
  { id: '6m', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '3y', label: '3Y' },
  { id: 'max', label: 'All' },
];

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i;
        i += 1;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/**
 * Portfolio value series reconstructed from the transaction ledger and real historical prices.
 * status: 'empty' | 'loading' | 'ready' | 'error'
 */
export function usePortfolioSeries(period = '1y', riskFree = 0) {
  const { transactions, assetsById, portfolioIds } = useAppData();
  const { currency, fx } = useCurrency();

  const scopedTx = useMemo(
    () => (portfolioIds ? transactions.filter((t) => portfolioIds.includes(t.portfolio_id)) : transactions),
    [transactions, portfolioIds],
  );
  const key = useMemo(
    () => `${period}|${currency}|${fx?.asOf ?? 'nofx'}|${scopedTx.length}|${scopedTx[0]?.id ?? ''}|${portfolioIds?.join(',') ?? 'all'}`,
    [period, currency, fx, scopedTx, portfolioIds],
  );
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    if (!scopedTx.length) return undefined;
    let alive = true;
    (async () => {
      try {
        const today = toISODate();
        const first = scopedTx.reduce((m, t) => (t.transaction_date < m ? t.transaction_date : m), today);
        let start = first;
        if (period !== 'max') {
          const s = toISODate(new Date(Date.now() - PERIOD_DAYS[period] * 86400000));
          start = s > first ? s : first;
        }
        const assetIds = [...new Set(scopedTx.map((t) => t.asset_id).filter(Boolean))];
        const marketAssets = assetIds.map((id) => assetsById[id]).filter((a) => a && a.price_source === 'market' && a.symbol && a.asset_type !== 'Cash');
        const provPeriod = period === 'max' ? '5y' : (PROVIDER_PERIOD[period] ?? period);
        const failed = [];
        const histories = {};
        await mapLimit(marketAssets, 4, async (a) => {
          try {
            const pts = await getHistoricalPrices(a.symbol, provPeriod);
            if (pts.length) histories[a.id] = pts;
            else failed.push(a.name);
          } catch {
            failed.push(a.name);
          }
        });
        const built = buildValueSeries({ transactions: scopedTx, assetsById, histories, target: currency, fx, startDate: start, endDate: today });
        if (!alive) return;
        setResult({ key, status: 'ready', points: built.points, missingFx: built.missingFx, failed, unpriced: built.unpricedAssets });
      } catch {
        if (alive) setResult({ key, status: 'error', points: [], failed: [], unpriced: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [key, scopedTx, assetsById, currency, fx, period]);

  const current = result.key === key ? result : null;
  const points = useMemo(() => current?.points ?? [], [current]);
  const stats = useMemo(() => (points.length > 1 ? seriesStats(points, { riskFree }) : null), [points, riskFree]);
  const status = !scopedTx.length ? 'empty' : !current ? 'loading' : current.status;
  return { status, points, stats, failed: current?.failed ?? [], unpriced: current?.unpriced ?? [], missingFx: current?.missingFx ?? false };
}
