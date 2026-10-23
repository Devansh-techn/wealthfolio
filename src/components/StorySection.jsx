import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './StorySection.css';

const StorySection = () => {
  const containerRef = useRef(null);
  useEffect(() => {
    const ctx = gsap.context(() => {
      const [t1, t2, t3] = gsap.utils.toArray('.story-text');
      const tl = gsap.timeline({ scrollTrigger: { trigger: containerRef.current, start: 'top top', end: '+=2000', scrub: 1, pin: true } });
      tl.fromTo(t1, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 1 })
        .to(t1, { opacity: 0, y: -50, duration: 1 }, '+=1')
        .fromTo(t2, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 1 })
        .to(t2, { opacity: 0, y: -50, duration: 1 }, '+=1')
        .fromTo(t3, { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 1 })
        .to(t3, { opacity: 0, y: -50, duration: 1 }, '+=1');
    }, containerRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={containerRef} className="story-section" aria-label="Our philosophy">
      <div className="story-background"></div>
      <div className="story-content">
        <h2 className="story-text heading-lg">Wealth isn't just numbers.</h2>
        <h2 className="story-text heading-lg">It's clarity. Control. Confidence.</h2>
        <h2 className="story-text heading-lg">Welcome to the future of finance.</h2>
      </div>
    </section>
  );
};

export default StorySection;
