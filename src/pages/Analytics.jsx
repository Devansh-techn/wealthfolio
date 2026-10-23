import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { usePortfolioSeries, usePortfolioValuation, SERIES_PERIODS } from '../hooks/usePortfolio';
import { PageHeader, StatCard, EmptyState, InlineNotice, Skeleton, ProgressBar, Disclaimer } from '../components/ui/Feedback';
import { LineChart, DonutChart, BarList } from '../components/charts/charts';
import { PALETTE } from '../components/charts/palette';
import { PortfolioSelector } from '../components/PortfolioBits';
import { replayTransactions, totalIn } from '../lib/portfolio';
import { riskScore } from '../lib/analytics';
import { ASSET_TYPE_LABELS } from '../lib/constants';
import { formatDate, formatMoney, formatPercent, pnlClass } from '../lib/format';

const num = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : v.toFixed(d));

export default function Analytics() {
  const data = useAppData();
  const { currency, format, fx } = useCurrency();
  const { rows, summary, conc } = usePortfolioValuation();
  const [period, setPeriod] = useState('1y');
  const [rf, setRf] = useState('0');
  const rfNum = Math.max(0, Math.min(30, Number(rf) || 0));
  const series = usePortfolioSeries(period, rfNum / 100);
  const stats = series.stats;

  const scopedTx = useMemo(() => (data.portfolioIds ? data.transactions.filter((t) => data.portfolioIds.includes(t.portfolio_id)) : data.transactions), [data.transactions, data.portfolioIds]);
  const flows = useMemo(() => {
    const r = replayTransactions(scopedTx);
    return { realized: totalIn(r.realized, currency, fx), dividends: totalIn(r.dividends, currency, fx), fees: totalIn(r.fees, currency, fx) };
  }, [scopedTx, currency, fx]);

  const risk = useMemo(() => riskScore({ volatility: stats?.volatility ?? null, maxDrawdown: stats?.maxDrawdown ?? null, hhi: conc.hhi || null }), [stats, conc.hhi]);

  const byCurrency = useMemo(() => {
    const m = {};
    rows.forEach((r) => { if (r.valueC !== null) m[r.currency] = (m[r.currency] ?? 0) + r.valueC; });
    return Object.entries(m).map(([label, value]) => ({ label, value }));
  }, [rows]);
  const bySector = useMemo(() => {
    const m = {};
    rows.forEach((r) => {
      if (r.valueC === null) return;
      const k = r.type === 'Cash' ? 'Cash' : r.asset.sector || 'Unassigned';
      m[k] = (m[k] ?? 0) + r.valueC;
    });
    const total = Object.values(m).reduce((a, b) => a + b, 0);
    return Object.entries(m).map(([label, value]) => ({ label, value, display: `${formatMoney(value, currency, { compact: true })} · ${total ? ((value / total) * 100).toFixed(1) : 0}%` })).sort((a, b) => b.value - a.value);
  }, [rows, currency]);

  const dateFmt = (d) => formatDate(d, { day: '2-digit', month: 'short', year: '2-digit' });
  const pctFmt = (v) => `${v.toFixed(1)}%`;

  if (!data.holdings.length) {
    return (
      <>
        <PageHeader title="Analytics" subtitle="Performance and risk from your real data" />
        <EmptyState icon={BarChart3} title="Nothing to analyse yet" text="Add assets and transactions and your return, volatility, drawdown and allocation will appear here." action={<Link to="/portfolio" className="btn-primary">Go to portfolio</Link>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Analytics" subtitle="Performance and risk from your real transactions and historical prices" actions={<PortfolioSelector />} />
      <section className="filters glass-panel" aria-label="Analysis settings">
        <div className="seg" role="group" aria-label="Period">{SERIES_PERIODS.map((p) => <button key={p.id} type="button" className={period === p.id ? 'on' : ''} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</button>)}</div>
        <div className="inline-field"><label htmlFor="rf">Risk-free rate % (assumption)</label><input id="rf" className="input input-sm narrow" type="number" min="0" max="30" step="0.1" value={rf} onChange={(e) => setRf(e.target.value)} /></div>
      </section>

      {series.missingFx && <InlineNotice tone="warn">Some holdings couldn’t be converted to {currency} (no exchange rate) and are excluded from the charts.</InlineNotice>}
      {series.failed.length > 0 && <InlineNotice tone="warn">Historical prices unavailable for {series.failed.slice(0, 4).join(', ')}{series.failed.length > 4 ? '…' : ''}. Those assets are valued at their last transaction price, which understates volatility.</InlineNotice>}
      {series.status === 'error' && <InlineNotice tone="error">Unable to fetch market data for the performance history.</InlineNotice>}

      <section className="stat-grid" aria-label="Performance statistics">
        <StatCard label="Portfolio return (TWR)" tone={pnlClass(stats?.totalReturn)} value={series.status === 'loading' ? '…' : stats ? formatPercent(stats.totalReturn, { sign: true }) : 'n/a'} sub="Time-weighted, excludes deposits/withdrawals" />
        <StatCard label="CAGR" value={series.status === 'loading' ? '…' : stats?.cagr != null ? formatPercent(stats.cagr, { sign: true }) : 'n/a'} sub={stats && stats.cagr == null ? 'Needs 3+ months of history' : 'Annualised'} />
        <StatCard label="Volatility" value={series.status === 'loading' ? '…' : stats?.volatility != null ? formatPercent(stats.volatility) : 'n/a'} sub="Annualised std. deviation" />
        <StatCard label="Sharpe ratio" value={series.status === 'loading' ? '…' : num(stats?.sharpe)} sub={`Risk-free ${rfNum}%`} />
        <StatCard label="Max drawdown" tone={stats ? 'text-neg' : ''} value={series.status === 'loading' ? '…' : stats ? formatPercent(stats.maxDrawdown) : 'n/a'} sub="Peak-to-trough in period" />
        <StatCard label="Unrealized P&L" tone={pnlClass(summary.pnl)} value={`${summary.pnl > 0 ? '+' : ''}${format(summary.pnl)}`} sub={formatPercent(summary.returnPct, { sign: true })} />
        <StatCard label="Realized P&L" tone={pnlClass(flows.realized.total)} value={`${flows.realized.total > 0 ? '+' : ''}${format(flows.realized.total)}`} sub="From sells (average cost)" />
        <StatCard label="Dividend income" value={format(flows.dividends.total)} sub={`Fees paid ${format(flows.fees.total)}`} />
        <StatCard label="Cash allocation" value={summary.portfolioValue > 0 ? formatPercent((summary.cash / summary.portfolioValue) * 100) : 'n/a'} sub={format(summary.cash)} />
        <StatCard label="Concentration" value={conc.top1 ? `${conc.top1.toFixed(1)}%` : 'n/a'} sub={conc.top1 ? `Largest holding · top 5 = ${conc.top5.toFixed(1)}% · ~${conc.effectiveN.toFixed(1)} effective positions` : undefined} />
      </section>

      <section className="panel glass-panel" aria-labelledby="risk-h">
        <h2 id="risk-h" className="panel-title">Risk score</h2>
        {risk ? (
          <>
            <div className="risk-figure"><strong>{risk.label}</strong><span>{risk.score.toFixed(0)}/100</span></div>
            <ProgressBar value={risk.score} tone={risk.score < 25 ? 'green' : risk.score < 50 ? 'blue' : risk.score < 75 ? 'gold' : 'red'} label="Risk score" />
            <ul className="bullets small">{risk.parts.map((p) => <li key={p.label}>{p.label}: {p.score.toFixed(0)}/100</li>)}</ul>
            <p className="field-hint">Formula: volatility (40%, 0–40%) + max drawdown (30%, 0–50%) + concentration HHI (30%, 0.05–0.5), each scaled to 0–100. Components without data are dropped. Higher = riskier.</p>
          </>
        ) : <p className="text-body">Not enough data to compute a risk score yet.</p>}
      </section>

      <div className="grid-2">
        <section className="panel glass-panel" aria-labelledby="val-h">
          <h2 id="val-h" className="panel-title">Portfolio value vs net invested</h2>
          {series.status === 'loading' ? <Skeleton height={260} /> : series.points.length > 1 ? (
            <LineChart ariaLabel="Value versus net invested" series={[{ name: 'Value', color: '#fbbf24', area: true, points: series.points.map((p) => ({ x: p.date, y: p.value })) }, { name: 'Net invested', color: '#7B3FE4', dashed: true, points: series.points.map((p) => ({ x: p.date, y: p.netInvested })) }]} formatY={(v) => formatMoney(v, currency, { compact: true })} formatX={dateFmt} />
          ) : <p className="text-body">Not enough history to chart.</p>}
        </section>
        <section className="panel glass-panel" aria-labelledby="dd-h">
          <h2 id="dd-h" className="panel-title">Drawdown</h2>
          {series.status === 'loading' ? <Skeleton height={260} /> : stats ? (
            <LineChart ariaLabel="Drawdown" series={[{ name: 'Drawdown', color: '#ff5d73', area: true, points: series.points.map((p, i) => ({ x: p.date, y: stats.drawdowns[i] ?? 0 })) }]} formatY={pctFmt} formatX={dateFmt} />
          ) : <p className="text-body">Not enough history to chart.</p>}
        </section>
      </div>

      <div className="grid-3">
        <section className="panel glass-panel" aria-labelledby="al-h">
          <h2 id="al-h" className="panel-title">By asset type</h2>
          <DonutChart size={160} ariaLabel="Allocation by asset type" data={summary.allocation.map((a, i) => ({ label: ASSET_TYPE_LABELS[a.type] ?? a.type, value: a.value, color: PALETTE[i % PALETTE.length] }))} formatValue={(v) => formatMoney(v, currency, { compact: true })} />
        </section>
        <section className="panel glass-panel" aria-labelledby="cu-h">
          <h2 id="cu-h" className="panel-title">By currency</h2>
          <DonutChart size={160} ariaLabel="Allocation by currency" data={byCurrency} formatValue={(v) => formatMoney(v, currency, { compact: true })} />
        </section>
        <section className="panel glass-panel" aria-labelledby="se-h">
          <h2 id="se-h" className="panel-title">By sector</h2>
          {bySector.length ? <BarList ariaLabel="Sector allocation" data={bySector} /> : <p className="text-body">No data.</p>}
          {bySector.some((s) => s.label === 'Unassigned') && <p className="field-hint">Set a sector on assets (Assets → Edit) for a fuller breakdown.</p>}
        </section>
      </div>

      <section className="panel glass-panel" aria-labelledby="co-h">
        <h2 id="co-h" className="panel-title">Largest positions</h2>
        {conc.top.length ? <BarList ariaLabel="Top positions by weight" data={conc.top.map((t) => ({ label: t.name, value: t.weight, display: `${t.weight.toFixed(1)}%` }))} max={100} /> : <p className="text-body">No investable holdings.</p>}
      </section>

      <p className="field-hint">Method: quantities come from replaying your transactions; market assets use historical closing prices from the data provider, cash is valued at 1, and manually priced assets at their last transaction price. All values are converted at <em>current</em> exchange rates, so currency effects on past values are not captured. Returns are time-weighted (contributions and withdrawals are removed) and exclude dividends, which are shown separately.</p>
      <Disclaimer />
    </>
  );
}
