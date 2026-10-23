import { Plus } from 'lucide-react';
import { useCurrency } from '../../contexts/CurrencyContext';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';
import { PortfolioSelector } from '../PortfolioBits';
import { formatMoney, formatPercent, pnlClass } from '../../lib/format';

const signed = (v, cur) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatMoney(Math.abs(v), cur, { maxFraction: 2 })}`;

/** Primary wealth overview: net worth, today's move, and the five figures that explain it. All values come from the user's data. */
export default function OverviewStrip({ summary, holdingCount, liabilityCount, onAdd }) {
  const { currency } = useCurrency();
  const animated = useAnimatedNumber(summary.netWorth);
  const hasPriceMove = holdingCount > 0 && summary.dayPnlPct !== null && summary.dayPnlPct !== undefined;
  const money = (v) => formatMoney(v, currency, { maxFraction: 2 });
  const kpis = [
    { label: 'Portfolio value', value: money(summary.portfolioValue), sub: `${holdingCount} holding${holdingCount === 1 ? '' : 's'}` },
    { label: 'Invested', value: money(summary.investedAmount), sub: 'Cost basis, excl. cash' },
    { label: 'Cash', value: money(summary.cash), sub: summary.portfolioValue > 0 ? `${((summary.cash / summary.portfolioValue) * 100).toFixed(1)}% of portfolio` : '—' },
    { label: 'Debt', value: money(summary.liabilities), sub: liabilityCount ? `${liabilityCount} liabilit${liabilityCount === 1 ? 'y' : 'ies'}` : 'None recorded' },
    { label: 'Net gain', value: holdingCount ? signed(summary.pnl, currency) : money(0), sub: holdingCount ? `${formatPercent(summary.returnPct, { sign: true })} total return` : '—', tone: holdingCount ? pnlClass(summary.pnl) : '' },
  ];
  return (
    <section className="ov" aria-labelledby="ov-h">
      <div className="ov-top">
        <div>
          <h2 id="ov-h" className="eyebrow">Total net worth</h2>
          <p className="ov-figure num" role="img" aria-label={`Total net worth ${money(summary.netWorth)}`}>{money(animated)}</p>
          <p className="ov-today">
            <span className="eyebrow">Today</span>
            {hasPriceMove ? (
              <strong className={`num ${pnlClass(summary.dayPnl)}`}>
                {summary.dayPnl > 0 ? '▲ ' : summary.dayPnl < 0 ? '▼ ' : ''}{signed(summary.dayPnl, currency)} <span>({formatPercent(summary.dayPnlPct, { sign: true })})</span>
              </strong>
            ) : (
              <strong className="num muted">—</strong>
            )}
          </p>
        </div>
        <div className="ov-actions">
          <PortfolioSelector />
          <button type="button" className="btn-primary-sm" onClick={onAdd}><Plus size={16} aria-hidden="true" /> Add asset</button>
        </div>
      </div>
      <dl className="ov-kpis">
        {kpis.map((k) => (
          <div key={k.label}>
            <dt className="eyebrow">{k.label}</dt>
            <dd className={`num ${k.tone ?? ''}`}>{k.value}</dd>
            <small>{k.sub}</small>
          </div>
        ))}
      </dl>
    </section>
  );
}
