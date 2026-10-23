// Dashboard-level bank totals. Currencies are converted ONLY with a valid rate (toDisplay returns null otherwise), and any
// account that cannot be converted is reported, never guessed or silently dropped.
import { classifySync } from './freshness';

export function bankTotals(accounts, toDisplay) {
  let total = 0;
  let missing = 0;
  const rows = [];
  for (const a of accounts) {
    const v = toDisplay(Number(a.ledger_balance), a.currency);
    if (v === null || v === undefined) missing++;
    else total += v;
    rows.push({ id: a.id, nickname: a.nickname, bank_name: a.bank_name, currency: a.currency, native: Number(a.ledger_balance), converted: v ?? null, connected: a.connection_type === 'provider' });
  }
  const synced = accounts.filter((a) => a.connection_type === 'provider' && a.last_synced_at).map((a) => Date.parse(a.last_synced_at));
  const lastSync = synced.length ? new Date(Math.max(...synced)).toISOString() : null;
  return {
    total: Math.round(total * 100) / 100, count: accounts.length, missing, rows,
    connectedCount: accounts.filter((a) => a.connection_type === 'provider').length,
    manualCount: accounts.filter((a) => a.connection_type !== 'provider').length,
    lastSync, syncState: lastSync ? classifySync(lastSync) : 'never',
  };
}

/**
 * Net worth = total assets - total liabilities, where
 *   assets      = investment portfolio value (incl. any "Cash" holdings recorded as assets) + bank balances
 *   liabilities = recorded liabilities
 * Bank balances and Cash-type holdings are SEPARATE records: do not track the same money in both (documented in docs/ACCOUNTING.md).
 * Transfers between own accounts net to zero; buying an investment lowers the bank balance and raises the portfolio, so net worth is unchanged.
 */
export function netWorthBreakdown({ portfolioValue, liabilities, bankTotal }) {
  const assets = Math.round((portfolioValue + bankTotal) * 100) / 100;
  return { assets, liabilities, netWorth: Math.round((assets - liabilities) * 100) / 100 };
}
