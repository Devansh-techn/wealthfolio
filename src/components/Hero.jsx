import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Bitcoin, Building2, Coins, LayoutGrid, TrendingUp, Wallet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import WealthDashboard from './hero/WealthDashboard';
import FloatingMetricCard from './hero/FloatingMetricCard';
import AssetAllocation from './hero/AssetAllocation';
import AIInsightCard from './hero/AIInsightCard';
import DiversificationRing from './hero/DiversificationRing';
import AssetCard from './hero/AssetCard';
import Sparkline from './hero/Sparkline';
import { ALLOCATION, NET_WORTH, NET_WORTH_GROWTH_PCT, NET_WORTH_SERIES, PORTFOLIO_GROWTH_PCT, PORTFOLIO_SERIES, amountLakh, fmtLakh } from './hero/heroData';
import './Hero.css';

const ASSET_ICONS = { stocks: TrendingUp, funds: LayoutGrid, crypto: Bitcoin, gold: Coins, realestate: Building2, cash: Wallet };
// Order of the ecosystem row (all six come from ALLOCATION so amounts/percentages stay consistent).
const ASSET_ORDER = ['stocks', 'funds', 'crypto', 'gold', 'realestate', 'cash'];

const Hero = () => {
  const sectionRef = useRef(null);
  const { user } = useAuth();

  // Subtle pointer parallax + light movement. Skipped for reduced-motion and touch devices.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !window.matchMedia) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('(pointer: coarse)').matches) return undefined;
    let raf = 0;
    const set = (px, py, lx, ly) => {
      el.style.setProperty('--px', px.toFixed(3));
      el.style.setProperty('--py', py.toFixed(3));
      el.style.setProperty('--lx', `${lx.toFixed(1)}%`);
      el.style.setProperty('--ly', `${ly.toFixed(1)}%`);
    };
    const onMove = (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width;
        const ny = (e.clientY - r.top) / r.height;
        set((nx - 0.5) * 2, (ny - 0.5) * 2, nx * 100, ny * 100);
      });
    };
    const onLeave = () => set(0, 0, 50, 30);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const assets = ASSET_ORDER.map((k) => ALLOCATION.find((a) => a.key === k));

  return (
    <section ref={sectionRef} className="hero-section" aria-label="Introduction">
      <div className="hero-env" aria-hidden="true">
        <div className="hero-env-glow hero-env-glow--gold" />
        <div className="hero-env-glow hero-env-glow--emerald" />
        <div className="hero-env-glow hero-env-glow--navy" />
        <div className="hero-env-grid" />
        <div className="hero-env-vignette" />
      </div>

      <div className="hero-inner">
        <div className="hero-backplate" aria-hidden="true">
          <svg viewBox="0 0 1000 300" preserveAspectRatio="none">
            <path d="M0,260 C120,250 160,225 260,215 C360,205 400,190 500,160 C600,130 660,135 760,95 C850,60 920,50 1000,20" />
          </svg>
        </div>

        <div className="hero-text">
          <p className="hero-eyebrow">Private wealth intelligence</p>
          <h1 className="hero-title">
            <span>Track.</span> <span>Analyze.</span> <span>Grow.</span>
          </h1>
          <p className="hero-sub">One intelligent platform for your entire wealth.</p>
          <p className="hero-tag">Stocks, funds, crypto, gold, property and cash — together in one private place.</p>
          {user && (
            <div className="hero-cta">
              <Link to="/dashboard" className="btn-primary hero-btn hero-btn--emerald">Open dashboard</Link>
            </div>
          )}
        </div>

        <div className="hero-stage">
          <div className="hero-dash-pos">
            <div className="hero-dash-float">
              <WealthDashboard />
            </div>
          </div>

          <FloatingMetricCard className="fc--networth" label="Net worth" depth={22} delay={0.55} floatDelay={0}>
            <div className="fc-value">{fmtLakh(NET_WORTH)}</div>
            <div className="fc-delta">+{NET_WORTH_GROWTH_PCT.toFixed(1)}% <span>last 12 months</span></div>
            <Sparkline values={NET_WORTH_SERIES} delay={0.9} />
          </FloatingMetricCard>

          <FloatingMetricCard className="fc--alloc" label="Asset allocation" depth={14} delay={0.7} floatDelay={-2}>
            <AssetAllocation />
          </FloatingMetricCard>

          <AIInsightCard className="fc--insight" depth={26} delay={0.85} floatDelay={-1} />

          <DiversificationRing className="fc--div" depth={16} delay={1} floatDelay={-3} />

          <FloatingMetricCard className="fc--growth" label="Portfolio growth" depth={24} delay={1.15} floatDelay={-4}>
            <div className="fc-value fc-value--pos">+{PORTFOLIO_GROWTH_PCT.toFixed(2)}%</div>
            <div className="fc-delta fc-delta--muted">12-month return</div>
            <Sparkline values={PORTFOLIO_SERIES} delay={1.2} />
          </FloatingMetricCard>
        </div>

        <ul className="hero-assets" aria-label="Asset classes you can track">
          {assets.map((a, i) => (
            <AssetCard key={a.key} icon={ASSET_ICONS[a.key]} label={a.label} amount={fmtLakh(amountLakh(a.pct), 2)} pct={a.pct} color={a.color} delay={1.0 + i * 0.07} />
          ))}
        </ul>
        <p className="hero-disclaimer">Illustrative demo data. Not investment advice or a guarantee of returns.</p>
      </div>
    </section>
  );
};

export default Hero;
