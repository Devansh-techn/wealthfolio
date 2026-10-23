import FloatingMetricCard from './FloatingMetricCard';
import { ALLOCATION, DIVERSIFICATION_SCORE } from './heroData';

export default function DiversificationRing(props) {
  return (
    <FloatingMetricCard {...props} label="Diversification">
      <div className="dr">
        <div className="dr-ring">
          <svg viewBox="0 0 36 36" width="78" height="78" role="img" aria-label={`Diversification score ${DIVERSIFICATION_SCORE} out of 100`}>
            <defs>
              <linearGradient id="hero-dr-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#6ee7b7" />
                <stop offset="100%" stopColor="#d9ae5a" />
              </linearGradient>
            </defs>
            <circle cx="18" cy="18" r="15.9155" className="aa-track" />
            <circle cx="18" cy="18" r="15.9155" className="dr-prog" stroke="url(#hero-dr-grad)" strokeDasharray={`${DIVERSIFICATION_SCORE} ${100 - DIVERSIFICATION_SCORE}`} strokeDashoffset="25" />
          </svg>
          <div className="dr-center" aria-hidden="true"><strong>{DIVERSIFICATION_SCORE}</strong></div>
        </div>
        <div className="dr-copy">
          <span className="dr-title">Score out of 100</span>
          <span className="dr-sub">Across {ALLOCATION.length} asset classes</span>
        </div>
      </div>
    </FloatingMetricCard>
  );
}
