import { CURRENCY_CODES } from './constants';

export const SYMBOL_RE = /^[A-Za-z0-9.\-^=&:_]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Collapse control chars and trim. React escapes output; this keeps stored text tidy. */
export function cleanText(value, max = 200) {
  if (value === null || value === undefined) return '';
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const isEmail = (v) => EMAIL_RE.test(String(v ?? '').trim());

export function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 72) return 'Password must be 72 characters or fewer.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number.';
  return null;
}

export function toNumber(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

export const required = (v, label) => (cleanText(v, 500) ? null : `${label} is required.`);

export function positiveNumber(v, label, { allowZero = false, max = 1e12 } = {}) {
  const n = toNumber(v);
  if (Number.isNaN(n)) return `${label} must be a number.`;
  if (allowZero ? n < 0 : n <= 0) return `${label} must be ${allowZero ? 'zero or more' : 'greater than zero'}.`;
  if (n > max) return `${label} is too large.`;
  return null;
}

export function validDate(v, label, { allowFuture = true } = {}) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${label} must be a valid date.`;
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return `${label} must be a valid date.`;
  if (!allowFuture && d.getTime() > Date.now() + 86400000) return `${label} cannot be in the future.`;
  return null;
}

export const validCurrency = (v) => (CURRENCY_CODES.includes(v) ? null : 'Choose a supported currency.');

export function validSymbol(v, label = 'Symbol') {
  const s = String(v ?? '').trim();
  if (!s) return `${label} is required.`;
  return SYMBOL_RE.test(s) ? null : `${label} may only contain letters, digits and . - ^ = & : _`;
}

/** Run a map of { field: errorOrNull }, return errors object (empty when valid). */
export function collectErrors(checks) {
  const errors = {};
  for (const [k, v] of Object.entries(checks)) if (v) errors[k] = v;
  return errors;
}

/** Map low-level errors to safe, user-facing messages. */
export function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  const msg = String(err?.message ?? '');
  if (!msg) return fallback;
  if (/Cannot sell or withdraw more than/i.test(msg)) return msg.replace(/^.*?(Cannot sell)/i, 'Cannot sell');
  if (/duplicate key|already exists|unique/i.test(msg)) return 'That item already exists.';
  if (/Invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/Email not confirmed/i.test(msg)) return 'Please verify your email before signing in.';
  if (/User already registered/i.test(msg)) return 'An account with this email already exists.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
  if (/JWT expired|invalid jwt|not authenticated/i.test(msg)) return 'Your session expired. Please sign in again.';
  // Errors from invokeFunction already carry a precise, safe message (offline / service unreachable / platform relay).
  if (err?.kind === 'unreachable' || err?.kind === 'relay') return msg;
  if (/Failed to fetch|NetworkError|network/i.test(msg)) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? 'You appear to be offline. Check your connection and retry.' : 'Could not reach the server. Please try again shortly.';
  }
  if (/currency/i.test(msg) && /must match|cannot be changed/i.test(msg)) return msg;
  if (/check constraint|violates/i.test(msg)) return 'Some values are not allowed. Please review the form.';
  // Our Edge Functions only return curated, user-safe error text (e.g. "Market data is temporarily unavailable.").
  if (err?.kind === 'http' && msg.length <= 140) return msg;
  return fallback;
}
