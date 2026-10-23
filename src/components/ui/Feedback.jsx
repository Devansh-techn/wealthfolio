import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';

export function Spinner({ label = 'Loading…', size = 20 }) {
  return (
    <span className="spinner" role="status">
      <Loader2 size={size} className="spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <Loader2 size={32} className="spin" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function Skeleton({ height = 20, width = '100%', className = '' }) {
  return <div className={`skeleton ${className}`} style={{ height, width }} aria-hidden="true" />;
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="empty-state glass-panel">
      <div className="empty-icon" aria-hidden="true">
        <Icon size={30} />
      </div>
      <h3 className="heading-md">{title}</h3>
      {text && <p className="text-body">{text}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <div className="error-state glass-panel" role="alert">
      <AlertTriangle size={26} aria-hidden="true" />
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden="true" /> Retry
        </button>
      )}
    </div>
  );
}

export function InlineNotice({ tone = 'warn', children, action }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <AlertTriangle size={16} aria-hidden="true" />
      <div>{children}</div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub, tone, icon: Icon, hint }) {
  return (
    <div className="stat glass-panel">
      <div className="stat-top">
        <span className="stat-title">{label}</span>
        {Icon && <Icon size={16} aria-hidden="true" />}
      </div>
      <div className={`stat-figure ${tone ?? ''}`}>{value}</div>
      {sub && <div className={`stat-sub ${tone ?? ''}`}>{sub}</div>}
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone = 'blue', label }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`progress-fill tone-${tone}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export const Disclaimer = ({ children }) => (
  <p className="disclaimer">
    {children ??
      'WealthFolio provides information and analytics for educational purposes only. It is not investment, tax or legal advice. Market data may be delayed or inaccurate, and past performance does not indicate future results.'}
  </p>
);
