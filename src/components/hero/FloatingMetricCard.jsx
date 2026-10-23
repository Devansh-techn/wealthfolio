/** Positioned glass card. Three layers on purpose: position+parallax → idle float → entrance, so transforms never fight. */
export default function FloatingMetricCard({ className = '', label, depth = 18, delay = 0, floatDelay = 0, children }) {
  return (
    <div className={`fc-pos ${className}`} style={{ '--depth': depth }}>
      <div className="fc-float" style={{ animationDelay: `${floatDelay}s` }}>
        <article className="fc glass-panel" style={{ animationDelay: `${delay}s` }}>
          {label && <h3 className="fc-label">{label}</h3>}
          {children}
        </article>
      </div>
    </div>
  );
}
