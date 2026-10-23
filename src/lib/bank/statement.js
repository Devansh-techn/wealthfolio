// Turns an arbitrary bank CSV into validated transactions. Nothing here assumes one bank's layout.
import { parseMoneyInput } from './money';

// "Chq./Ref.No." and "chq/ref no" must compare equal, so every non-alphanumeric run becomes one space.
const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Ordered by preference within a field (first match wins).
const ALIASES = {
  date: ['transaction date', 'txn date', 'tran date', 'trans date', 'date', 'posting date', 'value date', 'value dt'],
  description: ['narration', 'description', 'particulars', 'transaction remarks', 'transaction details', 'details', 'remarks', 'transaction description'],
  debit: ['withdrawal amt', 'withdrawal amount', 'withdrawals', 'withdrawal', 'debit amount', 'debit', 'dr amount', 'dr'],
  credit: ['deposit amt', 'deposit amount', 'deposits', 'deposit', 'credit amount', 'credit', 'cr amount', 'cr'],
  amount: ['transaction amount', 'amount'],
  type: ['dr/cr', 'cr/dr', 'transaction type', 'txn type', 'type'],
  reference: ['chq/ref no', 'chq ref no', 'cheque/reference no', 'ref no', 'reference no', 'reference number', 'utr', 'utr no', 'transaction id', 'txn id', 'cheque no', 'chq no', 'reference', 'ref'],
  balance: ['closing balance', 'running balance', 'balance', 'bal'],
};
for (const f of Object.keys(ALIASES)) ALIASES[f] = ALIASES[f].map(norm);
export const FIELDS = Object.keys(ALIASES);

/** The statement header is rarely the first line (banks add account details above it). */
export function findHeaderRow(rows) {
  let best = { index: -1, hits: 0 };
  rows.slice(0, 40).forEach((r, index) => {
    const cells = r.map(norm);
    const hits = new Set(FIELDS.filter((f) => cells.some((c) => ALIASES[f].includes(c)))).size;
    if (hits > best.hits && cells.length >= 3) best = { index, hits };
  });
  return best.hits >= 3 ? best.index : -1;
}

export function guessMapping(headers) {
  const cells = headers.map(norm);
  const used = new Set();
  const mapping = {};
  for (const f of FIELDS) {
    for (const alias of ALIASES[f]) {
      const i = cells.findIndex((c, idx) => c === alias && !used.has(idx));
      if (i >= 0) { mapping[f] = i; used.add(i); break; }
    }
  }
  return mapping;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const fullYear = (y) => (y < 100 ? 2000 + y : y);

/** Indian statements are day-first (dd/mm/yyyy). Numeric dates are NEVER read month-first. */
export function parseDate(input) {
  if (!input) return null;
  const s = String(input).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i, '');
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) return iso(fullYear(+m[3]), +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})[ \-/]([A-Za-z]{3,9})[ \-/,]+(\d{2}|\d{4})$/))) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? iso(fullYear(+m[3]), mon, +m[1]) : null;
  }
  return null;
}

/** "1,23,456.78", "₹ 500", "(250.00)", "1,200.00 Dr", "-300" -> { paise (>=0), drcr: 'debit'|'credit'|null, negative } ; null = blank ; {error} = unreadable */
export function parseAmount(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (s === '' || s === '-') return null;
  let drcr = null;
  const suffix = s.match(/\s*\b(dr|cr)\b\.?\s*$/i) || s.match(/^\s*\b(dr|cr)\b\.?\s*/i);
  if (suffix) { drcr = suffix[1].toLowerCase() === 'dr' ? 'debit' : 'credit'; s = s.replace(suffix[0], ''); }
  let negative = false;
  if (/^\(.*\)$/.test(s.trim())) { negative = true; s = s.trim().slice(1, -1); }
  s = s.replace(/[₹,\s]|^rs\.?|^inr/gi, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: `Unreadable amount "${String(input).trim()}"` };
  const [i, f = ''] = s.split('.');
  if (/[1-9]/.test(f.slice(2))) return { error: `Amount "${String(input).trim()}" has more than two decimals` };
  const paise = parseMoneyInput(`${i}.${f.slice(0, 2) || '0'}`);
  return paise === null ? { error: `Unreadable amount "${String(input).trim()}"` } : { paise, drcr, negative };
}

const typeOf = (v) => {
  const s = norm(v);
  if (/^(dr|d|debit|withdrawal|wdl|paid)$/.test(s)) return 'debit';
  if (/^(cr|c|credit|deposit|received)$/.test(s)) return 'credit';
  return null;
};

/** rows = rows AFTER the header. Returns one item per source line with errors (never silently dropped). */
export function rowsToTransactions(rows, mapping, firstLine = 1) {
  const cell = (r, f) => (mapping[f] === undefined ? '' : (r[mapping[f]] ?? '').trim());
  return rows.map((r, idx) => {
    const item = { line: firstLine + idx, raw: r, date: null, description: '', paise: 0, type: null, reference: '', balancePaise: null, errors: [], warnings: [] };
    item.date = parseDate(cell(r, 'date'));
    if (!cell(r, 'date')) item.errors.push('Missing date');
    else if (!item.date) item.errors.push(`Unrecognised date "${cell(r, 'date')}" (expected day-first, e.g. 31/03/2026 or 31 Mar 2026)`);
    item.description = cell(r, 'description').replace(/\s+/g, ' ');
    if (!item.description) { item.description = 'Statement transaction'; item.warnings.push('No description'); }
    item.reference = cell(r, 'reference');

    const d = parseAmount(cell(r, 'debit'));
    const c = parseAmount(cell(r, 'credit'));
    const a = parseAmount(cell(r, 'amount'));
    for (const x of [d, c, a]) if (x?.error) item.errors.push(x.error);
    const dv = d && !d.error && d.paise > 0 ? d : null;
    const cv = c && !c.error && c.paise > 0 ? c : null;
    if (dv && cv) item.errors.push('Both debit and credit are filled in');
    else if (dv) { item.paise = dv.paise; item.type = 'debit'; }
    else if (cv) { item.paise = cv.paise; item.type = 'credit'; }
    else if (a && !a.error && a.paise > 0) {
      item.paise = a.paise;
      item.type = typeOf(cell(r, 'type')) ?? a.drcr ?? (a.negative ? 'debit' : null);
      if (!item.type) item.errors.push('Cannot tell whether the amount is a debit or a credit (map a Dr/Cr or Type column, or use signed amounts)');
    } else if (!item.errors.length) item.errors.push('No amount');
    const bal = parseAmount(cell(r, 'balance'));
    if (bal && !bal.error) item.balancePaise = bal.drcr === 'debit' || bal.negative ? -bal.paise : bal.paise;
    return item;
  });
}

/** Closing balance suggested by the statement itself (balance of the latest-dated row), for reconciliation. */
export function closingBalance(items) {
  const withBal = items.filter((i) => i.date && i.balancePaise !== null && !i.errors.length);
  if (!withBal.length) return null;
  const latest = withBal.reduce((a, b) => (b.date >= a.date ? b : a));
  return { paise: latest.balancePaise, date: latest.date };
}
