import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { LayoutDashboard, Target, PiggyBank, Calculator, BrainCircuit } from 'lucide-react';
import './TrackWealth.css';

const features = [
  { icon: LayoutDashboard, title: 'All-in-One Dashboard', desc: 'Stocks, ETFs, mutual funds, crypto, gold, property and cash in one view.', colorClass: 'bg-purple' },
  { icon: Target, title: 'Goal-Based Planning', desc: 'Plan for a house, car, education or retirement with transparent projections.', colorClass: 'bg-blue' },
  { icon: PiggyBank, title: 'Budgets & Cash Flow', desc: 'Log income and expenses, set monthly budgets, and see your savings rate.', colorClass: 'bg-emerald' },
  { icon: Calculator, title: 'EMI & Loan Planner', desc: 'Full amortization schedules and prepayment simulation for any loan.', colorClass: 'bg-gold' },
  { icon: BrainCircuit, title: 'Transparent Screener', desc: 'Rank stocks with open, rule-based scores you can inspect — no black box.', colorClass: 'bg-purple' },
];

const TrackWealth = () => {
  const sectionRef = useRef(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo('.track-card', { y: 50, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: 'power2.out',
        scrollTrigger: { trigger: sectionRef.current, start: '15% 85%', toggleActions: 'play reverse play reverse' },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="section container track-wealth-section" aria-labelledby="track-h">
      <div className="section-header text-center mb-12">
        <h2 id="track-h" className="heading-lg mb-4 text-gradient">Track Your Wealth</h2>
        <p className="text-body max-w-2xl mx-auto">See everything you own, plan your future, and make clearer financial decisions — all in one place.</p>
      </div>
      <div className="track-features-grid">
        {features.map((f) => (
          <div key={f.title} className="track-card glass-panel hover-lift">
            <div className={`icon-wrapper-lg ${f.colorClass}`}><f.icon size={28} color="#fff" aria-hidden="true" /></div>
            <h3 className="heading-md mt-6 mb-2">{f.title}</h3>
            <p className="text-body text-sm">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
};

export default TrackWealth;
