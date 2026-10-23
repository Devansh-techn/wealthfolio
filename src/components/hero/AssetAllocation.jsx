import { useState } from 'react';
import { ALLOCATION } from './heroData';

const GAP = 1.2; // visual gap between donut segments (in percent of circumference)

/** Donut ring + legend. Segments are computed from ALLOCATION so ring and legend can never disagree. */
export default function AssetAllocation({ size = 84 }) {
  const [hot, setHot] = useState(null);
  // Cumulative start offset of each segment (pure derivation, no mutation during render).
  const starts = ALLOCATION.map((_, i) => ALLOCATION.slice(0, i).reduce((sum, x) => sum + x.pct, 0));
  return (
    <div className="aa">
      <div className="aa-ring" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label="Asset allocation: stocks 35 percent, real estate 25, funds 18, gold 10, crypto 7, cash 5">
          <circle cx="18" cy="18" r="15.9155" className="aa-track" />
          {ALLOCATION.map((a, i) => (
              <circle
                key={a.key}
                cx="18"
                cy="18"
                r="15.9155"
                className={`aa-seg${hot === a.key ? ' is-hot' : ''}${hot && hot !== a.key ? ' is-dim' : ''}`}
                stroke={a.color}
                strokeDasharray={`${a.pct - GAP} ${100 - a.pct + GAP}`}
                strokeDashoffset={25 - starts[i]}
                style={{ animationDelay: `${0.9 + i * 0.09}s` }}
              />
          ))}
        </svg>
        <div className="aa-center" aria-hidden="true">
          <strong>{ALLOCATION.length}</strong>
          <span>classes</span>
        </div>
      </div>
      <ul className="aa-legend">
        {ALLOCATION.map((a) => (
          <li key={a.key} onPointerEnter={() => setHot(a.key)} onPointerLeave={() => setHot(null)}>
            <i style={{ background: a.color }} />
            <span>{a.label}</span>
            <b>{a.pct}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
