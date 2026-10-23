import { Sparkles } from 'lucide-react';
import FloatingMetricCard from './FloatingMetricCard';

export default function AIInsightCard(props) {
  return (
    <FloatingMetricCard {...props}>
      <div className="hero-ai-head">
        <span className="hero-ai-badge"><Sparkles size={13} aria-hidden="true" /> AI</span>
        <h3 className="fc-label fc-label--inline">Wealth insight</h3>
      </div>
      <p className="hero-ai-text">Your portfolio diversification improved this month.</p>
      <div className="hero-ai-foot"><i /> Example insight</div>
    </FloatingMetricCard>
  );
}
