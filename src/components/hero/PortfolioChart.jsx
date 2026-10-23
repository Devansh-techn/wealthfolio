import { useId, useState } from 'react';
import { MONTHS, PORTFOLIO_SERIES, fmtLakh } from './heroData';
import { smoothPath } from './chartMath';
import { useMediaQuery } from './useHeroMedia';

const DOMAIN = { min: 14, max: 18 }; // ₹ lakh, comfortably wraps the series (14.7 → 17.4)
const TICKS = [14, 15, 16, 17, 18];

/** Real SVG portfolio-value chart. Every label is generated from heroData. */
export default function PortfolioChart() {
  const uid = useId().replace(/:/g, '');
  const narrow = useMediaQuery('(max-width: 760px)');
  const W = narrow ? 360 : 720;
  const H = narrow ? 250 : 300;
  const pad = { l: narrow ? 38 : 46, r: 14, t: 14, b: 30 };
  const step = narrow ? 3 : 1; // label every 3rd month on phones so nothing collides
  const lastIdx = PORTFOLIO_SERIES.length - 1;
  const labelIdx = MONTHS.map((_, i) => i).filter((i) => i % step === 0 || i === lastIdx);
  const [hover, setHover] = useState(null);
  const active = hover ?? lastIdx;

  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / lastIdx;
  const y = (v) => pad.t + (1 - (v - DOMAIN.min) / (DOMAIN.max - DOMAIN.min)) * (H - pad.t - pad.b);
  const pts = PORTFOLIO_SERIES.map((v, i) => [x(i), y(v)]);
  const line = smoothPath(pts);
  const area = `${line} L${x(lastIdx)},${H - pad.b} L${x(0)},${H - pad.b} Z`;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i <= lastIdx; i++) if (Math.abs(x(i) - vx) < Math.abs(x(best) - vx)) best = i;
    setHover(best);
  };

  const first = PORTFOLIO_SERIES[0];
  const label = `Illustrative portfolio value rising from ${fmtLakh(first)} to ${fmtLakh(PORTFOLIO_SERIES[lastIdx])} over twelve months`;
  const tipLeft = Math.min(Math.max((x(active) / W) * 100, 12), 88);
  // Points near the top of the plot get their tooltip below them so it never collides with the header.
  const tipBelow = y(PORTFOLIO_SERIES[active]) / H < 0.32;

  return (
    <div className="pc" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg className="pc-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.34" />
            <stop offset="70%" stopColor="#34d399" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${uid}-stroke`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#6ee7b7" />
            <stop offset="100%" stopColor="#34d399" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-10%" y="-30%" width="120%" height="160%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {TICKS.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="pc-grid" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="pc-axis">{`₹${t}L`}</text>
          </g>
        ))}
        {labelIdx.map((i) => (
          <text key={MONTHS[i]} x={x(i)} y={H - 9} textAnchor="middle" className="pc-axis">{MONTHS[i]}</text>
        ))}

        <path d={area} fill={`url(#${uid}-fill)`} className="pc-area" />
        <path d={line} pathLength="1" className="pc-line pc-line--glow" stroke="#34d399" filter={`url(#${uid}-glow)`} />
        <path d={line} pathLength="1" className="pc-line" stroke={`url(#${uid}-stroke)`} />

        <line x1={x(active)} x2={x(active)} y1={pad.t} y2={H - pad.b} className="pc-guide" />
        <circle cx={x(active)} cy={y(PORTFOLIO_SERIES[active])} r="11" className={`pc-halo${hover === null ? ' pc-halo--pulse' : ''}`} />
        <circle cx={x(active)} cy={y(PORTFOLIO_SERIES[active])} r="4.5" className="pc-dot" />
      </svg>
      <div className={`pc-tip${tipBelow ? ' pc-tip--below' : ''}`} style={{ left: `${tipLeft}%`, top: `${(y(PORTFOLIO_SERIES[active]) / H) * 100}%` }} aria-hidden="true">
        <span>{MONTHS[active]}</span>
        <strong>{fmtLakh(PORTFOLIO_SERIES[active])}</strong>
      </div>
    </div>
  );
}
