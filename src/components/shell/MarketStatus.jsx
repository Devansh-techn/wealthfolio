import { useEffect, useState } from 'react';
import { marketStatuses } from '../../lib/marketHours';

/** Regular-hours indicator for NSE and US markets (holidays are not modelled; the tooltip says so). */
export default function MarketStatus() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <ul className="mkt-status" aria-label="Market status" title="Based on regular trading hours. Exchange holidays and special sessions are not included.">
      {marketStatuses(now).map((m) => (
        <li key={m.id} className={m.open ? 'open' : ''}>
          <i aria-hidden="true" />
          <span>{m.label}</span>
          <em>{m.open ? 'Open' : 'Closed'}</em>
        </li>
      ))}
    </ul>
  );
}
