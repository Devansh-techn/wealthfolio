import { useState } from 'react';
import { Coins, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, EmptyState } from '../components/ui/Feedback';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { PricesStatus } from '../components/PortfolioBits';
import AssetFormModal from '../components/AssetFormModal';
import { assets as assetsSvc } from '../services/dataService';
import { ASSET_TYPE_LABELS } from '../lib/constants';
import { friendlyError } from '../lib/validation';
import { formatMoney, formatRelativeTime } from '../lib/format';

export default function Assets() {
  const data = useAppData();
  const toast = useToast();
  const { currency } = useCurrency();
  const [modal, setModal] = useState(null); // 'new' | asset
  const [deleting, setDeleting] = useState(null);

  const positions = (id) => data.holdings.filter((h) => h.asset_id === id).length;
  const remove = async () => {
    try {
      await data.mutate(() => assetsSvc.remove(deleting.id), ['assets', 'holdings', 'transactions']);
      toast.success('Asset deleted.');
    } catch (e) {
      throw new Error(friendlyError(e, 'Could not delete the asset.'), { cause: e });
    }
  };

  return (
    <>
      <PageHeader title="Assets" subtitle="Every instrument you track, in its native currency" actions={<button type="button" className="btn-primary-sm" onClick={() => setModal('new')}><Plus size={16} aria-hidden="true" /> Add asset</button>} />
      <PricesStatus />
      {data.assets.length === 0 ? (
        <EmptyState icon={Coins} title="No assets yet" text="Search for a stock, ETF, mutual fund or crypto — or add cash, gold or property manually." action={<button type="button" className="btn-primary" onClick={() => setModal('new')}>Add your first asset</button>} />
      ) : (
        <section className="panel glass-panel">
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Your assets</caption>
              <thead>
                <tr>
                  <th scope="col">Asset</th><th scope="col">Type</th><th scope="col">Currency</th>
                  <th scope="col" className="num">Price</th><th scope="col">Price source</th>
                  <th scope="col" className="num">Positions</th><th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.assets.map((a) => (
                  <tr key={a.id}>
                    <th scope="row"><div className="cell-main"><strong>{a.name}</strong><small>{a.symbol ?? '—'}{a.exchange ? ` · ${a.exchange}` : ''}</small></div></th>
                    <td>{ASSET_TYPE_LABELS[a.asset_type]}</td>
                    <td>{a.currency}</td>
                    <td className="num">{a.asset_type === 'Cash' ? '1 : 1' : formatMoney(Number(a.current_price), a.currency, { maxFraction: 2 })}</td>
                    <td>{a.asset_type === 'Cash' ? '—' : a.price_source === 'market' ? <>Market<small className="sub">{formatRelativeTime(a.price_updated_at)}</small></> : 'Manual'}</td>
                    <td className="num">{positions(a.id)}</td>
                    <td className="actions">
                      <button type="button" className="icon-btn" aria-label={`Edit ${a.name}`} onClick={() => setModal(a)}><Pencil size={16} /></button>
                      <button type="button" className="icon-btn danger" aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {modal && <AssetFormModal open onClose={() => setModal(null)} asset={modal === 'new' ? null : modal} defaultCurrency={currency} />}
      <ConfirmDialog open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} title="Delete asset?" message={`“${deleting?.name}” and every holding and transaction that uses it will be permanently deleted.`} confirmLabel="Delete asset" />
    </>
  );
}
