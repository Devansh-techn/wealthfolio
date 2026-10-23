/** Best-guess default display currency from the browser time zone (user can change it any time). */
export function detectCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (/Calcutta|Kolkata/i.test(tz)) return 'INR';
    if (/London/i.test(tz)) return 'GBP';
    if (/^Europe\//i.test(tz)) return 'EUR';
  } catch {
    /* ignore */
  }
  return 'USD';
}
