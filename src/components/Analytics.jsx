import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './Analytics.css';

const BARS = [30, 45, 60, 80, 100];
const STATS = [
  { label: 'Volatility', value: 'Annualized', desc: 'Standard deviation of your portfolio’s daily returns.' },
  { label: 'Sharpe ratio', value: 'Risk-adjusted', desc: 'Return per unit of risk, using a risk-free rate you choose.' },
  { label: 'Max drawdown', value: 'Peak-to-trough', desc: 'The largest fall from a high, from your actual history.' },
];

const Analytics = () => {
  const sectionRef = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: sectionRef.current, start: '15% 85%', toggleActions: 'play reverse play reverse' } });
      tl.fromTo('.bar-chart', { width: '0%' }, { width: '100%', duration: 1.2, ease: 'power3.inOut' })
        .fromTo('.stat-card', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.15, ease: 'power2.out' }, '-=0.6');
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section container analytics-section" aria-labelledby="an-h">
      <div className="analytics-header">
        <h2 id="an-h" className="heading-lg mb-2 text-gradient">Deep Analytics</h2>
        <p className="text-body max-w-2xl">Return, CAGR, volatility, Sharpe ratio, drawdown, allocation and concentration — all calculated from your own transactions and real historical prices.</p>
      </div>
      <div className="analytics-grid mt-12">
        <div className="analytics-chart-container glass-panel">
          <div className="chart-header">
            <h3>Your performance, charted from your data</h3>
            <p className="text-body chart-caption">Decorative illustration — charts in the app use your own portfolio.</p>
          </div>
          <div className="bar-chart-wrap" aria-hidden="true">
            <div className="bar-chart">
              {BARS.map((h) => <div key={h} className="bar" style={{ height: `${h}%` }}></div>)}
            </div>
          </div>
        </div>
        <div className="analytics-stats">
          {STATS.map((s) => (
            <div key={s.label} className="stat-card glass-panel hover-lift">
              <div className="stat-label">{s.label}</div>
              <div className="stat-value text-gradient-gold stat-value-sm">{s.value}</div>
              <div className="stat-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Analytics;
