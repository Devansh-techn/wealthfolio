import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { useAuth } from '../contexts/AuthContext';
import './CTA.css';

const CTA = () => {
  const containerRef = useRef(null);
  const { user } = useAuth();
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(containerRef.current, { scale: 0.9, opacity: 0 }, {
        scale: 1, opacity: 1, duration: 1, ease: 'power3.out',
        scrollTrigger: { trigger: containerRef.current, start: 'top 80%' },
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section className="section container cta-section" aria-labelledby="cta-h">
      <div ref={containerRef} className="cta-box glass-panel glow-effect">
        <h2 id="cta-h" className="heading-lg text-center mb-6">Take Control of Your Wealth</h2>
        <p className="text-body text-center mb-8 max-w-2xl mx-auto">Create a free account and add your first asset in under a minute. Your data stays private to you.</p>
        <div className="cta-actions text-center">
          <Link to={user ? '/dashboard' : '/signup'} className="btn-primary cta-btn cta-link">{user ? 'Go to your dashboard' : 'Start your financial journey'}</Link>
        </div>
      </div>
    </section>
  );
};

export default CTA;
