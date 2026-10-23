import { useMemo, useState } from 'react';
import Modal from './ui/Modal';
import { SelectField, TextField, TextAreaField } from './ui/Form';
import { useAppData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { transactions as txSvc } from '../services/dataService';
import { CURRENCY_CODES, TRANSACTION_TYPES } from '../lib/constants';
import { cleanText, collectErrors, friendlyError, positiveNumber, toNumber, validDate } from '../lib/validation';
import { toISODate } from '../lib/format';

const AMOUNT_ONLY = ['DIVIDEND', 'FEE'];

export default function TransactionFormModal({ open, onClose, transaction = null, preset = {} }) {
  const data = useAppData();
  const toast = useToast();
  const editing = Boolean(transaction);
  const [form, setForm] = useState(() => ({
    type: transaction?.type ?? preset.type ?? 'BUY',
    portfolio_id: transaction?.portfolio_id ?? preset.portfolio_id ?? data.portfolioIds?.[0] ?? data.portfolios[0]?.id ?? '',
    asset_id: transaction?.asset_id ?? preset.asset_id ?? '',
    currency: transaction?.currency ?? 'USD',
    quantity: transaction ? String(transaction.quantity) : '',
    price: transaction ? String(transaction.price) : '',
    fees: transaction ? String(transaction.fees || '') : '',
    date: transaction?.transaction_date ?? toISODate(),
    notes: transaction?.notes ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const amountOnly = AMOUNT_ONLY.includes(form.type);
  const cashFlow = form.type === 'DEPOSIT' || form.type === 'WITHDRAWAL';
  const eligible = useMemo(() => {
    if (amountOnly) return data.assets;
    return data.assets.filter((a) => (cashFlow ? a.asset_type === 'Cash' : a.asset_type !== 'Cash'));
  }, [data.assets, amountOnly, cashFlow]);
  const asset = data.assetsById[form.asset_id];
  const held = useMemo(
    () => Number(data.holdings.find((h) => h.portfolio_id === form.portfolio_id && h.asset_id === form.asset_id)?.quantity ?? 0),
    [data.holdings, form.portfolio_id, form.asset_id],
  );

  const changeType = (e) => {
    const type = e.target.value;
    setForm((f) => {
      const nextCash = type === 'DEPOSIT' || type === 'WITHDRAWAL';
      const a = data.assetsById[f.asset_id];
      const keep = a && (AMOUNT_ONLY.includes(type) || (nextCash ? a.asset_type === 'Cash' : a.asset_type !== 'Cash'));
      return { ...f, type, asset_id: keep ? f.asset_id : '', price: nextCash ? '1' : f.price };
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    const checks = {};
    if (!editing) {
      checks.portfolio_id = form.portfolio_id ? null : 'Choose a portfolio.';
      checks.asset_id = !amountOnly && !form.asset_id ? 'Choose an asset.' : null;
    }
    if (amountOnly) checks.price = positiveNumber(form.price, 'Amount');
    else {
      checks.quantity = positiveNumber(form.quantity, cashFlow ? 'Amount' : 'Quantity');
      if (!cashFlow) checks.price = positiveNumber(form.price, 'Price', { allowZero: true });
      if (form.type === 'SELL' || form.type === 'WITHDRAWAL') {
        const q = toNumber(form.quantity);
        if (!checks.quantity && !editing && q > held + 1e-8) checks.quantity = `You only hold ${held} in this portfolio.`;
      }
    }
    if (form.fees !== '') checks.fees = positiveNumber(form.fees, 'Fees', { allowZero: true });
    checks.date = validDate(form.date, 'Date', { allowFuture: false });
    const errs = collectErrors(checks);
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const values = {
        quantity: amountOnly ? 1 : toNumber(form.quantity),
        price: cashFlow ? 1 : toNumber(form.price),
        fees: form.fees === '' ? 0 : toNumber(form.fees),
        transaction_date: form.date,
        notes: cleanText(form.notes, 500) || null,
      };
      if (editing) await data.mutate(() => txSvc.update(transaction.id, values), ['transactions', 'holdings']);
      else
        await data.mutate(
          () => txSvc.create(data.profile.id, { ...values, type: form.type, portfolio_id: form.portfolio_id, asset_id: form.asset_id || null, currency: asset?.currency ?? form.currency }),
          ['transactions', 'holdings'],
        );
      toast.success(editing ? 'Transaction updated.' : 'Transaction recorded.');
      onClose();
    } catch (err) {
      setFormError(friendlyError(err, 'Could not save the transaction.'));
    } finally {
      setBusy(false);
    }
  };

  const currency = asset?.currency ?? form.currency;
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? 'Edit transaction' : 'New transaction'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="tx-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} noValidate className="form-grid">
        <SelectField label="Type" value={form.type} onChange={changeType} options={TRANSACTION_TYPES} disabled={editing} />
        <SelectField label="Portfolio" value={form.portfolio_id} onChange={set('portfolio_id')} error={errors.portfolio_id} disabled={editing} options={data.portfolios.length ? data.portfolios.map((p) => ({ value: p.id, label: p.name })) : [{ value: '', label: 'No portfolio' }]} />
        <SelectField
          label={amountOnly ? 'Asset (optional)' : cashFlow ? 'Cash account' : 'Asset'}
          value={form.asset_id}
          onChange={set('asset_id')}
          error={errors.asset_id}
          disabled={editing}
          className="span-2"
          options={[{ value: '', label: amountOnly ? '— none —' : 'Select…' }, ...eligible.map((a) => ({ value: a.id, label: `${a.name}${a.symbol ? ` (${a.symbol})` : ''} · ${a.currency}` }))]}
          hint={!eligible.length && !amountOnly ? (cashFlow ? 'Add a Cash asset first (Assets → Add asset → Cash).' : 'Add an asset first.') : undefined}
        />
        {amountOnly && !asset && <SelectField label="Currency" value={form.currency} onChange={set('currency')} options={CURRENCY_CODES} disabled={editing} />}
        {amountOnly ? (
          <TextField label={`Amount (${currency})`} type="number" inputMode="decimal" step="any" min="0" value={form.price} onChange={set('price')} error={errors.price} required />
        ) : (
          <>
            <TextField label={cashFlow ? `Amount (${currency})` : 'Quantity'} type="number" inputMode="decimal" step="any" min="0" value={form.quantity} onChange={set('quantity')} error={errors.quantity} hint={(form.type === 'SELL' || form.type === 'WITHDRAWAL') && form.asset_id ? `Held: ${held}` : undefined} required />
            {!cashFlow && <TextField label={`Price (${currency})`} type="number" inputMode="decimal" step="any" min="0" value={form.price} onChange={set('price')} error={errors.price} required />}
          </>
        )}
        <TextField label={`Fees (${currency}, optional)`} type="number" inputMode="decimal" step="any" min="0" value={form.fees} onChange={set('fees')} error={errors.fees} />
        <TextField label="Date" type="date" max={toISODate()} value={form.date} onChange={set('date')} error={errors.date} required />
        <TextAreaField label="Notes (optional)" className="span-2" value={form.notes} onChange={set('notes')} maxLength={500} />
        {editing && <p className="field-hint span-2">Type, portfolio and asset can't be changed. Delete and re-create the transaction to change them.</p>}
        {formError && <p className="form-error span-2" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}
