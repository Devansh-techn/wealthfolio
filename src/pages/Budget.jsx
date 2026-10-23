import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, PiggyBank, Plus, Repeat, Trash2 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, StatCard, EmptyState, ProgressBar, InlineNotice } from '../components/ui/Feedback';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { CheckField, SelectField, TextField } from '../components/ui/Form';
import { DonutChart } from '../components/charts/charts';
import { PALETTE } from '../components/charts/palette';
import { addNotification, budgets as budgetSvc, expenses as expSvc, income as incSvc } from '../services/dataService';
import { breakdownByCategory, budgetProgress, itemsForMonth, monthKey, monthLabel, shiftMonth, totalFor } from '../lib/budget';
import { CURRENCY_CODES, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../lib/constants';
import { cleanText, collectErrors, friendlyError, positiveNumber, toNumber, validDate } from '../lib/validation';
import { formatDate, formatMoney, formatPercent, pnlClass, toISODate } from '../lib/format';

function EntryModal({ kind, item, onClose, defaultCurrency }) {
  const data = useAppData();
  const toast = useToast();
  const isExp = kind === 'expense';
  const svc = isExp ? expSvc : incSvc;
  const dateKey = isExp ? 'expense_date' : 'income_date';
  const cats = isExp ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const [f, setF] = useState(() => ({
    category: item?.category ?? cats[0], description: item?.description ?? '', amount: item ? String(item.amount) : '', currency: item?.currency ?? defaultCurrency,
    date: item?.[dateKey] ?? toISODate(), is_recurring: item?.is_recurring ?? false, recurrence_end: item?.recurrence_end ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const errs = collectErrors({
      amount: positiveNumber(f.amount, 'Amount'),
      date: validDate(f.date, 'Date'),
      recurrence_end: f.is_recurring && f.recurrence_end ? validDate(f.recurrence_end, 'End date') || (f.recurrence_end < f.date ? 'End date must be after the start date.' : null) : null,
    });
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const values = { category: f.category, description: cleanText(f.description, 200) || null, amount: toNumber(f.amount), currency: f.currency, [dateKey]: f.date, is_recurring: f.is_recurring, recurrence_end: f.is_recurring && f.recurrence_end ? f.recurrence_end : null };
      const key = isExp ? 'expenses' : 'income';
      if (item) await data.mutate(() => svc.update(item.id, values), [key]);
      else await data.mutate(() => svc.create(data.profile.id, values), [key]);
      toast.success(`${isExp ? 'Expense' : 'Income'} ${item ? 'updated' : 'added'}.`);
      onClose();
    } catch (err) {
      setFormError(friendlyError(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };
  const label = isExp ? 'expense' : 'income';
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`${item ? 'Edit' : 'Add'} ${label}`} size="md"
      footer={<><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="entry-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="entry-form" onSubmit={submit} noValidate className="form-grid">
        <SelectField label="Category" value={f.category} onChange={set('category')} options={cats} />
        <TextField label="Amount" type="number" inputMode="decimal" step="any" min="0" value={f.amount} onChange={set('amount')} error={errors.amount} required />
        <SelectField label="Currency" value={f.currency} onChange={set('currency')} options={CURRENCY_CODES} />
        <TextField label={f.is_recurring ? 'Start date' : 'Date'} type="date" value={f.date} onChange={set('date')} error={errors.date} required />
        <TextField label="Description (optional)" value={f.description} onChange={set('description')} maxLength={200} className="span-2" />
        <div className="span-2"><CheckField label="Repeats every month" checked={f.is_recurring} onChange={(e) => setF((x) => ({ ...x, is_recurring: e.target.checked }))} /></div>
        {f.is_recurring && <TextField label="Stop after (optional)" type="date" value={f.recurrence_end} onChange={set('recurrence_end')} error={errors.recurrence_end} className="span-2" />}
        {formError && <p className="form-error span-2" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}

function BudgetModal({ budget, onClose, defaultCurrency }) {
  const data = useAppData();
  const toast = useToast();
  const [f, setF] = useState({ category: budget?.category ?? EXPENSE_CATEGORIES[0], monthly_limit: budget ? String(budget.monthly_limit) : '', currency: budget?.currency ?? defaultCurrency });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const err = positiveNumber(f.monthly_limit, 'Monthly limit');
    if (err) return setError(err);
    setBusy(true);
    setError('');
    try {
      const values = { category: f.category, monthly_limit: toNumber(f.monthly_limit), currency: f.currency };
      if (budget) await data.mutate(() => budgetSvc.update(budget.id, values), ['budgets']);
      else await data.mutate(() => budgetSvc.create(data.profile.id, values), ['budgets']);
      toast.success('Budget saved.');
      onClose();
    } catch (e2) {
      setError(friendlyError(e2, 'Could not save the budget. Each category can only have one budget.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={budget ? 'Edit budget' : 'New monthly budget'} size="sm"
      footer={<><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="budget-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="budget-form" onSubmit={submit} noValidate className="form-stack">
        <SelectField label="Category" value={f.category} onChange={(e) => setF((x) => ({ ...x, category: e.target.value }))} options={EXPENSE_CATEGORIES} disabled={Boolean(budget)} />
        <TextField label="Monthly limit" type="number" inputMode="decimal" step="any" min="0" value={f.monthly_limit} onChange={(e) => setF((x) => ({ ...x, monthly_limit: e.target.value }))} error={error} required />
        <SelectField label="Currency" value={f.currency} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value }))} options={CURRENCY_CODES} />
      </form>
    </Modal>
  );
}

export default function Budget() {
  const data = useAppData();
  const toast = useToast();
  const { currency, format, fx } = useCurrency();
  const [ym, setYm] = useState(monthKey());
  const [tab, setTab] = useState('expense');
  const [entry, setEntry] = useState(null); // { kind, item }
  const [budgetModal, setBudgetModal] = useState(null);
  const [deleting, setDeleting] = useState(null); // { kind, item }
  const notified = useRef(new Set());

  const monthIncome = useMemo(() => itemsForMonth(data.income, 'income_date', ym), [data.income, ym]);
  const monthExpenses = useMemo(() => itemsForMonth(data.expenses, 'expense_date', ym), [data.expenses, ym]);
  const inc = useMemo(() => totalFor(monthIncome, currency, fx), [monthIncome, currency, fx]);
  const exp = useMemo(() => totalFor(monthExpenses, currency, fx), [monthExpenses, currency, fx]);
  const savings = inc.total - exp.total;
  const savingsRate = inc.total > 0 ? (savings / inc.total) * 100 : null;
  const breakdown = useMemo(() => breakdownByCategory(monthExpenses, currency, fx), [monthExpenses, currency, fx]);
  const progress = useMemo(() => budgetProgress(data.budgets, breakdown, currency, fx), [data.budgets, breakdown, currency, fx]);

  // Alert (once per category/month/status) when a budget crosses 80% or 100% in the current month.
  const isCurrent = ym === monthKey();
  const alertsOn = data.profile.notifications_enabled;
  useEffect(() => {
    if (!isCurrent || !alertsOn) return;
    const fresh = progress.filter((p) => p.status !== 'ok' && p.limit).map((p) => ({ p, key: `budget:${p.budget.category}:${ym}:${p.status}` })).filter(({ key }) => !notified.current.has(key));
    if (!fresh.length) return;
    fresh.forEach(({ key }) => notified.current.add(key));
    (async () => {
      try {
        await Promise.all(fresh.map(({ p, key }) => addNotification(data.profile.id, { type: 'warning', dedupe_key: key, title: p.status === 'over' ? `${p.budget.category} budget exceeded` : `${p.budget.category} budget at ${p.pct.toFixed(0)}%`, body: `You've spent ${formatMoney(p.spent, currency)} of ${formatMoney(p.limit, currency)} this month.` })));
        await data.refresh(['notifications']);
      } catch {
        /* alerts are best-effort */
      }
    })();
  }, [progress, isCurrent, alertsOn, ym, currency, data]);

  const removeEntry = async () => {
    const { kind, item } = deleting;
    try {
      if (kind === 'expense') await data.mutate(() => expSvc.remove(item.id), ['expenses']);
      else if (kind === 'income') await data.mutate(() => incSvc.remove(item.id), ['income']);
      else await data.mutate(() => budgetSvc.remove(item.id), ['budgets']);
      toast.success('Deleted.');
    } catch (e) {
      throw new Error(friendlyError(e, 'Could not delete.'), { cause: e });
    }
  };

  const list = tab === 'expense' ? monthExpenses : monthIncome;
  const dateKey = tab === 'expense' ? 'expense_date' : 'income_date';
  const noData = !data.income.length && !data.expenses.length && !data.budgets.length;

  return (
    <>
      <PageHeader title="Budget" subtitle="Income, spending and monthly limits" actions={
        <>
          <div className="month-nav" role="group" aria-label="Month">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronLeft size={18} /></button>
            <strong>{monthLabel(ym)}</strong>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => setYm(shiftMonth(ym, 1))} disabled={ym >= monthKey()}><ChevronRight size={18} /></button>
          </div>
          <button type="button" className="btn-primary-sm" onClick={() => setEntry({ kind: tab, item: null })}><Plus size={16} aria-hidden="true" /> Add {tab}</button>
        </>} />
      {(inc.missing > 0 || exp.missing > 0) && <InlineNotice tone="warn">Some entries are in currencies that can’t be converted to {currency} right now and are left out of the totals.</InlineNotice>}

      {noData && <EmptyState icon={PiggyBank} title="Start with your income and expenses" text="Add what comes in and goes out each month to see your savings rate and where your money goes." action={<button type="button" className="btn-primary" onClick={() => setEntry({ kind: 'income', item: null })}>Add income</button>} />}

      <section className="stat-grid stat-grid-4" aria-label="Month summary">
        <StatCard label="Monthly income" value={format(inc.total)} />
        <StatCard label="Monthly expenses" value={format(exp.total)} />
        <StatCard label="Savings" tone={pnlClass(savings)} value={`${savings > 0 ? '+' : ''}${format(savings)}`} />
        <StatCard label="Savings rate" tone={pnlClass(savingsRate)} value={savingsRate === null ? 'n/a' : formatPercent(savingsRate)} sub={savingsRate === null ? 'Add income to calculate' : undefined} />
      </section>

      <div className="grid-2">
        <section className="panel glass-panel" aria-labelledby="cb-h">
          <h2 id="cb-h" className="panel-title">Spending by category</h2>
          {breakdown.length ? <DonutChart size={170} ariaLabel="Spending by category" data={breakdown.map((b, i) => ({ label: b.category, value: b.value, color: PALETTE[i % PALETTE.length] }))} formatValue={(v) => formatMoney(v, currency, { compact: true })} /> : <p className="text-body">No expenses in {monthLabel(ym)}.</p>}
        </section>
        <section className="panel glass-panel" aria-labelledby="bp-h">
          <div className="panel-head"><h2 id="bp-h" className="panel-title">Budget progress</h2><button type="button" className="btn-secondary btn-sm" onClick={() => setBudgetModal('new')}><Plus size={14} aria-hidden="true" /> Budget</button></div>
          {progress.length === 0 ? <p className="text-body">No budgets yet. Set a monthly limit for a category to track it.</p> : (
            <ul className="list list-block">
              {progress.map((p) => (
                <li key={p.budget.id}>
                  <div className="row-between"><strong>{p.budget.category}</strong>
                    <span className="actions"><small className={p.status === 'over' ? 'text-neg' : ''}>{p.limit === null ? 'No rate' : `${formatMoney(p.spent, currency, { compact: true })} / ${formatMoney(p.limit, currency, { compact: true })}`}</small>
                      <button type="button" className="icon-btn" aria-label={`Edit ${p.budget.category} budget`} onClick={() => setBudgetModal(p.budget)}><Pencil size={14} /></button>
                      <button type="button" className="icon-btn danger" aria-label={`Delete ${p.budget.category} budget`} onClick={() => setDeleting({ kind: 'budget', item: p.budget })}><Trash2 size={14} /></button></span></div>
                  <ProgressBar value={p.pct} tone={p.status === 'over' ? 'red' : p.status === 'warn' ? 'gold' : 'green'} label={`${p.budget.category} budget used`} />
                  {p.status !== 'ok' && <small className={p.status === 'over' ? 'text-neg' : 'text-warn'}>{p.status === 'over' ? `Over budget by ${formatMoney(p.spent - p.limit, currency)}` : `${p.pct.toFixed(0)}% used`}</small>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel glass-panel" aria-label="Entries">
        <div className="panel-head">
          <div className="seg" role="tablist" aria-label="Entry type">
            <button type="button" role="tab" aria-selected={tab === 'expense'} className={tab === 'expense' ? 'on' : ''} onClick={() => setTab('expense')}>Expenses</button>
            <button type="button" role="tab" aria-selected={tab === 'income'} className={tab === 'income' ? 'on' : ''} onClick={() => setTab('income')}>Income</button>
          </div>
        </div>
        {list.length === 0 ? <p className="text-body">No {tab === 'expense' ? 'expenses' : 'income'} in {monthLabel(ym)}.</p> : (
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">{tab === 'expense' ? 'Expenses' : 'Income'} for {monthLabel(ym)}</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Category</th><th scope="col">Description</th><th scope="col" className="num">Amount</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id}>
                    <td>{formatDate(it[dateKey])}</td>
                    <td>{it.category}{it.is_recurring && <span className="pill pill-rec" title="Repeats monthly"><Repeat size={11} aria-hidden="true" /> monthly</span>}</td>
                    <td className="notes-cell">{it.description ?? ''}</td>
                    <td className="num"><strong>{formatMoney(Number(it.amount), it.currency)}</strong></td>
                    <td className="actions">
                      <button type="button" className="icon-btn" aria-label="Edit entry" onClick={() => setEntry({ kind: tab, item: it })}><Pencil size={16} /></button>
                      <button type="button" className="icon-btn danger" aria-label="Delete entry" onClick={() => setDeleting({ kind: tab, item: it })}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {entry && <EntryModal kind={entry.kind} item={entry.item} defaultCurrency={currency} onClose={() => setEntry(null)} />}
      {budgetModal && <BudgetModal budget={budgetModal === 'new' ? null : budgetModal} defaultCurrency={currency} onClose={() => setBudgetModal(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={removeEntry} title="Delete this item?" message={deleting?.item?.is_recurring ? 'This is a recurring item — deleting it removes it from every month.' : 'This can’t be undone.'} confirmLabel="Delete" />
    </>
  );
}
