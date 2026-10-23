import { smoothPath } from './chartMath';

/** Tiny decorative-but-honest trend line (values come from heroData). */
export default function Sparkline({ values, color = '#34d399', width = 200, height = 40, delay = 0 }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const pts = values.map((v, i) => [pad + (i * (width - pad * 2)) / (values.length - 1), pad + (1 - (v - min) / (max - min || 1)) * (height - pad * 2)]);
  const d = smoothPath(pts);
  return (
    <svg className="hero-spark" viewBox={`0 0 ${width} ${height}`} width="100%" aria-hidden="true" focusable="false">
      <path d={d} pathLength="1" className="hero-spark-line" style={{ stroke: color, animationDelay: `${delay}s` }} />
    </svg>
  );
}
