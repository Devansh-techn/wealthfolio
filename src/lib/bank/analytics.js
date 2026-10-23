// Cash-flow analytics over the bank ledger. ONE accounting model, documented in docs/ACCOUNTING.md:
//  * only settled, non-review rows count (same rule as the database view);
//  * own-account transfers (transfer_id), category Transfers, Investments and Adjustment are NOT income or expenses.
import { sumPaise } from './money';

export const NON_OPERATING = new Set(['Transfers', 'Investments', 'Adjustment']);
export const countsInLedger = (t) => t.transaction_status === 'settled' && !t.needs_review;
export const isOperating = (t) => countsInLedger(t) && !t.transfer_id && !NON_OPERATING.has(t.category);
const paise = (t) => Math.round(Number(t.amount) * 100);

/** Same formula as the SQL view: opening + settled credits - settled debits. */
export function ledgerBalancePaise(account, transactions) {
  const mine = transactions.filter((t) => t.bank_account_id === account.id && countsInLedger(t));
  return Math.round(Number(account.opening_balance) * 100) + sumPaise(mine.map((t) => (t.transaction_type === 'credit' ? paise(t) : -paise(t))));
}

/**
 * Income, expenses and spend-by-category for one calendar month ('YYYY-MM'), converted to one display currency.
 * `toDisplay(amount, currency)` must return null when no valid rate exists; those rows are counted in `unconverted`, never guessed.
 */
export function summarizeMonth(transactions, currencyOf, ym, toDisplay = (a) => a) {
  let income = 0;
  let expenses = 0;
  let unconverted = 0;
  const byCat = new Map();
  for (const t of transactions) {
    if (!t.transaction_date.startsWith(ym) || !isOperating(t)) continue;
    const v = toDisplay(Number(t.amount), currencyOf(t.bank_account_id));
    if (v === null || v === undefined) { unconverted++; continue; }
    if (t.transaction_type === 'credit') income += v;
    else {
      expenses += v;
      byCat.set(t.category, (byCat.get(t.category) ?? 0) + v);
    }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    income: round(income), expenses: round(expenses), net: round(income - expenses), unconverted,
    byCategory: [...byCat.entries()].map(([category, amount]) => ({ category, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
  };
}

export const currentMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export function recentTransactions(transactions, n = 8) {
  return [...transactions].sort((a, b) => (b.transaction_date.localeCompare(a.transaction_date)) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, n);
}

/** Suggest own-account transfers hidden in imported data: equal amounts, opposite direction, different accounts, within 3 days. */
export function suggestTransfers(transactions, accountsById, maxDays = 3) {
  const free = transactions.filter((t) => countsInLedger(t) && !t.transfer_id && t.category !== 'Adjustment');
  const debits = free.filter((t) => t.transaction_type === 'debit');
  const credits = free.filter((t) => t.transaction_type === 'credit');
  const used = new Set();
  const out = [];
  for (const d of debits) {
    const match = credits.find((c) => !used.has(c.id) && c.bank_account_id !== d.bank_account_id && paise(c) === paise(d) && accountsById[c.bank_account_id]?.currency === accountsById[d.bank_account_id]?.currency
      && Math.abs((Date.parse(c.transaction_date) - Date.parse(d.transaction_date)) / 86400000) <= maxDays);
    if (match) { used.add(match.id); out.push({ debit: d, credit: match }); }
  }
  return out;
}
