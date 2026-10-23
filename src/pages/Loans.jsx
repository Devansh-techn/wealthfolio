import { useMemo, useState } from 'react';
import { Calculator, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, StatCard, Disclaimer, EmptyState } from '../components/ui/Feedback';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Form';
import { LineChart } from '../components/charts/charts';
import { liabilities as liabSvc } from '../services/dataService';
import { buildSchedule, outstandingAfter, summarizeByYear } from '../lib/loans';
import { CURRENCY_CODES, LIABILITY_TYPES } from '../lib/constants';
import { cleanText, collectErrors, friendlyError, positiveNumber, required, toNumber, validDate } from '../lib/validation';
import { formatDate, formatMoney, toISODate } from '../lib/format';

function SaveLoanModal({ calc, currency, onClose }) {
  const data = useAppData();
  const toast = useToast();
  const [f, setF] = useState({ name: '', liability_type: 'Home Loan', start_date: toISODate(), currency });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const errs = collectErrors({ name: required(f.name, 'Name'), start_date: validDate(f.start_date, 'Start date') });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const start = new Date(`${f.start_date}T00:00:00`);
      const now = new Date();
      const paid = Math.max(0, Math.min(calc.months, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()));
      await data.mutate(() => liabSvc.create(data.profile.id, { name: cleanText(f.name, 100), liability_type: f.liability_type, principal: calc.principal, outstanding: Number(outstandingAfter(calc.principal, calc.rate, calc.months, paid).toFixed(2)), interest_rate: calc.rate, tenure_months: calc.months, emi: Number(calc.emi.toFixed(2)), start_date: f.start_date, currency: f.currency }), ['liabilities']);
      toast.success('Loan saved. It now counts against your net worth.');
      onClose();
    } catch (err) {
      setFormError(friendlyError(err, 'Could not save the loan.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Save as a liability" size="md"
      footer={<><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="loan-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save loan'}</button></>}>
      <form id="loan-form" onSubmit={submit} noValidate className="form-grid">
        <TextField label="Name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} error={errors.name} maxLength={100} required className="span-2" />
        <SelectField label="Type" value={f.liability_type} onChange={(e) => setF((x) => ({ ...x, liability_type: e.target.value }))} options={LIABILITY_TYPES} />
        <SelectField label="Currency" value={f.currency} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value }))} options={CURRENCY_CODES} />
        <TextField label="Loan start date" type="date" value={f.start_date} onChange={(e) => setF((x) => ({ ...x, start_date: e.target.value }))} error={errors.start_date} hint="Outstanding balance is estimated from EMIs elapsed since this date." className="span-2" />
        {formError && <p className="form-error span-2" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}

function EditLiabilityModal({ item, onClose }) {
  const data = useAppData();
  const toast = useToast();
  const [outstanding, setOutstanding] = useState(String(item.outstanding));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const err = positiveNumber(outstanding, 'Outstanding', { allowZero: true });
    if (err) return setError(err);
    setBusy(true);
    try {
      await data.mutate(() => liabSvc.update(item.id, { outstanding: toNumber(outstanding) }), ['liabilities']);
      toast.success('Outstanding balance updated.');
      onClose();
    } catch (e2) {
      setError(friendlyError(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Update ${item.name}`} size="sm"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="liab-edit" className="btn-primary-sm" disabled={busy}>Save</button></>}>
      <form id="liab-edit" onSubmit={submit} noValidate>
        <TextField label={`Outstanding (${item.currency})`} type="number" step="any" min="0" value={outstanding} onChange={(e) => setOutstanding(e.target.value)} error={error} hint="Your lender’s current balance. Used in net worth." />
      </form>
    </Modal>
  );
}

export default function Loans() {
  const data = useAppData();
  const toast = useToast();
  const { currency } = useCurrency();
  const [f, setF] = useState({ amount: '1000000', rate: '8.5', tenure: '20', unit: 'years', extra: '', lumpAmt: '', lumpMonth: '12' });
  const [view, setView] = useState('yearly');
  const [saveOpen, setSaveOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const parsed = useMemo(() => {
    const principal = toNumber(f.amount);
    const rate = toNumber(f.rate);
    const t = toNumber(f.tenure);
    const months = f.unit === 'years' ? Math.round(t * 12) : Math.round(t);
    const errors = collectErrors({
      amount: positiveNumber(f.amount, 'Loan amount', { max: 1e11 }),
      rate: positiveNumber(f.rate, 'Interest rate', { allowZero: true, max: 100 }),
      tenure: positiveNumber(f.tenure, 'Tenure') || (months < 1 || months > 720 ? 'Tenure must be between 1 month and 60 years.' : null),
    });
    return { principal, rate, months, errors, ok: Object.keys(errors).length === 0 };
  }, [f]);

  const extra = Math.max(0, toNumber(f.extra) || 0);
  const lumpAmt = Math.max(0, toNumber(f.lumpAmt) || 0);
  const lumpMonth = Math.max(1, Math.round(toNumber(f.lumpMonth) || 1));
  const base = useMemo(() => (parsed.ok ? buildSchedule({ principal: parsed.principal, annualRate: parsed.rate, months: parsed.months }) : null), [parsed]);
  const pre = useMemo(() => (parsed.ok && (extra > 0 || lumpAmt > 0) ? buildSchedule({ principal: parsed.principal, annualRate: parsed.rate, months: parsed.months, extraMonthly: extra, lumpSums: lumpAmt > 0 ? [{ month: lumpMonth, amount: lumpAmt }] : [] }) : null), [parsed, extra, lumpAmt, lumpMonth]);
  const years = useMemo(() => (base ? summarizeByYear(pre ? pre.rows : base.rows) : []), [base, pre]);
  const active = pre ?? base;

  const remove = async () => {
    try {
      await data.mutate(() => liabSvc.remove(deleting.id), ['liabilities']);
      toast.success('Loan removed.');
    } catch (e) {
      throw new Error(friendlyError(e, 'Could not delete.'), { cause: e });
    }
  };
  const mFmt = (v) => formatMoney(v, currency, { maxFraction: 0 });

  return (
    <>
      <PageHeader title="Loans & EMI" subtitle="Calculate EMIs, see the full schedule, and simulate prepayments" />
      <div className="grid-2 loan-top">
        <section className="panel glass-panel" aria-labelledby="calc-h">
          <h2 id="calc-h" className="panel-title"><Calculator size={18} aria-hidden="true" /> Calculator ({currency})</h2>
          <div className="form-grid">
            <TextField label="Loan amount" type="number" inputMode="decimal" min="0" step="any" value={f.amount} onChange={set('amount')} error={parsed.errors.amount} />
            <TextField label="Interest rate (% per year)" type="number" inputMode="decimal" min="0" step="any" value={f.rate} onChange={set('rate')} error={parsed.errors.rate} />
            <TextField label="Tenure" type="number" inputMode="decimal" min="0" step="any" value={f.tenure} onChange={set('tenure')} error={parsed.errors.tenure} />
            <SelectField label="Tenure unit" value={f.unit} onChange={set('unit')} options={['years', 'months']} />
            <div className="span-2 form-section">Prepayment simulation (optional)</div>
            <TextField label="Extra payment every month" type="number" inputMode="decimal" min="0" step="any" value={f.extra} onChange={set('extra')} />
            <span />
            <TextField label="One-time prepayment" type="number" inputMode="decimal" min="0" step="any" value={f.lumpAmt} onChange={set('lumpAmt')} />
            <TextField label="…in month #" type="number" min="1" step="1" value={f.lumpMonth} onChange={set('lumpMonth')} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn-secondary" onClick={() => setSaveOpen(true)} disabled={!parsed.ok}><Save size={16} aria-hidden="true" /> Save as liability</button>
          </div>
        </section>

        <section className="loan-results" aria-label="Results" aria-live="polite">
          {base ? (
            <>
              <StatCard label="Monthly EMI" value={formatMoney(base.emi, currency, { maxFraction: 2 })} />
              <StatCard label="Total interest" value={mFmt(base.totalInterest)} />
              <StatCard label="Total repayment" value={mFmt(base.totalPaid)} />
              {pre && (
                <div className="stat glass-panel saving">
                  <span className="stat-title">With prepayments</span>
                  <div className="stat-figure text-pos">Save {mFmt(base.totalInterest - pre.totalInterest)}</div>
                  <div className="stat-sub">in interest · finish {base.months - pre.months} months early ({Math.floor(pre.months / 12)}y {pre.months % 12}m instead of {Math.floor(base.months / 12)}y {base.months % 12}m)</div>
                </div>
              )}
            </>
          ) : <p className="text-body">Enter valid loan details to see results.</p>}
        </section>
      </div>

      {active && (
        <>
          <section className="panel glass-panel" aria-labelledby="bal-h">
            <h2 id="bal-h" className="panel-title">Outstanding balance over time</h2>
            <LineChart ariaLabel="Outstanding loan balance" height={230}
              series={[
                { name: pre ? 'With prepayments' : 'Balance', color: '#00D084', area: true, points: [{ x: 0, y: parsed.principal }, ...active.rows.map((r) => ({ x: r.month, y: r.balance }))] },
                ...(pre ? [{ name: 'Original schedule', color: '#7B3FE4', dashed: true, points: [{ x: 0, y: parsed.principal }, ...active.rows.map((r) => ({ x: r.month, y: base.rows[r.month - 1]?.balance ?? 0 }))] }] : []),
              ]}
              formatY={(v) => formatMoney(v, currency, { compact: true })} formatX={(m) => `Month ${m}`} />
            <p className="field-hint">Months: 0 → {active.rows.length}. The dashed line shows the original schedule for comparison.</p>
          </section>

          <section className="panel glass-panel" aria-labelledby="sched-h">
            <div className="panel-head">
              <h2 id="sched-h" className="panel-title">Amortization schedule</h2>
              <div className="seg" role="group" aria-label="Schedule view"><button type="button" className={view === 'yearly' ? 'on' : ''} aria-pressed={view === 'yearly'} onClick={() => setView('yearly')}>Yearly</button><button type="button" className={view === 'monthly' ? 'on' : ''} aria-pressed={view === 'monthly'} onClick={() => setView('monthly')}>Monthly</button></div>
            </div>
            <div className="table-scroll tall">
              <table className="table">
                <caption className="sr-only">{view} amortization schedule</caption>
                <thead><tr><th scope="col">{view === 'yearly' ? 'Year' : 'Month'}</th><th scope="col" className="num">Payment</th><th scope="col" className="num">Principal</th><th scope="col" className="num">Interest</th><th scope="col" className="num">Balance</th></tr></thead>
                <tbody>
                  {(view === 'yearly' ? years.map((y) => ({ k: y.year, ...y })) : active.rows.map((r) => ({ k: r.month, ...r }))).map((r) => (
                    <tr key={r.k}><th scope="row">{r.k}</th><td className="num">{mFmt(r.payment)}</td><td className="num">{mFmt(r.principal)}</td><td className="num">{mFmt(r.interest)}</td><td className="num">{mFmt(r.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="panel glass-panel" aria-labelledby="my-h">
        <h2 id="my-h" className="panel-title">Your saved loans</h2>
        {data.liabilities.length === 0 ? (
          <EmptyState icon={Plus} title="No saved loans" text="Save a loan from the calculator and it will be deducted from your net worth." />
        ) : (
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Saved loans</caption>
              <thead><tr><th scope="col">Loan</th><th scope="col" className="num">Rate</th><th scope="col" className="num">EMI</th><th scope="col" className="num">Outstanding</th><th scope="col">Started</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.liabilities.map((l) => (
                  <tr key={l.id}>
                    <th scope="row"><div className="cell-main"><strong>{l.name}</strong><small>{l.liability_type}</small></div></th>
                    <td className="num">{Number(l.interest_rate)}%</td>
                    <td className="num">{formatMoney(Number(l.emi), l.currency)}</td>
                    <td className="num"><strong>{formatMoney(Number(l.outstanding), l.currency)}</strong></td>
                    <td>{formatDate(l.start_date)}</td>
                    <td className="actions">
                      <button type="button" className="icon-btn" aria-label={`Update ${l.name} balance`} onClick={() => setEditing(l)}><Pencil size={16} /></button>
                      <button type="button" className="icon-btn danger" aria-label={`Delete ${l.name}`} onClick={() => setDeleting(l)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Disclaimer>Calculations assume a fixed rate and equal monthly instalments with monthly compounding. Your lender’s figures may differ because of fees, rate changes and day-count conventions.</Disclaimer>
      {saveOpen && parsed.ok && <SaveLoanModal calc={{ principal: parsed.principal, rate: parsed.rate, months: parsed.months, emi: base.emi }} currency={currency} onClose={() => setSaveOpen(false)} />}
      {editing && <EditLiabilityModal item={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete loan?" message={`“${deleting?.name}” will be removed and no longer counted in net worth.`} confirmLabel="Delete" />
    </>
  );
}
