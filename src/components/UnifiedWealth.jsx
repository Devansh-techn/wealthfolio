import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useAuth } from '../contexts/AuthContext';
import './UnifiedWealth.css';

const CLASSES = [
  ['Stocks', 'dot-emerald'], ['ETFs', 'dot-blue'], ['Mutual Funds', 'dot-gold'], ['Crypto', 'dot-blue'],
  ['Gold', 'dot-gold'], ['Real Estate', 'dot-emerald'], ['Cash', 'dot-blue'], ['Bonds', 'dot-gold'],
];

const UnifiedWealth = () => {
  const sectionRef = useRef(null);
  const { user } = useAuth();

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.dashboard-card', { y: 80, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.8, ease: 'power3.out',
        scrollTrigger: { trigger: sectionRef.current, start: '15% 85%', toggleActions: 'play reverse play reverse' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section container dashboard-section" aria-labelledby="uw-h">
      <div className="dashboard-content">
        <h2 id="uw-h" className="heading-lg text-gradient mb-6 text-center">Unified Wealth Engine</h2>
        <div className="dashboard-card glass-panel hover-lift">
          <div className="dashboard-header">
            <div>
              <p className="text-body text-sm">Your net worth, calculated from your own data</p>
              <h3 className="heading-md">Assets minus liabilities, in your currency</h3>
              <span className="badge-neutral">Illustration — no real figures shown</span>
            </div>
          </div>
          <div className="dashboard-chart-container" aria-hidden="true">
            <svg viewBox="0 0 500 150" className="chart-svg" preserveAspectRatio="none">
              <defs>
                <linearGradient id="uwGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent-gold)" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="var(--color-accent-gold)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 150 L0 100 Q 50 120, 100 80 T 200 60 T 300 40 T 400 50 T 500 10 L500 150 Z" fill="url(#uwGradient)" opacity="0.3" />
              <path d="M0 100 Q 50 120, 100 80 T 200 60 T 300 40 T 400 50 T 500 10" fill="none" stroke="var(--color-accent-gold)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <ul className="uw-chips" aria-label="Supported asset classes">
            {CLASSES.map(([label, dot]) => (
              <li key={label}><span className={`asset-dot ${dot}`} />{label}</li>
            ))}
          </ul>
          <div className="uw-cta">
            <Link to={user ? '/dashboard' : '/signup'} className="btn-primary hero-btn">{user ? 'Open your dashboard' : 'Build your portfolio'}</Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default UnifiedWealth;
