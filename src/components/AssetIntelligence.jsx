import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { Home, TrendingUp, Cpu } from 'lucide-react';
import './AssetIntelligence.css';

const CARDS = [
  { icon: TrendingUp, cls: 'bg-blue', title: 'Equities & ETFs', text: 'Prices from a market-data provider, with INR, USD, EUR and GBP support and NSE/BSE symbols where the provider covers them. Data may be delayed.', tag: 'Stocks · ETFs · Funds' },
  { icon: Home, cls: 'bg-gold', title: 'Real Estate & Gold', text: 'Record property and physical assets at a value you control, and track gold through ETFs or manual valuation.', tag: 'Manual valuation' },
  { icon: Cpu, cls: 'bg-emerald', title: 'Crypto & Alternatives', text: 'Track crypto and other assets in their native currency; conversion to your display currency uses live exchange rates.', tag: 'Crypto · Bonds · Other' },
];

const AssetIntelligence = () => {
  const sectionRef = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.asset-card', { y: 50, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.8, stagger: 0.2, ease: 'power2.out',
        scrollTrigger: { trigger: sectionRef.current, start: '15% 85%', toggleActions: 'play reverse play reverse' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section container asset-intelligence" aria-labelledby="ai-h">
      <div className="section-header text-center">
        <h2 id="ai-h" className="heading-lg mb-2 text-gradient">Asset Intelligence</h2>
        <p className="text-body max-w-2xl mx-auto">Track more than just cash. Bring your entire portfolio into focus with live valuation and clear analytics.</p>
      </div>
      <div className="assets-grid mt-12">
        {CARDS.map((c) => (
          <div key={c.title} className="asset-card glass-panel hover-lift">
            <div className={`icon-wrapper ${c.cls}`}><c.icon size={24} color="#fff" aria-hidden="true" /></div>
            <h3 className="heading-md mt-4 mb-2">{c.title}</h3>
            <p className="text-body text-sm mb-6">{c.text}</p>
            <div className="asset-value asset-value-sm">{c.tag}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default AssetIntelligence;
