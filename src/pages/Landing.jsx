import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from '../components/Navbar';
import Hero from '../components/Hero';
import TrackWealth from '../components/TrackWealth';
import UnifiedWealth from '../components/UnifiedWealth';
import AssetIntelligence from '../components/AssetIntelligence';
import AIScreener from '../components/AIScreener';
import Analytics from '../components/Analytics';
import StorySection from '../components/StorySection';
import CTA from '../components/CTA';
import Footer from '../components/Footer';

// The landing sections below use ScrollTrigger; register it once here (the hero no longer does).
gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
  useEffect(() => {
    const t = setTimeout(() => ScrollTrigger.refresh(), 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="app-container landing">
      <Navbar />
      <main id="main">
        <Hero />
        <TrackWealth />
        <UnifiedWealth />
        <AssetIntelligence />
        <AIScreener />
        <Analytics />
        <StorySection />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
