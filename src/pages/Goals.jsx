import { useMemo, useState } from 'react';
import { Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, EmptyState, ProgressBar, Disclaimer } from '../components/ui/Feedback';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { SelectField, TextField } from '../components/ui/Form';
import { LineChart } from '../components/charts/charts';
import { goals as goalsSvc } from '../services/dataService';
import { analyzeGoal } from '../lib/goals';
import { CURRENCY_CODES, GOAL_TYPES } from '../lib/constants';
import { cleanText, collectErrors, friendlyError, positiveNumber, required, toNumber, validDate } from '../lib/validation';
import { formatDate, formatMoney, toISODate } from '../lib/format';

function GoalForm({ goal, onClose, defaultCurrency }) {
  const data = useAppData();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: goal?.name ?? '', goal_type: goal?.goal_type ?? 'Custom', target_amount: goal ? String(goal.target_amount) : '', current_amount: goal ? String(goal.current_amount) : '0',
    target_date: goal?.target_date ?? '', monthly_contribution: goal ? String(goal.monthly_contribution) : '0', expected_annual_return: goal ? String(goal.expected_annual_return) : '0', currency: goal?.currency ?? defaultCurrency,
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [minDate] = useState(() => toISODate(new Date(Date.now() + 86400000)));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const rate = toNumber(f.expected_annual_return);
    const errs = collectErrors({
      name: required(f.name, 'Goal name'),
      target_amount: positiveNumber(f.target_amount, 'Target amount'),
      current_amount: positiveNumber(f.current_amount, 'Current amount', { allowZero: true }),
      monthly_contribution: positiveNumber(f.monthly_contribution, 'Monthly contribution', { allowZero: true }),
      expected_annual_return: Number.isNaN(rate) || rate < -50 || rate > 100 ? 'Enter a return between -50 and 100.' : null,
      target_date: validDate(f.target_date, 'Target date') || (f.target_date <= toISODate() ? 'Target date must be in the future.' : null),
    });
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const values = { name: cleanText(f.name, 100), goal_type: f.goal_type, target_amount: toNumber(f.target_amount), current_amount: toNumber(f.current_amount), target_date: f.target_date, monthly_contribution: toNumber(f.monthly_contribution), expected_annual_return: rate, currency: f.currency };
      if (goal) await data.mutate(() => goalsSvc.update(goal.id, values), ['goals']);
      else await data.mutate(() => goalsSvc.create(data.profile.id, values), ['goals']);
      toast.success(goal ? 'Goal updated.' : 'Goal created.');
      onClose();
    } catch (err) {
      setFormError(friendlyError(err, 'Could not save the goal.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? () => {} : onClose} title={goal ? 'Edit goal' : 'New goal'} size="lg"
      footer={<><button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="goal-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save goal'}</button></>}>
      <form id="goal-form" onSubmit={submit} noValidate className="form-grid">
        <TextField label="Goal name" value={f.name} onChange={set('name')} error={errors.name} maxLength={100} required className="span-2" />
        <SelectField label="Type" value={f.goal_type} onChange={set('goal_type')} options={GOAL_TYPES} />
        <SelectField label="Currency" value={f.currency} onChange={set('currency')} options={CURRENCY_CODES} />
        <TextField label="Target amount" type="number" inputMode="decimal" step="any" min="0" value={f.target_amount} onChange={set('target_amount')} error={errors.target_amount} required />
        <TextField label="Current amount" type="number" inputMode="decimal" step="any" min="0" value={f.current_amount} onChange={set('current_amount')} error={errors.current_amount} />
        <TextField label="Target date" type="date" min={minDate} value={f.target_date} onChange={set('target_date')} error={errors.target_date} required />
        <TextField label="Monthly contribution" type="number" inputMode="decimal" step="any" min="0" value={f.monthly_contribution} onChange={set('monthly_contribution')} error={errors.monthly_contribution} />
        <TextField label="Expected annual return (%)" type="number" step="any" value={f.expected_annual_return} onChange={set('expected_annual_return')} error={errors.expected_annual_return} hint="Your own assumption. 0 = savings only, no growth." className="span-2" />
        {formError && <p className="form-error span-2" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}

function GoalCard({ goal, onEdit, onDelete }) {
  const a = useMemo(() => analyzeGoal(goal), [goal]);
  const c = goal.currency;
  const done = a.current >= a.target;
  return (
    <article className="goal-card panel glass-panel" aria-labelledby={`g-${goal.id}`}>
      <div className="panel-head">
        <div><h2 id={`g-${goal.id}`} className="panel-title">{goal.name}</h2><small className="text-body">{goal.goal_type} · by {formatDate(goal.target_date)}</small></div>
        <div className="actions">
          <button type="button" className="icon-btn" aria-label={`Edit ${goal.name}`} onClick={onEdit}><Pencil size={16} /></button>
          <button type="button" className="icon-btn danger" aria-label={`Delete ${goal.name}`} onClick={onDelete}><Trash2 size={16} /></button>
        </div>
      </div>
      <div className="row-between"><strong>{formatMoney(a.current, c)} <span className="muted">of {formatMoney(a.target, c)}</span></strong><strong>{a.progress.toFixed(1)}%</strong></div>
      <ProgressBar value={a.progress} tone={done || a.onTrack ? 'green' : 'gold'} label={`${goal.name} progress`} />
      <dl className="kv goal-kv">
        <dt>Remaining</dt><dd>{formatMoney(a.remaining, c)}</dd>
        <dt>Required monthly</dt><dd>{done ? '—' : formatMoney(a.needed, c)}</dd>
        <dt>Your monthly</dt><dd>{formatMoney(Number(goal.monthly_contribution), c)}</dd>
        <dt>Estimated completion</dt><dd>{done ? 'Reached 🎉' : a.completionDate ? `${formatDate(a.completionDate.toISOString().slice(0, 10), { month: 'short', year: 'numeric' })}${a.onTrack ? '' : ' (after target date)'}` : 'Not reachable at this contribution'}</dd>
        <dt>Projected at target date</dt><dd>{formatMoney(a.projectedAtDate, c)}</dd>
      </dl>
      <p className={`status ${a.onTrack ? 'text-pos' : 'text-neg'}`}>{done ? 'Goal reached' : a.onTrack ? 'On track at your current contribution' : `Short by ${formatMoney(Math.max(a.target - a.projectedAtDate, 0), c)} at the target date`}</p>
      {a.series.length > 1 && (
        <LineChart height={190} ariaLabel={`${goal.name} projection`}
          series={[{ name: 'Projected balance', color: '#00D084', area: true, points: a.series.map((p) => ({ x: p.date, y: p.value })) }, { name: 'Target', color: '#fbbf24', dashed: true, points: a.series.map((p) => ({ x: p.date, y: a.target })) }]}
          formatY={(v) => formatMoney(v, c, { compact: true })} formatX={(d) => formatDate(d, { month: 'short', year: '2-digit' })} />
      )}
    </article>
  );
}

export default function Goals() {
  const data = useAppData();
  const toast = useToast();
  const { currency } = useCurrency();
  const [modal, setModal] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const remove = async () => {
    try {
      await data.mutate(() => goalsSvc.remove(deleting.id), ['goals']);
      toast.success('Goal deleted.');
    } catch (e) {
      throw new Error(friendlyError(e, 'Could not delete the goal.'), { cause: e });
    }
  };
  return (
    <>
      <PageHeader title="Goals" subtitle="Plan and track what you’re saving for" actions={<button type="button" className="btn-primary-sm" onClick={() => setModal('new')}><Plus size={16} aria-hidden="true" /> New goal</button>} />
      {data.goals.length === 0 ? (
        <EmptyState icon={Target} title="No goals yet" text="Set a target — a house, car, education, emergency fund or retirement — and see what it takes to get there." action={<button type="button" className="btn-primary" onClick={() => setModal('new')}>Create your first goal</button>} />
      ) : (
        <div className="goal-grid">
          {data.goals.map((g) => <GoalCard key={g.id} goal={g} onEdit={() => setModal(g)} onDelete={() => setDeleting(g)} />)}
        </div>
      )}
      <p className="field-hint">Projections use your own return assumption with monthly compounding. They are illustrations, not forecasts or guarantees.</p>
      <Disclaimer />
      {modal && <GoalForm goal={modal === 'new' ? null : modal} defaultCurrency={currency} onClose={() => setModal(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete goal?" message={`“${deleting?.name}” will be permanently deleted.`} confirmLabel="Delete goal" />
    </>
  );
}
