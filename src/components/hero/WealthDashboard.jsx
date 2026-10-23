import PortfolioChart from './PortfolioChart';
import { PORTFOLIO_GAIN, PORTFOLIO_GROWTH_PCT, PORTFOLIO_SERIES, PORTFOLIO_VALUE, fmtLakh } from './heroData';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

/** The large glass "command centre" that sits behind and below the headline. All values from heroData. */
export default function WealthDashboard() {
  return (
    <div className="wd glass-panel">
      <div className="wd-sheen" aria-hidden="true" />
      <header className="wd-top">
        <div className="wd-dots" aria-hidden="true"><i /><i /><i /></div>
        <span className="wd-title">Wealth command center</span>
        <span className="wd-secure"><ShieldCheck size={13} aria-hidden="true" /> Private</span>
      </header>

      <div className="wd-body">
        <div className="wd-head">
          <div>
            <span className="wd-eyebrow">Portfolio value</span>
            <div className="wd-value">
              <strong>{fmtLakh(PORTFOLIO_VALUE)}</strong>
              <span className="wd-delta"><ArrowUpRight size={14} aria-hidden="true" />+{PORTFOLIO_GROWTH_PCT.toFixed(2)}%</span>
            </div>
          </div>
          <span className="wd-range">Last 12 months</span>
        </div>

        <PortfolioChart />

        <dl className="wd-stats">
          <div><dt>12 months ago</dt><dd>{fmtLakh(PORTFOLIO_SERIES[0])}</dd></div>
          <div><dt>Gain</dt><dd className="pos">+{fmtLakh(PORTFOLIO_GAIN)}</dd></div>
          <div><dt>Today</dt><dd>{fmtLakh(PORTFOLIO_VALUE)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
