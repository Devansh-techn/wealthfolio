import { useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw, Trash2 } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, EmptyState, InlineNotice, Skeleton, Disclaimer } from '../components/ui/Feedback';
import SymbolSearch from '../components/SymbolSearch';
import { useQuotes } from '../hooks/useQuotes';
import { getFundamentals, getQuote } from '../services/marketDataService';
import { watchlist as wlSvc } from '../services/dataService';
import { CURRENCY_CODES } from '../lib/constants';
import { friendlyError } from '../lib/validation';
import { formatMoney, formatPercent, pnlClass } from '../lib/format';

const MAX_ITEMS = 50;

function useFundamentals(symbols, enabled) {
  const list = useMemo(() => symbols.filter((s) => !s.startsWith('AMFI:')), [symbols]);
  const key = `${enabled}|${list.join(',')}`;
  const [res, setRes] = useState({ key: null, map: {}, error: null });
  // Fetch only when the user opts in (fundamentals are a heavier provider call).
  useEffect(() => {
    if (!enabled || !list.length) return undefined;
    let alive = true;
    getFundamentals(list)
      .then((items) => alive && setRes({ key, map: Object.fromEntries(items.filter((i) => i.ok).map((i) => [i.symbol, i.data])), error: null }))
      .catch((e) => alive && setRes({ key, map: {}, error: friendlyError(e, 'Metrics unavailable.') }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const status = !enabled ? 'off' : res.key !== key ? 'loading' : res.error ? 'error' : 'ready';
  return { status, map: res.key === key ? res.map : {}, error: res.error };
}
export default function Watchlist() {
  const data = useAppData();
  const toast = useToast();
  const [metrics, setMetrics] = useState(false);
  const [adding, setAdding] = useState(false);
  const symbols = useMemo(() => data.watchlist.map((w) => w.symbol), [data.watchlist]);
  const q = useQuotes(symbols);
  const f = useFundamentals(symbols, metrics);

  const add = async (hit) => {
    if (data.watchlist.some((w) => w.symbol === hit.symbol)) return toast.info(`${hit.symbol} is already on your watchlist.`);
    if (data.watchlist.length >= MAX_ITEMS) return toast.error(`Your watchlist is limited to ${MAX_ITEMS} symbols.`);
    setAdding(true);
    try {
      let currency = hit.currency ?? null;
      if (!currency) {
        const quote = await getQuote(hit.symbol).catch(() => null);
        if (quote?.ok && CURRENCY_CODES.includes(quote.currency)) currency = quote.currency;
      }
      await data.mutate(() => wlSvc.create(data.profile.id, { symbol: hit.symbol, name: hit.name, exchange: hit.exchange ?? null, currency }), ['watchlist']);
      toast.success(`${hit.symbol} added.`);
    } catch (e) {
      toast.error(friendlyError(e, 'Could not add to the watchlist.'));
    } finally {
      setAdding(false);
    }
  };
  const remove = async (w) => {
    try {
      await data.mutate(() => wlSvc.remove(w.id), ['watchlist']);
      toast.success(`${w.symbol} removed.`);
    } catch (e) {
      toast.error(friendlyError(e, 'Could not remove.'));
    }
  };

  return (
    <>
      <PageHeader title="Watchlist" subtitle="Keep an eye on securities you don’t own yet" actions={
        <>
          <label className="check-inline"><input type="checkbox" checked={metrics} onChange={(e) => setMetrics(e.target.checked)} /> Show fundamentals</label>
          <button type="button" className="btn-secondary btn-sm" onClick={q.reload} disabled={q.status === 'loading' || !symbols.length}><RefreshCw size={14} className={q.status === 'loading' ? 'spin' : ''} aria-hidden="true" /> Refresh</button>
        </>} />
      <section className="panel glass-panel" aria-label="Add to watchlist">
        <SymbolSearch onSelect={add} label={adding ? 'Adding…' : 'Add a symbol'} />
      </section>
      {q.status === 'error' && <InlineNotice tone="error">{q.error ?? 'Unable to fetch market data.'}</InlineNotice>}
      {f.status === 'error' && <InlineNotice tone="warn">{f.error}</InlineNotice>}

      {data.watchlist.length === 0 ? (
        <EmptyState icon={Eye} title="Your watchlist is empty" text="Search above to add stocks, ETFs, funds or crypto." />
      ) : (
        <section className="panel glass-panel">
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Watchlist</caption>
              <thead>
                <tr><th scope="col">Symbol</th><th scope="col" className="num">Price</th><th scope="col" className="num">Change</th><th scope="col" className="num">Change %</th><th scope="col" className="num">52-wk range</th>
                  {metrics && <><th scope="col" className="num">Mkt cap</th><th scope="col" className="num">P/E</th><th scope="col" className="num">Div. yield</th><th scope="col" className="num">ROE</th></>}
                  <th scope="col"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {data.watchlist.map((w) => {
                  const quote = q.quotes[w.symbol];
                  const ok = quote?.ok;
                  const chg = ok && quote.previousClose != null ? quote.price - quote.previousClose : null;
                  const pct = chg !== null && quote.previousClose ? (chg / quote.previousClose) * 100 : null;
                  const fu = f.map[w.symbol];
                  return (
                    <tr key={w.id}>
                      <th scope="row"><div className="cell-main"><strong>{w.symbol}</strong><small>{w.name}</small></div></th>
                      <td className="num">{q.status === 'loading' ? <Skeleton width={70} height={16} /> : ok ? formatMoney(quote.price, quote.currency, { maxFraction: 2 }) : <small>Unavailable</small>}</td>
                      <td className={`num ${pnlClass(chg)}`}>{chg === null ? '—' : `${chg > 0 ? '+' : ''}${formatMoney(chg, quote.currency, { maxFraction: 2 })}`}</td>
                      <td className={`num ${pnlClass(pct)}`}>{pct === null ? '—' : formatPercent(pct, { sign: true })}</td>
                      <td className="num">{ok && quote.low52 != null && quote.high52 != null ? `${formatMoney(quote.low52, quote.currency, { maxFraction: 2 })} – ${formatMoney(quote.high52, quote.currency, { maxFraction: 2 })}` : '—'}</td>
                      {metrics && (
                        <>
                          <td className="num">{f.status === 'loading' ? '…' : fu?.marketCap ? formatMoney(fu.marketCap, quote?.currency ?? w.currency ?? 'USD', { compact: true }) : 'n/a'}</td>
                          <td className="num">{f.status === 'loading' ? '…' : fu?.pe != null ? fu.pe.toFixed(1) : 'n/a'}</td>
                          <td className="num">{f.status === 'loading' ? '…' : fu?.dividendYield != null ? formatPercent(fu.dividendYield) : 'n/a'}</td>
                          <td className="num">{f.status === 'loading' ? '…' : fu?.roe != null ? formatPercent(fu.roe) : 'n/a'}</td>
                        </>
                      )}
                      <td className="actions"><button type="button" className="icon-btn danger" aria-label={`Remove ${w.symbol}`} onClick={() => remove(w)}><Trash2 size={16} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Disclaimer />
    </>
  );
}
