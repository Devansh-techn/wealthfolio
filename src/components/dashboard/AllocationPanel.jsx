import { Plus } from 'lucide-react';
import { useCurrency } from '../../contexts/CurrencyContext';
import { DonutChart } from '../charts/charts';
import { groupAllocation } from '../../lib/dashboardData';
import { formatMoney } from '../../lib/format';

export default function AllocationPanel({ allocation, onAdd }) {
  const { currency } = useCurrency();
  const { total, rows } = groupAllocation(allocation);
  const data = rows.filter((r) => r.value > 0);
  return (
    <section className="dpanel alloc" aria-labelledby="alloc-h">
      <div className="dpanel-head"><h2 id="alloc-h" className="eyebrow">Asset allocation</h2></div>
      <div className="alloc-body">
        <DonutChart legend={false} thickness={14} size={176} ariaLabel="Asset allocation" data={data} formatValue={(v) => formatMoney(v, currency, { compact: true })} centerValue={total > 0 ? formatMoney(total, currency, { compact: true }) : '—'} centerLabel={total > 0 ? 'Total' : 'No assets'} />
        <ul className="alloc-legend">
          {rows.map((r) => (
            <li key={r.label} className={r.value > 0 ? '' : 'zero'}>
              <i style={{ background: r.color }} aria-hidden="true" />
              <span>{r.label}</span>
              <em className="num">{r.pct.toFixed(1)}%</em>
              <strong className="num">{r.value > 0 ? formatMoney(r.value, currency, { compact: true }) : '—'}</strong>
            </li>
          ))}
        </ul>
      </div>
      {total === 0 && (
        <div className="alloc-empty">
          <p className="chart-empty-title">No assets yet</p>
          <button type="button" className="link-sm" onClick={onAdd}><Plus size={14} aria-hidden="true" /> Add assets to visualize allocation</button>
        </div>
      )}
    </section>
  );
}
