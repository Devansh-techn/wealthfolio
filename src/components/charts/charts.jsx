import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE } from './palette';

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const niceTicks = (min, max, n = 4) => {
  if (min === max) return [min];
  const step = (max - min) / n;
  return Array.from({ length: n + 1 }, (_, i) => min + step * i);
};

/**
 * series: [{ name, color, points: [{ x: 'label', y: number }], dashed?, area? }]
 * All series must share the same x labels (same length).
 */
export function LineChart({ series, height = 260, formatY = (v) => v.toFixed(0), formatX = (v) => v, ariaLabel = 'Chart' }) {
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 56, r: 12, t: 12, b: 26 };
  const n = series[0]?.points.length ?? 0;

  const { min, max } = useMemo(() => {
    const vals = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => Number.isFinite(v));
    if (!vals.length) return { min: 0, max: 1 };
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const m = (hi - lo) * 0.08;
    return { min: lo - m, max: hi + m };
  }, [series]);

  if (!n) return <div ref={wrapRef} className="chart-empty">No data to chart</div>;
  const iw = Math.max(width - pad.l - pad.r, 10);
  const ih = height - pad.t - pad.b;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const ticks = niceTicks(min, max, 4);
  const path = (s) => s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    setHover(Math.max(0, Math.min(n - 1, Math.round((px / iw) * (n - 1)))));
  };
  const labelIdx = n <= 3 ? [...Array(n).keys()] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div ref={wrapRef} className="chart-wrap" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={i} id={`lg-${ariaLabel.replace(/\W/g, '')}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.35" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="chart-grid" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">
                {formatY(t)}
              </text>
            </g>
          ))}
          {labelIdx.map((i) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="chart-axis">
              {formatX(series[0].points[i].x)}
            </text>
          ))}
          {series.map((s, i) =>
            s.area ? (
              <path key={`a${i}`} d={`${path(s)} L${x(n - 1)} ${y(min)} L${x(0)} ${y(min)} Z`} fill={`url(#lg-${ariaLabel.replace(/\W/g, '')}-${i})`} />
            ) : null,
          )}
          {series.map((s, i) => (
            <path key={`l${i}`} d={path(s)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 5' : undefined} pathLength={s.dashed ? undefined : 1} className={s.dashed ? undefined : 'chart-line-draw'} />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="chart-cursor" />
              {series.map((s, i) => (
                <circle key={i} cx={x(hover)} cy={y(s.points[hover].y)} r="4" fill={s.color} stroke="var(--color-bg-deep)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tip glass-panel" style={{ left: Math.min(Math.max(x(hover), 70), width - 70) }}>
          <strong>{formatX(series[0].points[hover].x)}</strong>
          {series.map((s) => (
            <div key={s.name}>
              <span className="chart-dot" style={{ background: s.color }} />
              {s.name}: {formatY(s.points[hover].y, true)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DonutChart({ data, formatValue = (v) => v.toFixed(0), centerLabel, centerValue, size = 190, ariaLabel = 'Allocation chart', legend = true, thickness = 18 }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={thickness} />
        {total > 0 &&
          data.map((d, i) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color ?? PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                className="donut-seg"
                strokeDasharray={`${Math.max(len - 1.5, 0)} ${c - Math.max(len - 1.5, 0)}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
        {(centerLabel || centerValue) && (
          <g textAnchor="middle">
            <text x={size / 2} y={size / 2 - 2} className="donut-value">
              {centerValue}
            </text>
            <text x={size / 2} y={size / 2 + 16} className="chart-axis">
              {centerLabel}
            </text>
          </g>
        )}
      </svg>
      {legend && <ul className="legend">
        {data.map((d, i) => (
          <li key={d.label}>
            <span className="chart-dot" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
            <span className="legend-label">{d.label}</span>
            <span className="legend-val">
              {formatValue(d.value)} <em>{total > 0 ? ((d.value / total) * 100).toFixed(1) : '0.0'}%</em>
            </span>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/** Horizontal bars. data: [{ label, value, display, color? }], value is relative to max. */
export function BarList({ data, max, ariaLabel = 'Bar chart' }) {
  const m = max ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="barlist" aria-label={ariaLabel}>
      {data.map((d, i) => (
        <li key={d.label}>
          <div className="barlist-top">
            <span>{d.label}</span>
            <span>{d.display}</span>
          </div>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${Math.max(0, Math.min(100, (d.value / m) * 100))}%`, background: d.color ?? PALETTE[i % PALETTE.length] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
