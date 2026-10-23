import { useMemo, useState } from 'react';
import { ArrowLeftRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, EmptyState } from '../components/ui/Feedback';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { PortfolioSelector } from '../components/PortfolioBits';
import TransactionFormModal from '../components/TransactionFormModal';
import { transactions as txSvc } from '../services/dataService';
import { TRANSACTION_TYPES } from '../lib/constants';
import { friendlyError } from '../lib/validation';
import { formatDate, formatMoney, formatNumber } from '../lib/format';

const PAGE = 50;

export default function Transactions() {
  const data = useAppData();
  const toast = useToast();
  const [type, setType] = useState('');
  const [assetId, setAssetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [modal, setModal] = useState(null); // 'new' | transaction
  const [deleting, setDeleting] = useState(null);

  const filtered = useMemo(
    () =>
      data.transactions.filter(
        (t) =>
          (!data.portfolioIds || data.portfolioIds.includes(t.portfolio_id)) &&
          (!type || t.type === type) &&
          (!assetId || t.asset_id === assetId) &&
          (!from || t.transaction_date >= from) &&
          (!to || t.transaction_date <= to),
      ),
    [data.transactions, data.portfolioIds, type, assetId, from, to],
  );

  const remove = async () => {
    try {
      await data.mutate(() => txSvc.remove(deleting.id), ['transactions', 'holdings']);
      toast.success('Transaction deleted.');
    } catch (e) {
      throw new Error(friendlyError(e, 'Could not delete the transaction.'), { cause: e });
    }
  };
  const total = (t) => (['DIVIDEND', 'FEE'].includes(t.type) ? Number(t.price) : Number(t.quantity) * Number(t.price));

  return (
    <>
      <PageHeader title="Transactions" subtitle="The ledger behind your holdings" actions={<><PortfolioSelector /><button type="button" className="btn-primary-sm" onClick={() => setModal('new')}><Plus size={16} aria-hidden="true" /> New transaction</button></>} />
      <section className="filters glass-panel" aria-label="Filters">
        <div className="inline-field"><label htmlFor="f-type">Type</label>
          <select id="f-type" className="input input-sm" value={type} onChange={(e) => { setType(e.target.value); setShown(PAGE); }}><option value="">All</option>{TRANSACTION_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="inline-field"><label htmlFor="f-asset">Asset</label>
          <select id="f-asset" className="input input-sm" value={assetId} onChange={(e) => { setAssetId(e.target.value); setShown(PAGE); }}><option value="">All</option>{data.assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="inline-field"><label htmlFor="f-from">From</label><input id="f-from" type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="inline-field"><label htmlFor="f-to">To</label><input id="f-to" type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </section>

      {data.transactions.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transactions yet" text="Record buys, sells, deposits, dividends and fees. Your holdings are calculated from them." action={<button type="button" className="btn-primary" onClick={() => setModal('new')}>Record a transaction</button>} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No matching transactions" text="Try changing or clearing the filters." />
      ) : (
        <section className="panel glass-panel">
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Transactions</caption>
              <thead>
                <tr><th scope="col">Date</th><th scope="col">Type</th><th scope="col">Asset</th><th scope="col" className="num">Qty</th><th scope="col" className="num">Price</th><th scope="col" className="num">Fees</th><th scope="col" className="num">Total</th><th scope="col">Notes</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((t) => {
                  const a = data.assetsById[t.asset_id];
                  const amountOnly = ['DIVIDEND', 'FEE'].includes(t.type);
                  return (
                    <tr key={t.id}>
                      <td>{formatDate(t.transaction_date)}</td>
                      <td><span className={`pill pill-${t.type.toLowerCase()}`}>{t.type}</span></td>
                      <td>{a ? <div className="cell-main"><strong>{a.name}</strong><small>{a.symbol ?? ''}</small></div> : '—'}</td>
                      <td className="num">{amountOnly ? '—' : formatNumber(Number(t.quantity), 6)}</td>
                      <td className="num">{amountOnly || t.type === 'DEPOSIT' || t.type === 'WITHDRAWAL' ? '—' : formatMoney(Number(t.price), t.currency, { maxFraction: 2 })}</td>
                      <td className="num">{Number(t.fees) ? formatMoney(Number(t.fees), t.currency) : '—'}</td>
                      <td className="num"><strong>{formatMoney(total(t), t.currency)}</strong></td>
                      <td className="notes-cell">{t.notes ?? ''}</td>
                      <td className="actions">
                        <button type="button" className="icon-btn" aria-label="Edit transaction" onClick={() => setModal(t)}><Pencil size={16} /></button>
                        <button type="button" className="icon-btn danger" aria-label="Delete transaction" onClick={() => setDeleting(t)}><Trash2 size={16} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > shown && <div className="center-row"><button type="button" className="btn-secondary" onClick={() => setShown((s) => s + PAGE)}>Show more ({filtered.length - shown} left)</button></div>}
        </section>
      )}
      {modal && <TransactionFormModal open onClose={() => setModal(null)} transaction={modal === 'new' ? null : modal} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete transaction?" message="Your holdings will be recalculated without this transaction." confirmLabel="Delete" />
    </>
  );
}
