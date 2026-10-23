// Idempotent imports. A row's key = date | amount | type | normalised description | reference | occurrence number.
// The occurrence number makes two genuinely identical rows in one statement (two 120.00 coffees) distinct while keeping
// the SAME keys when the same statement is imported again, so a retry never duplicates anything.
const normDesc = (d) => String(d ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export function assignDedupeKeys(items) {
  const seen = new Map();
  return items.map((it) => {
    if (it.errors?.length) return { ...it, dedupeKey: null };
    const base = `v1|${it.date}|${it.paise}|${it.type}|${normDesc(it.description)}|${String(it.reference ?? '').trim().toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...it, dedupeKey: `${base}|${n}` };
  });
}

/**
 * Classifies each valid row against what is already in the account:
 *   'exists'   same dedupe key already imported            -> skipped automatically
 *   'possible' same date + amount + direction, entered another way (manual / earlier import) -> skipped unless the user opts in
 *   'new'
 */
export function classifyAgainstExisting(items, existing) {
  const keys = new Set(existing.map((t) => t.dedupe_key).filter(Boolean));
  const fileKeys = new Set(items.map((i) => i.dedupeKey).filter(Boolean));
  const loose = new Map();
  for (const t of existing) {
    if (['reversed', 'failed'].includes(t.transaction_status)) continue;
    if (t.dedupe_key && fileKeys.has(t.dedupe_key)) continue;     // already explained by an identical statement row
    const k = `${t.transaction_date}|${Math.round(Number(t.amount) * 100)}|${t.transaction_type}`;
    loose.set(k, [...(loose.get(k) ?? []), t]);
  }
  return items.map((it) => {
    if (it.errors?.length) return { ...it, status: 'invalid' };
    if (keys.has(it.dedupeKey)) return { ...it, status: 'exists' };
    const m = loose.get(`${it.date}|${it.paise}|${it.type}`);
    return m ? { ...it, status: 'possible', matches: m } : { ...it, status: 'new' };
  });
}
