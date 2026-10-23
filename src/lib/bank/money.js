// Money is handled as integer PAISE inside the app (never binary floats), and as numeric(18,2) in the database.

/** Strict user input: optional sign, digits, at most two decimals; commas, spaces and a leading ₹ are tolerated. Returns paise or null. */
export function parseMoneyInput(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]|^rs\.?|^inr/gi, '');
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace(/^[+-]/, '').split('.');
  const paise = Number(i) * 100 + Number(f.padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? (neg ? -paise : paise) : null;
}
export const fromPaise = (p) => p / 100;
export const toPaise = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100 + (Number(n) >= 0 ? 1e-7 : -1e-7)) : null);
export const sumPaise = (arr) => arr.reduce((s, v) => s + v, 0);
/** "1234.5" -> "1234.50" for sending to numeric(18,2). */
export const paiseToDecimalString = (p) => `${p < 0 ? '-' : ''}${Math.floor(Math.abs(p) / 100)}.${String(Math.abs(p) % 100).padStart(2, '0')}`;
