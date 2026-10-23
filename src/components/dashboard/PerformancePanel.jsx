import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useCurrency } from '../../contexts/CurrencyContext';
import { DASHBOARD_PERIODS } from '../../hooks/usePortfolio';
import { LineChart } from '../charts/charts';
import { Skeleton } from '../ui/Feedback';
import { lastPoints, periodPerformance } from '../../lib/dashboardData';
import { formatDate, formatMoney, formatPercent, pnlClass } from '../../lib/format';

/** Portfolio value over time, reconstructed from the user's transactions + historical prices. Never invents history. */
export default function PerformancePanel({ period, onPeriod, series, onAdd, fallbackValue }) {
  const { currency } = useCurrency();
  const points = useMemo(() => (period === '1d' ? lastPoints(series.points, 2) : series.points), [period, series.points]);
  const perf = useMemo(() => periodPerformance(points), [points]);
  const chart = points.length > 1
    ? [
        { name: 'Portfolio value', color: '#3da679', area: true, points: points.map((p) => ({ x: p.date, y: p.value })) },
        { name: 'Net invested', color: '#c8a96b', dashed: true, points: points.map((p) => ({ x: p.date, y: p.netInvested })) },
      ]
    : null;
  const latest = points.at(-1)?.value ?? fallbackValue;
  return (
    <section className="dpanel perf" aria-labelledby="perf-h">
      <div className="dpanel-head">
        <div>
          <h2 id="perf-h" className="eyebrow">Portfolio value</h2>
          <p className="perf-figure num">{formatMoney(latest, currency, { maxFraction: 2 })}</p>
          <p className="perf-delta">
            <span className="eyebrow">Period P&amp;L</span>
            {perf ? <strong className={`num ${pnlClass(perf.pnl)}`}>{perf.pnl > 0 ? '+' : perf.pnl < 0 ? '−' : ''}{formatMoney(Math.abs(perf.pnl), currency, { maxFraction: 2 })}{perf.pct !== null && <span> ({formatPercent(perf.pct, { sign: true })})</span>}</strong> : <strong className="num muted">—</strong>}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Chart period">
          {DASHBOARD_PERIODS.map((p) => (
            <button key={p.id} type="button" className={period === p.id ? 'on' : ''} aria-pressed={period === p.id} onClick={() => onPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="perf-body" key={period}>
        {series.status === 'loading' && <Skeleton height={260} />}
        {series.status === 'error' && <p className="text-body">Unable to build the performance chart right now.</p>}
        {series.status === 'ready' && chart && (
          <LineChart series={chart} height={260} ariaLabel="Portfolio value over time" formatY={(v) => formatMoney(v, currency, { compact: true })} formatX={(d) => formatDate(d, { day: '2-digit', month: 'short', year: '2-digit' })} />
        )}
        {(series.status === 'empty' || (series.status === 'ready' && !chart)) && (
          <div className="chart-empty">
            <div className="chart-empty-lines" aria-hidden="true"><i /><i /><i /><i /></div>
            <p className="chart-empty-title">No portfolio history yet</p>
            <p className="chart-empty-sub">{series.status === 'empty' ? 'Performance appears once you record your first transaction.' : 'More price history is needed to draw a chart.'}</p>
            {series.status === 'empty' && <button type="button" className="btn-primary-sm" onClick={onAdd}><Plus size={16} aria-hidden="true" /> Add your first asset</button>}
          </div>
        )}
      </div>
      {series.failed.length > 0 && <p className="field-hint">Price history unavailable for {series.failed.slice(0, 3).join(', ')}{series.failed.length > 3 ? '…' : ''}; valued at last transaction price.</p>}
      <p className="field-hint">{period === '1d' ? '1D compares the last two daily closes (the data source provides daily history only). ' : ''}Reconstructed from your transactions and historical prices at current exchange rates. Period P&amp;L excludes money added or withdrawn.</p>
    </section>
  );
}
