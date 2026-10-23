import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { Activity, CandlestickChart, Layers, ShieldCheck } from 'lucide-react';
import { PILLAR_WEIGHTS } from '../lib/scoring';
import './AIScreener.css';

const PILLARS = [
  { key: 'fundamental', title: 'Fundamental', icon: Layers, cls: 'bg-blue', inputs: 'P/E, earnings & revenue growth, ROE, ROCE, debt/equity, dividend yield' },
  { key: 'technical', title: 'Technical', icon: CandlestickChart, cls: 'bg-purple', inputs: 'RSI, 50/200-day moving averages, golden-cross state' },
  { key: 'momentum', title: 'Momentum', icon: Activity, cls: 'bg-gold', inputs: '1, 3, 6 and 12-month returns, 52-week range position' },
  { key: 'risk', title: 'Risk', icon: ShieldCheck, cls: 'bg-emerald', inputs: 'Volatility, 1-year max drawdown, leverage (higher score = lower risk)' },
];

const AIScreener = () => {
  const sectionRef = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.insight-card', { y: 50, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power2.out',
        scrollTrigger: { trigger: sectionRef.current, start: '15% 85%', toggleActions: 'play reverse play reverse' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section container screener-section" aria-labelledby="sc-h">
      <div className="section-header text-center mb-12">
        <h2 id="sc-h" className="heading-lg mb-4 text-gradient">Transparent AI-Assisted Screener</h2>
        <p className="text-body max-w-2xl mx-auto">
          Every score is built from real market data using open, rule-based formulas. AI only explains the numbers — it never invents them.
        </p>
      </div>
      <div className="insights-grid">
        {PILLARS.map((p) => (
          <div key={p.key} className="insight-card glass-panel hover-lift">
            <div className="insight-card-header">
              <div className={`icon-wrapper-sm ${p.cls}`}><p.icon size={24} color="#fff" aria-hidden="true" /></div>
              <h3 className="heading-md">{p.title} score</h3>
            </div>
            <div className="insight-metrics">
              <div className="metric-box">
                <p className="metric-label">Based on</p>
                <p className="metric-inputs">{p.inputs}</p>
              </div>
              <div className="metric-box align-right">
                <p className="metric-label">Weight</p>
                <p className="metric-value text-gradient-gold">{PILLAR_WEIGHTS[p.key]}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="screener-note text-body">
        Scores are informational and do not predict returns. <Link to="/disclaimer">Read the disclaimer</Link>.
      </p>
    </section>
  );
};

export default AIScreener;
