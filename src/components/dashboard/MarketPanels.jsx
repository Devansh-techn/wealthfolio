import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { useAppData } from '../../contexts/DataContext';
import { useQuotes } from '../../hooks/useQuotes';
import { Skeleton } from '../ui/Feedback';
import { formatMoney, formatPercent, pnlClass } from '../../lib/format';

// Fixed, real instruments served by the existing market-data function (Yahoo symbols). Nothing here is a value.
const MARKETS = [
  { symbol: '^NSEI', name: 'NIFTY 50', region: 'India', index: true },
  { symbol: '^BSESN', name: 'SENSEX', region: 'India', index: true },
  { symbol: '^IXIC', name: 'NASDAQ', region: 'US', index: true },
  { symbol: 'BTC-USD', name: 'BITCOIN', region: 'Crypto', index: false },
];
const MARKET_SYMBOLS = MARKETS.map((m) => m.symbol);

// Index levels in points with consistent two decimals (e.g. 24,350.10).
const points = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const changePct = (q) => (q?.ok && q.previousClose ? ((q.price - q.previousClose) / q.previousClose) * 100 : null);
function marketLabel(symbol, q) {
  if (symbol.endsWith('.NS')) return 'NSE';
  if (symbol.endsWith('.BO')) return 'BSE';
  if (/-USD$|-INR$/.test(symbol)) return 'Crypto';
  return q?.exchange ?? '—';
}

export function MarketIntelligence() {
  const mq = useQuotes(MARKET_SYMBOLS);
  const failed = mq.status === 'error' || (mq.status === 'ready' && MARKETS.every((m) => !mq.quotes[m.symbol]?.ok));
  return (
    <section className="dpanel" aria-labelledby="mkt-h">
      <div className="dpanel-head">
        <h2 id="mkt-h" className="eyebrow">Market intelligence</h2>
        <small className="muted">Delayed</small>
      </div>
      {failed ? (
        <div className="panel-unavailable" role="status">
          <p>Market data temporarily unavailable</p>
          <button type="button" className="btn-secondary btn-sm" onClick={mq.reload}><RotateCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      ) : (
        <ul className="rows">
          {MARKETS.map((m) => {
            const q = mq.quotes[m.symbol];
            const chg = changePct(q);
            return (
              <li key={m.symbol}>
                <div><strong>{m.name}</strong><small>{m.region}</small></div>
                <div className="right">
                  {mq.status === 'loading' ? <Skeleton width={72} height={16} /> : q?.ok ? (
                    <><strong className="num">{m.index ? points(q.price) : formatMoney(q.price, q.currency ?? 'USD', { maxFraction: 2 })}</strong><small className={`num ${pnlClass(chg)}`}>{chg === null ? '—' : `${chg > 0 ? '▲' : chg < 0 ? '▼' : ''} ${formatPercent(chg, { sign: true })}`}</small></>
                  ) : <small className="muted">—</small>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function WatchlistPanel() {
  const { watchlist } = useAppData();
  const symbols = useMemo(() => watchlist.slice(0, 6).map((w) => w.symbol), [watchlist]);
  const wq = useQuotes(symbols);
  return (
    <section className="dpanel" aria-labelledby="wl-h">
      <div className="dpanel-head"><h2 id="wl-h" className="eyebrow">Your watchlist</h2><Link to="/watchlist" className="link-sm">Manage</Link></div>
      {watchlist.length === 0 ? (
        <p className="panel-empty">No assets on your watchlist yet.</p>
      ) : (
        <table className="mini-table">
          <thead><tr><th scope="col">Symbol</th><th scope="col">Market</th><th scope="col" className="right">Price</th><th scope="col" className="right">Change</th></tr></thead>
          <tbody>
            {watchlist.slice(0, 6).map((w) => {
              const q = wq.quotes[w.symbol];
              const chg = changePct(q);
              return (
                <tr key={w.id}>
                  <td><strong>{w.symbol}</strong><small>{w.name}</small></td>
                  <td>{marketLabel(w.symbol, q)}</td>
                  <td className="right num">{wq.status === 'loading' ? <Skeleton width={60} height={14} /> : q?.ok ? formatMoney(q.price, q.currency, { maxFraction: 2 }) : '—'}</td>
                  <td className={`right num ${pnlClass(chg)}`}>{wq.status === 'loading' ? '' : chg === null ? '—' : formatPercent(chg, { sign: true })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {wq.status === 'error' && <p className="field-hint">Market data temporarily unavailable. <button type="button" className="link-sm" onClick={wq.reload}>Retry</button></p>}
    </section>
  );
}
