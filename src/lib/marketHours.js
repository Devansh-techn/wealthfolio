// Regular trading hours only. Exchange holidays and special sessions are NOT modelled, so the UI words this
// as "regular hours" and never claims a live exchange status.
export const EXCHANGES = [
  { id: 'NSE', label: 'NSE', tz: 'Asia/Kolkata', open: 9 * 60 + 15, close: 15 * 60 + 30 },
  { id: 'US', label: 'US', tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
];

const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

export function exchangeStatus(ex, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: ex.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const day = WEEKDAYS[get('weekday')];
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const isOpen = day >= 1 && day <= 5 && minutes >= ex.open && minutes < ex.close;
  return { id: ex.id, label: ex.label, open: isOpen, localTime: `${get('hour')}:${get('minute')}` };
}

export const marketStatuses = (now = new Date()) => EXCHANGES.map((e) => exchangeStatus(e, now));
