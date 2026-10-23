export default function AssetCard({ icon: Icon, label, amount, pct, color, delay = 0 }) {
  return (
    <li className="ac glass-panel" style={{ '--ac': color, animationDelay: `${delay}s` }}>
      <span className="ac-icon"><Icon size={20} strokeWidth={1.6} aria-hidden="true" /></span>
      <span className="ac-text">
        <span className="ac-name">{label}</span>
        <span className="ac-meta">
          <span className="ac-amount">{amount}</span>
          <span className="ac-pct">{pct}%</span>
        </span>
      </span>
    </li>
  );
}
