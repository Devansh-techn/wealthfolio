import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Pencil, Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { usePortfolioValuation } from '../hooks/usePortfolio';
import { PageHeader, StatCard, EmptyState, InlineNotice } from '../components/ui/Feedback';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { PortfolioSelector, PortfolioFormModal, PricesStatus } from '../components/PortfolioBits';
import AssetFormModal from '../components/AssetFormModal';
import TransactionFormModal from '../components/TransactionFormModal';
import { portfolios as pfSvc } from '../services/dataService';
import { ASSET_TYPE_LABELS } from '../lib/constants';
import { friendlyError } from '../lib/validation';
import { formatDate, formatMoney, formatNumber, formatPercent, pnlClass } from '../lib/format';

export default function Portfolio() {
  const data = useAppData();
  const toast = useToast();
  const { currency, format } = useCurrency();
  const { rows, summary } = usePortfolioValuation();
  const [pfModal, setPfModal] = useState(null); // 'new' | portfolio
  const [addOpen, setAddOpen] = useState(false);
  const [txPreset, setTxPreset] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const selected = data.portfolios.find((p) => p.id === data.selectedPortfolioId);

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.valueC ?? 0) - (a.valueC ?? 0)), [rows]);

  const remove = async () => {
    try {
      await data.mutate(() => pfSvc.remove(selected.id), ['portfolios', 'holdings', 'transactions']);
      data.setSelectedPortfolioId('all');
      toast.success('Portfolio deleted.');
    } catch (e) {
      throw new Error(friendlyError(e, 'Could not delete the portfolio.'), { cause: e });
    }
  };

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={selected ? selected.name : 'All portfolios combined'}
        actions={
          <>
            <PortfolioSelector />
            <button type="button" className="btn-secondary btn-sm" onClick={() => setPfModal('new')}><Plus size={14} aria-hidden="true" /> New portfolio</button>
            {selected && (
              <>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setPfModal(selected)}><Pencil size={14} aria-hidden="true" /> Rename</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => setDeleting(true)}><Trash2 size={14} aria-hidden="true" /> Delete</button>
              </>
            )}
            <button type="button" className="btn-primary-sm" onClick={() => setAddOpen(true)} disabled={!data.portfolios.length}><Plus size={16} aria-hidden="true" /> Add asset</button>
          </>
        }
      />
      <PricesStatus />

      {data.portfolios.length === 0 ? (
        <EmptyState icon={Briefcase} title="Create your first portfolio" text="Portfolios group your holdings — for example “Long-term”, “Retirement” or “Trading”." action={<button type="button" className="btn-primary" onClick={() => setPfModal('new')}>Create portfolio</button>} />
      ) : (
        <>
          {summary.incomplete && <InlineNotice tone="warn">{summary.missingCount} holding(s) can’t be converted to {currency} right now and are left out of the totals.</InlineNotice>}
          <section className="stat-grid stat-grid-4" aria-label="Portfolio totals">
            <StatCard label="Current value" value={format(summary.portfolioValue)} />
            <StatCard label="Invested" value={format(summary.investedAmount)} />
            <StatCard label="Unrealized P&L" tone={pnlClass(summary.pnl)} value={`${summary.pnl > 0 ? '+' : ''}${format(summary.pnl)}`} />
            <StatCard label="Return" tone={pnlClass(summary.returnPct)} value={formatPercent(summary.returnPct, { sign: true })} />
          </section>

          {sorted.length === 0 ? (
            <EmptyState icon={Briefcase} title="No investments yet." text="Add an asset to start tracking performance in this portfolio." action={<button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>Add asset</button>} />
          ) : (
            <section className="panel glass-panel" aria-label="Holdings">
              <div className="table-scroll">
                <table className="table">
                  <caption className="sr-only">Holdings in {selected ? selected.name : 'all portfolios'}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Asset</th>
                      <th scope="col" className="num">Qty</th>
                      <th scope="col" className="num">Avg buy</th>
                      <th scope="col" className="num">Price</th>
                      <th scope="col" className="num">Invested</th>
                      <th scope="col" className="num">Value</th>
                      <th scope="col" className="num">P&amp;L</th>
                      <th scope="col" className="num">Return</th>
                      <th scope="col">Since</th>
                      {!selected && <th scope="col">Portfolio</th>}
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">
                          <div className="cell-main"><strong>{r.name}</strong><small>{[r.symbol, ASSET_TYPE_LABELS[r.type], r.currency].filter(Boolean).join(' · ')}</small></div>
                        </th>
                        <td className="num">{formatNumber(r.quantity, 6)}</td>
                        <td className="num">{r.type === 'Cash' ? '—' : formatMoney(r.averageBuyPrice, r.currency, { maxFraction: 2 })}</td>
                        <td className="num">{r.type === 'Cash' ? '—' : formatMoney(r.currentPrice, r.currency, { maxFraction: 2 })}</td>
                        <td className="num">{formatMoney(r.invested, r.currency)}</td>
                        <td className="num"><strong>{formatMoney(r.value, r.currency)}</strong>{r.currency !== currency && r.valueC !== null && <small className="sub">{format(r.valueC)}</small>}</td>
                        <td className={`num ${pnlClass(r.pnl)}`}>{r.type === 'Cash' ? '—' : `${r.pnl > 0 ? '+' : ''}${formatMoney(r.pnl, r.currency)}`}</td>
                        <td className={`num ${pnlClass(r.pnl)}`}>{r.type === 'Cash' ? '—' : formatPercent(r.returnPct, { sign: true })}</td>
                        <td>{formatDate(r.purchaseDate)}</td>
                        {!selected && <td>{data.portfolios.find((p) => p.id === r.portfolioId)?.name}</td>}
                        <td>
                          <button type="button" className="icon-btn" aria-label={`Record a transaction for ${r.name}`} onClick={() => setTxPreset({ asset_id: r.asset.id, portfolio_id: r.portfolioId, type: r.type === 'Cash' ? 'DEPOSIT' : 'BUY' })}><ArrowLeftRight size={16} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <p className="field-hint">Values use the latest saved price. Need to edit an asset’s details or price? Go to <Link to="/assets" className="link-sm">Assets</Link>. Changes to quantity are made with transactions.</p>
        </>
      )}

      {pfModal && <PortfolioFormModal open onClose={() => setPfModal(null)} portfolio={pfModal === 'new' ? null : pfModal} />}
      {addOpen && <AssetFormModal open onClose={() => setAddOpen(false)} defaultCurrency={currency} defaultPortfolioId={selected?.id} />}
      {txPreset && <TransactionFormModal open onClose={() => setTxPreset(null)} preset={txPreset} />}
      <ConfirmDialog open={deleting} onClose={() => setDeleting(false)} onConfirm={remove} title="Delete portfolio?" message={`“${selected?.name}” and all of its holdings and transactions will be permanently deleted. This can’t be undone.`} confirmLabel="Delete portfolio" />
    </>
  );
}
