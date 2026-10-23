import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { usePortfolioSeries, usePortfolioValuation } from '../hooks/usePortfolio';
import { ProgressBar, InlineNotice, Disclaimer } from '../components/ui/Feedback';
import { PricesStatus } from '../components/PortfolioBits';
import AssetFormModal from '../components/AssetFormModal';
import OverviewStrip from '../components/dashboard/OverviewStrip';
import PerformancePanel from '../components/dashboard/PerformancePanel';
import AllocationPanel from '../components/dashboard/AllocationPanel';
import ActivityPanel from '../components/dashboard/ActivityPanel';
import { MarketIntelligence, WatchlistPanel } from '../components/dashboard/MarketPanels';
import { riskScore } from '../lib/analytics';
import { analyzeGoal } from '../lib/goals';
import { ASSET_TYPE_LABELS } from '../lib/constants';
import { formatPercent, pnlClass } from '../lib/format';

/** Signed-in home. It always renders the full terminal (zeros and "—" for an empty account); nothing is estimated. */
export default function Dashboard() {
  const data = useAppData();
  const { currency, format, fxStatus } = useCurrency();
  const { rows, summary, conc } = usePortfolioValuation();
  const [period, setPeriod] = useState('1y');
  const series = usePortfolioSeries(period);
  const [addOpen, setAddOpen] = useState(false);

  const topHoldings = useMemo(() => [...rows].filter((r) => r.valueC !== null).sort((a, b) => b.valueC - a.valueC).slice(0, 5), [rows]);
  const goals = useMemo(() => data.goals.map((g) => ({ g, a: analyzeGoal(g) })).slice(0, 3), [data.goals]);
  const risk = useMemo(() => riskScore({ volatility: series.stats?.volatility ?? null, maxDrawdown: series.stats?.maxDrawdown ?? null, hhi: conc.hhi || null }), [series.stats, conc.hhi]);
  const openAdd = () => setAddOpen(true);

  return (
    <>
      <h1 className="sr-only">Overview</h1>
      {summary.incomplete && fxStatus !== 'loading' && (
        <InlineNotice tone="warn">{summary.missingCount} item(s) couldn’t be converted to {currency} (exchange rates unavailable) and are excluded from totals.</InlineNotice>
      )}
      <OverviewStrip summary={summary} holdingCount={data.holdings.length} liabilityCount={data.liabilities.length} onAdd={openAdd} />
      <PricesStatus />

      <div className="dash-main">
        <PerformancePanel period={period} onPeriod={setPeriod} series={series} onAdd={openAdd} fallbackValue={summary.portfolioValue} />
        <AllocationPanel allocation={summary.allocation} onAdd={openAdd} />
      </div>

      <div className="dash-trio">
        <MarketIntelligence />
        <WatchlistPanel />
        <ActivityPanel />
      </div>

      <div className="dash-main dash-lower">
        <section className="dpanel" aria-labelledby="top-h">
          <div className="dpanel-head"><h2 id="top-h" className="eyebrow">Top holdings</h2><Link to="/portfolio" className="link-sm">View all</Link></div>
          {topHoldings.length === 0 ? (
            <p className="panel-empty">No holdings yet.</p>
          ) : (
            <table className="mini-table">
              <thead><tr><th scope="col">Asset</th><th scope="col">Type</th><th scope="col" className="right">Weight</th><th scope="col" className="right">Value</th><th scope="col" className="right">Return</th></tr></thead>
              <tbody>
                {topHoldings.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong><small>{r.symbol ?? ''}</small></td>
                    <td>{ASSET_TYPE_LABELS[r.type] ?? r.type}</td>
                    <td className="right num">{summary.portfolioValue > 0 ? `${((r.valueC / summary.portfolioValue) * 100).toFixed(1)}%` : '—'}</td>
                    <td className="right num">{format(r.valueC)}</td>
                    <td className={`right num ${pnlClass(r.pnl)}`}>{r.type === 'Cash' ? '—' : formatPercent(r.returnPct, { sign: true })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="dash-stack">
          <section className="dpanel" aria-labelledby="rk-h">
            <div className="dpanel-head"><h2 id="rk-h" className="eyebrow">Risk summary</h2><Link to="/analytics" className="link-sm">Details</Link></div>
            {risk ? (
              <>
                <div className="risk-figure"><strong>{risk.label}</strong><span className="num">{risk.score.toFixed(0)}/100</span></div>
                <ProgressBar value={risk.score} tone={risk.score < 25 ? 'green' : risk.score < 50 ? 'blue' : risk.score < 75 ? 'gold' : 'red'} label="Risk score" />
                <p className="field-hint">Top holding {conc.top1.toFixed(1)}% · top 5 {conc.top5.toFixed(1)}%{series.stats?.volatility != null ? ` · volatility ${series.stats.volatility.toFixed(1)}%` : ''}</p>
              </>
            ) : <p className="panel-empty">Add assets to see a risk summary.</p>}
          </section>
          <section className="dpanel" aria-labelledby="gl-h">
            <div className="dpanel-head"><h2 id="gl-h" className="eyebrow">Goal progress</h2><Link to="/goals" className="link-sm">Manage</Link></div>
            {goals.length === 0 ? <p className="panel-empty">No goals yet. <Link to="/goals" className="link-sm">Create one</Link></p> : (
              <ul className="rows block">
                {goals.map(({ g, a }) => (
                  <li key={g.id}>
                    <div className="row-between"><strong>{g.name}</strong><small className="num">{a.progress.toFixed(0)}%</small></div>
                    <ProgressBar value={a.progress} tone={a.onTrack ? 'green' : 'gold'} label={`${g.name} progress`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <Disclaimer />
      {addOpen && <AssetFormModal open onClose={() => setAddOpen(false)} defaultCurrency={currency} defaultPortfolioId={data.portfolioIds?.[0]} />}
    </>
  );
}
