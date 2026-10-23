import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import Modal from './ui/Modal';
import { TextField } from './ui/Form';
import { InlineNotice } from './ui/Feedback';
import { portfolios as pfSvc } from '../services/dataService';
import { cleanText, friendlyError, required } from '../lib/validation';
import { formatRelativeTime } from '../lib/format';

export function PortfolioSelector({ label = 'Portfolio' }) {
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId } = useAppData();
  return (
    <div className="inline-field">
      <label htmlFor="pf-select">{label}</label>
      <select id="pf-select" className="input input-sm" value={selectedPortfolioId} onChange={(e) => setSelectedPortfolioId(e.target.value)}>
        <option value="all">All portfolios</option>
        {portfolios.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}

export function PricesStatus() {
  const { priceStatus, refreshPrices, assets } = useAppData();
  const hasMarket = assets.some((a) => a.price_source === 'market');
  if (!hasMarket) return null;
  const loading = priceStatus.state === 'loading';
  return (
    <div className="prices-status">
      <button type="button" className="btn-secondary btn-sm" onClick={() => refreshPrices({ force: true })} disabled={loading}>
        <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" /> {loading ? 'Updating…' : 'Refresh prices'}
      </button>
      {priceStatus.updatedAt && <span className="text-body small">Updated {formatRelativeTime(priceStatus.updatedAt)} · delayed data</span>}
      {priceStatus.state === 'error' && <InlineNotice tone="error">{priceStatus.message ?? 'Unable to fetch market data.'} Showing last saved prices.</InlineNotice>}
      {priceStatus.state === 'partial' && <InlineNotice tone="warn">Some prices could not be updated: {priceStatus.errors.slice(0, 3).join('; ')}{priceStatus.errors.length > 3 ? '…' : ''}</InlineNotice>}
    </div>
  );
}

export function PortfolioFormModal({ open, onClose, portfolio = null }) {
  const data = useAppData();
  const toast = useToast();
  const [name, setName] = useState(portfolio?.name ?? '');
  const [description, setDescription] = useState(portfolio?.description ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const err = required(name, 'Name');
    if (err) return setError(err);
    setBusy(true);
    setError('');
    try {
      const values = { name: cleanText(name, 80), description: cleanText(description, 300) || null };
      if (portfolio) await data.mutate(() => pfSvc.update(portfolio.id, values), ['portfolios']);
      else {
        const created = await data.mutate(() => pfSvc.create(data.profile.id, values), ['portfolios']);
        data.setSelectedPortfolioId(created.id);
      }
      toast.success(portfolio ? 'Portfolio renamed.' : 'Portfolio created.');
      onClose();
    } catch (e2) {
      setError(friendlyError(e2, 'Could not save the portfolio.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={portfolio ? 'Rename portfolio' : 'New portfolio'}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="pf-form" className="btn-primary-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="pf-form" onSubmit={submit} noValidate className="form-stack">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={error} data-autofocus required />
        <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      </form>
    </Modal>
  );
}
