/** EMI maths. rate is an annual percentage (e.g. 8.5), tenure in months. */
export function calcEmi(principal, annualRate, months) {
  if (!(principal > 0) || !(months > 0)) return 0;
  const r = annualRate / 12 / 100;
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/**
 * Amortisation schedule with optional prepayments.
 * @param extraMonthly extra amount paid on top of the EMI every month
 * @param lumpSums [{ month: 12, amount: 100000 }] one-off principal prepayments
 */
export function buildSchedule({ principal, annualRate, months, extraMonthly = 0, lumpSums = [] }) {
  const emi = calcEmi(principal, annualRate, months);
  const r = annualRate / 12 / 100;
  const rows = [];
  let balance = principal;
  let totalInterest = 0;
  let month = 0;
  const lumps = new Map();
  for (const l of lumpSums) if (l.amount > 0 && l.month > 0) lumps.set(l.month, (lumps.get(l.month) ?? 0) + l.amount);

  while (balance > 0.005 && month < months + 600) {
    month += 1;
    const interest = balance * r;
    let payment = emi + extraMonthly;
    let principalPaid = payment - interest;
    if (principalPaid > balance) {
      principalPaid = balance;
      payment = principalPaid + interest;
    }
    balance -= principalPaid;
    const lump = Math.min(lumps.get(month) ?? 0, Math.max(balance, 0));
    if (lump > 0) {
      balance -= lump;
      principalPaid += lump;
      payment += lump;
    }
    totalInterest += interest;
    rows.push({ month, payment, interest, principal: principalPaid, balance: Math.max(balance, 0) });
    if (emi + extraMonthly - interest <= 0 && lump === 0 && month > months) break; // cannot amortise
  }
  const totalPaid = rows.reduce((a, x) => a + x.payment, 0);
  return { emi, rows, totalInterest, totalPaid, months: rows.length };
}

export function summarizeByYear(rows) {
  const years = [];
  for (const r of rows) {
    const y = Math.ceil(r.month / 12);
    const cur = years[y - 1] ?? { year: y, payment: 0, interest: 0, principal: 0, balance: 0 };
    cur.payment += r.payment;
    cur.interest += r.interest;
    cur.principal += r.principal;
    cur.balance = r.balance;
    years[y - 1] = cur;
  }
  return years;
}

/** Outstanding balance after `paid` EMIs (no prepayments). */
export function outstandingAfter(principal, annualRate, months, paid) {
  const { rows } = buildSchedule({ principal, annualRate, months });
  if (paid <= 0) return principal;
  if (paid >= rows.length) return 0;
  return rows[paid - 1].balance;
}
