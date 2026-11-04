import { ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import './ScreenerComingSoon.css';

function IntelligenceIllustration() {
  return (
    <div className="screener-coming-art" aria-hidden="true">
      <div className="screener-coming-orbit screener-coming-orbit-outer" />
      <div className="screener-coming-orbit screener-coming-orbit-inner" />
      <svg className="screener-coming-network" viewBox="0 0 440 360" fill="none">
        <path className="screener-network-line" d="M66 242 142 184 218 222 293 139 372 176" />
        <path className="screener-network-line screener-network-line-soft" d="m105 104 76 48 89-58 66 44" />
        <path className="screener-network-line screener-network-line-soft" d="m142 184 39-32 37 70 52-128 23 45 68 37" />
        <circle className="screener-network-node" cx="66" cy="242" r="5" />
        <circle className="screener-network-node" cx="105" cy="104" r="4" />
        <circle className="screener-network-node screener-network-node-bright" cx="142" cy="184" r="7" />
        <circle className="screener-network-node" cx="181" cy="152" r="4" />
        <circle className="screener-network-node screener-network-node-bright" cx="218" cy="222" r="6" />
        <circle className="screener-network-node" cx="270" cy="94" r="5" />
        <circle className="screener-network-node screener-network-node-bright" cx="293" cy="139" r="7" />
        <circle className="screener-network-node" cx="336" cy="138" r="4" />
        <circle className="screener-network-node" cx="372" cy="176" r="5" />
      </svg>
      <div className="screener-coming-core">
        <Sparkles size={31} strokeWidth={1.35} />
      </div>
      <span className="screener-art-caption">Ideas, connected</span>
    </div>
  );
}

export default function ScreenerComingSoon() {
  return (
    <section className="screener-coming-page" aria-labelledby="screener-coming-title">
      <div className="screener-coming-card glass-panel">
        <div className="screener-coming-copy">
          <div className="screener-coming-label"><Sparkles size={13} aria-hidden="true" /> Coming soon</div>
          <h1 id="screener-coming-title">Something Intelligent Is Coming.</h1>
          <p>We're building a smarter way to discover, analyse and understand investment opportunities across the Indian market.</p>
          <Link className="screener-coming-link" to="/portfolio">
            Explore your portfolio <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <IntelligenceIllustration />
      </div>
    </section>
  );
}
