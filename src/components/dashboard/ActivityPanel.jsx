import { useMemo } from 'react';
import { ArrowLeftRight, Briefcase, Eye, Plus, RefreshCw } from 'lucide-react';
import { useAppData } from '../../contexts/DataContext';
import { buildActivity } from '../../lib/dashboardData';
import { formatMoney, formatRelativeTime } from '../../lib/format';

const ICONS = { transaction: ArrowLeftRight, asset: Plus, watchlist: Eye, portfolio: Briefcase, prices: RefreshCw };

export default function ActivityPanel() {
  const data = useAppData();
  const items = useMemo(
    () => buildActivity({ transactions: data.transactions, assets: data.assets, watchlist: data.watchlist, portfolios: data.portfolios, assetsById: data.assetsById, pricesUpdatedAt: data.priceStatus?.updatedAt }),
    [data.transactions, data.assets, data.watchlist, data.portfolios, data.assetsById, data.priceStatus?.updatedAt],
  );
  return (
    <section className="dpanel" aria-labelledby="act-h">
      <div className="dpanel-head"><h2 id="act-h" className="eyebrow">Recent activity</h2></div>
      {items.length === 0 ? (
        <p className="panel-empty">No activity yet.</p>
      ) : (
        <ul className="rows activity">
          {items.map((it) => {
            const Icon = ICONS[it.kind];
            return (
              <li key={it.id}>
                <span className="act-icon" aria-hidden="true"><Icon size={14} strokeWidth={1.7} /></span>
                <div><strong>{it.title}</strong><small>{it.detail}</small></div>
                <div className="right">
                  {it.amount && <strong className="num">{formatMoney(it.amount.value, it.amount.currency)}</strong>}
                  <small>{formatRelativeTime(new Date(it.at).toISOString())}</small>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
