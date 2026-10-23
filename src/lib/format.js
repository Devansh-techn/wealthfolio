import { CURRENCIES } from './constants';

const localeFor = (code) => CURRENCIES.find((c) => c.code === code)?.locale ?? 'en-US';

// Indian compact units. Intl's en-IN "compact" form uses "T" for thousand ("₹10T" for ₹10,000), which reads as
// "trillion" to almost everyone, so rupee amounts use the units people actually say: K, L (lakh) and Cr (crore).
function compactINR(value, symbol) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const trim = (n) => String(Number(n.toFixed(2)));
  if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}K`;
  return `${sign}${symbol}${trim(abs)}`;
}

export function formatMoney(value, currency = 'USD', { compact = false, maxFraction } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (compact && currency === 'INR') return compactINR(value, '₹');
  const abs = Math.abs(value);
  const fraction = maxFraction ?? (abs >= 1000 ? 0 : 2);
  try {
    return new Intl.NumberFormat(localeFor(currency), {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : fraction,
      minimumFractionDigits: compact ? 0 : Math.min(fraction, 2) === 0 ? 0 : fraction,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value, maxFraction = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFraction }).format(value);
}

/** value is a percentage already (e.g. 12.3 => "12.30%"). */
export function formatPercent(value, { digits = 2, sign = false } = {}) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return '—';
  const s = sign && value > 0 ? '+' : '';
  return `${s}${value.toFixed(digits)}%`;
}

export function formatDate(value, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!value) return '—';
  const d = typeof value === 'string' && value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', opts).format(d);
}

export function formatRelativeTime(value) {
  if (!value) return 'never';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return 'never';
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}

export const toISODate = (d = new Date()) => {
  const x = new Date(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
};

export const pnlClass = (v) => (v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : '');
