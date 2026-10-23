import { useMemo, useState } from 'react';
import Modal from './ui/Modal';
import { SelectField, TextField } from './ui/Form';
import { InlineNotice } from './ui/Feedback';
import SymbolSearch from './SymbolSearch';
import { useAppData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { assets as assetsSvc, createAssetWithPosition } from '../services/dataService';
import { getQuote } from '../services/marketDataService';
import { ASSET_TYPES, CURRENCY_CODES, MARKET_PRICEABLE_TYPES } from '../lib/constants';
import { cleanText, collectErrors, friendlyError, positiveNumber, required, toNumber, validDate, validSymbol } from '../lib/validation';
import { formatMoney, toISODate } from '../lib/format';

const blank = (portfolioId, currency) => ({
  symbol: '', name: '', asset_type: 'Stock', currency, exchange: '', sector: '',
  price_source: 'market', current_price: '', previous_close: null,
  portfolio_id: portfolioId, quantity: '', buy_price: '', fees: '', date: toISODate(), notes: '',
});

/** Create an asset + opening position, or edit an existing asset's details. */
export default function AssetFormModal({ open, onClose, asset = null, defaultPortfolioId = null, defaultCurrency = 'USD' }) {
  const data = useAppData();
  const toast = useToast();
  const editing = Boolean(asset);
  const initialPortfolio = defaultPortfolioId ?? data.portfolios[0]?.id ?? '';
  const [form, setForm] = useState(() =>
    asset
      ? { ...blank(initialPortfolio, asset.currency), symbol: asset.symbol ?? '', name: asset.name, asset_type: asset.asset_type, currency: asset.currency, exchange: asset.exchange ?? '', sector: asset.sector ?? '', price_source: asset.price_source, current_price: String(asset.current_price ?? ''), notes: asset.notes ?? '' }
      : blank(initialPortfolio, defaultCurrency),
  );
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoteState, setQuoteState] = useState({ loading: false, message: '', tone: 'ok' });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isCash = form.asset_type === 'Cash';
  const canMarket = MARKET_PRICEABLE_TYPES.includes(form.asset_type);

  const existing = useMemo(() => {
    if (editing || !form.symbol) return null;
    return data.assets.find((a) => a.symbol && a.symbol.toUpperCase() === form.symbol.trim().toUpperCase() && a.asset_type === form.asset_type) ?? null;
  }, [data.assets, editing, form.symbol, form.asset_type]);
  const existingCash = useMemo(
    () => (!editing && isCash ? data.assets.find((a) => a.asset_type === 'Cash' && a.currency === form.currency && a.name.toLowerCase() === form.name.trim().toLowerCase()) : null),
    [data.assets, editing, isCash, form.currency, form.name],
  );

  const pick = async (hit) => {
    setForm((f) => ({ ...f, symbol: hit.symbol, name: hit.name, asset_type: hit.assetType ?? f.asset_type, exchange: hit.exchange ?? '', currency: hit.currency ?? f.currency, price_source: 'market' }));
    setQuoteState({ loading: true, message: '', tone: 'ok' });
    try {
      const q = await getQuote(hit.symbol);
      if (!q.ok) throw new Error(q.error || 'No price available');
      if (!CURRENCY_CODES.includes(q.currency)) {
        setQuoteState({ loading: false, tone: 'warn', message: `This instrument trades in ${q.currency}, which isn't supported yet. Choose a supported currency and enter the price manually.` });
        setForm((f) => ({ ...f, price_source: 'manual' }));
        return;
      }
      setForm((f) => ({ ...f, currency: q.currency, current_price: String(q.price), previous_close: q.previousClose, buy_price: f.buy_price || String(q.price) }));
      setQuoteState({ loading: false, tone: 'ok', message: `Latest price ${q.price} ${q.currency} (delayed, from the market-data provider).` });
    } catch (e) {
      setQuoteState({ loading: false, tone: 'warn', message: `Could not fetch a price: ${e.message} You can enter it manually.` });
      setForm((f) => ({ ...f, price_source: 'manual' }));
    }
  };

  const qty = toNumber(form.quantity);
  const unit = isCash ? 1 : toNumber(form.buy_price);
  const fee = form.fees === '' ? 0 : toNumber(form.fees);
  const totalCost = !editing && Number.isFinite(qty) && qty > 0 && Number.isFinite(unit) && unit >= 0 ? qty * unit + (Number.isFinite(fee) ? fee : 0) : null;

  const validate = () => {
    const needsSymbol = form.price_source === 'market' && !isCash;
    const checks = {
      name: required(form.name, 'Name') || (form.name.length > 120 ? 'Name is too long.' : null),
      symbol: needsSymbol || form.symbol ? validSymbol(form.symbol) : null,
      current_price: isCash ? null : positiveNumber(form.current_price, 'Current price', { allowZero: true }),
    };
    if (!editing) {
      checks.portfolio_id = form.portfolio_id ? null : 'Create a portfolio first.';
      checks.quantity = positiveNumber(form.quantity, isCash ? 'Amount' : 'Quantity');
      if (!isCash) checks.buy_price = positiveNumber(form.buy_price, 'Average buy price', { allowZero: true });
      if (form.fees !== '') checks.fees = positiveNumber(form.fees, 'Fees', { allowZero: true });
      checks.date = validDate(form.date, 'Purchase date', { allowFuture: false });
    }
    return collectErrors(checks);
  };

  const submit = async (e) => {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const assetValues = {
        symbol: form.symbol.trim() ? form.symbol.trim() : null,
        name: cleanText(form.name, 120),
        asset_type: form.asset_type,
        currency: form.currency,
        exchange: cleanText(form.exchange, 30) || null,
        sector: cleanText(form.sector, 60) || null,
        price_source: isCash ? 'manual' : form.price_source,
        current_price: isCash ? 1 : toNumber(form.current_price),
        notes: cleanText(form.notes, 500) || null,
      };
      if (editing) {
        await data.mutate(() => assetsSvc.update(asset.id, assetValues), ['assets']);
        toast.success('Asset updated.');
      } else {
        const base = existing ?? existingCash ?? null;
        const payload = {
          ...assetValues,
          previous_close: form.previous_close ?? null,
          price_updated_at: form.price_source === 'market' ? new Date().toISOString() : null,
        };
        await data.mutate(
          () =>
            createAssetWithPosition(data.profile.id, {
              asset: payload,
              existingAsset: base,
              position: { portfolio_id: form.portfolio_id, quantity: toNumber(form.quantity), price: isCash ? 1 : toNumber(form.buy_price), fees: form.fees === '' ? 0 : toNumber(form.fees), date: form.date, notes: cleanText(form.notes, 500) || null },
            }),
          ['assets', 'holdings', 'transactions'],
        );
        toast.success(base ? 'Position added.' : 'Asset added to your portfolio.');
      }
      onClose();
    } catch (err) {
      setFormError(friendlyError(err, 'Could not save the asset.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={editing ? 'Edit asset' : 'Add asset'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="asset-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add asset'}</button>
        </>
      }
    >
      <form id="asset-form" onSubmit={submit} noValidate className="form-grid asset-form">
        <div className="span-2 form-section"><b>01</b><span>Instrument</span><small>Search the market or enter details yourself</small></div>
        {!editing && (
          <div className="span-2">
            <SymbolSearch onSelect={pick} />
            {quoteState.loading && <p className="field-hint" role="status">Fetching price…</p>}
            {!quoteState.loading && quoteState.message && (quoteState.tone === 'warn' ? <InlineNotice tone="warn">{quoteState.message}</InlineNotice> : <p className="field-hint picked-note">{quoteState.message}</p>)}
          </div>
        )}
        <TextField label="Name" value={form.name} onChange={set('name')} error={errors.name} maxLength={120} required />
        <SelectField label="Asset type" value={form.asset_type} onChange={(e) => setForm((f) => ({ ...f, asset_type: e.target.value, price_source: MARKET_PRICEABLE_TYPES.includes(e.target.value) ? f.price_source : 'manual' }))} options={ASSET_TYPES} />
        {!isCash && <TextField label="Symbol" value={form.symbol} onChange={set('symbol')} error={errors.symbol} placeholder="e.g. RELIANCE.NS" hint="Use the provider's symbol; NSE: .NS, BSE: .BO" />}
        {!isCash && <TextField label="Exchange (optional)" value={form.exchange} onChange={set('exchange')} maxLength={30} />}
        {!isCash && <TextField label="Sector (optional)" value={form.sector} onChange={set('sector')} maxLength={60} hint="Enables sector allocation in Analytics." />}

        <div className="span-2 form-section"><b>02</b><span>Pricing</span><small>Currency and how the asset is valued</small></div>
        <SelectField label="Currency" value={form.currency} onChange={set('currency')} options={CURRENCY_CODES} hint="The asset is stored in this currency." disabled={editing && Boolean(data.transactions.some((t) => t.asset_id === asset?.id))} />
        {!isCash && (
          <SelectField
            label="Price source"
            value={form.price_source}
            onChange={set('price_source')}
            options={[{ value: 'market', label: 'Automatic (market data)' }, { value: 'manual', label: 'Manual' }]}
            disabled={!canMarket}
            hint={canMarket ? undefined : 'This asset type is valued manually.'}
          />
        )}
        {!isCash && <TextField label={`Current price${form.price_source === 'market' ? ' (updates automatically)' : ''}`} type="number" inputMode="decimal" step="any" min="0" value={form.current_price} onChange={set('current_price')} error={errors.current_price} />}

        {!editing && (
          <>
            <div className="span-2 form-section"><b>03</b><span>Opening position</span><small>What you hold today</small></div>
            {existing && <div className="span-2"><InlineNotice tone="ok">{existing.name} is already in your assets — this will add a new buy to it.</InlineNotice></div>}
            {existingCash && <div className="span-2"><InlineNotice tone="ok">This cash account exists — the amount will be deposited into it.</InlineNotice></div>}
            <SelectField label="Portfolio" value={form.portfolio_id} onChange={set('portfolio_id')} error={errors.portfolio_id} options={data.portfolios.length ? data.portfolios.map((p) => ({ value: p.id, label: p.name })) : [{ value: '', label: 'No portfolio' }]} />
            <TextField label={isCash ? 'Amount' : 'Quantity'} type="number" inputMode="decimal" step="any" min="0" value={form.quantity} onChange={set('quantity')} error={errors.quantity} required />
            {!isCash && <TextField label="Average buy price" type="number" inputMode="decimal" step="any" min="0" value={form.buy_price} onChange={set('buy_price')} error={errors.buy_price} required />}
            <TextField label="Purchase date" type="date" max={toISODate()} value={form.date} onChange={set('date')} error={errors.date} required />
            {!isCash && <TextField label="Fees (optional)" type="number" inputMode="decimal" step="any" min="0" value={form.fees} onChange={set('fees')} error={errors.fees} />}
            {totalCost !== null && (
              <div className="span-2 cost-line" aria-live="polite">
                <span>Total cost{fee > 0 ? ' (incl. fees)' : ''}</span>
                <strong className="num">{formatMoney(totalCost, form.currency, { maxFraction: 2 })}</strong>
              </div>
            )}
          </>
        )}
        {formError && <p className="form-error span-2" role="alert">{formError}</p>}
      </form>
    </Modal>
  );
}
