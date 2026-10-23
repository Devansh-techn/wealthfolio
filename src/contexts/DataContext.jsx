import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as svc from '../services/dataService';
import { getQuotes, isDemoMode } from '../services/marketDataService';
import { friendlyError } from '../lib/validation';
import { detectCurrency } from '../lib/locale';

const DataContext = createContext(null);
const SELECTED_KEY = 'wf.portfolio';
const PRICE_TTL = 10 * 60 * 1000;

const EMPTY = { portfolios: [], assets: [], holdings: [], transactions: [], watchlist: [], goals: [], income: [], expenses: [], budgets: [], liabilities: [], notifications: [] };


/** Keyed by user id in App.jsx so all state resets automatically on sign-in / sign-out. */
export function AppDataProvider({ user, children }) {
  const userId = user?.id ?? null;
  const [state, setState] = useState({ status: userId ? 'loading' : 'idle', error: null, profile: null, tables: EMPTY });
  const [overlay, setOverlay] = useState({});
  const [priceStatus, setPriceStatus] = useState({ state: 'idle', message: null, errors: [], updatedAt: null });
  const [selected, setSelectedRaw] = useState(() => {
    try {
      return localStorage.getItem(SELECTED_KEY) || 'all';
    } catch {
      return 'all';
    }
  });
  const assetsRef = useRef([]);

  const setSelectedPortfolioId = useCallback((id) => {
    setSelectedRaw(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    try {
      const profile = await svc.ensureProfile(user, detectCurrency());
      const entries = await Promise.all(svc.TABLE_KEYS.map(async (k) => [k, await svc.loaders[k](userId)]));
      setState({ status: 'ready', error: null, profile, tables: Object.fromEntries(entries) });
    } catch (e) {
      setState((s) => ({ ...s, status: 'error', error: friendlyError(e, 'Unable to load your data.') }));
    }
  }, [userId, user]);

  useEffect(() => {
    // Initial fetch; state is only set after the awaited requests resolve.
    loadAll();
  }, [loadAll]);

  const refresh = useCallback(
    async (keys = svc.TABLE_KEYS) => {
      const entries = await Promise.all(keys.map(async (k) => [k, await svc.loaders[k](userId)]));
      setState((s) => ({ ...s, tables: { ...s.tables, ...Object.fromEntries(entries) } }));
    },
    [userId],
  );

  /** Run a mutation, then reload the affected tables so every screen reflects the database. */
  const mutate = useCallback(
    async (fn, keys) => {
      const result = await fn();
      await refresh(keys);
      return result;
    },
    [refresh],
  );

  const updateProfile = useCallback(
    async (patch) => {
      const next = await svc.updateProfile(userId, patch);
      setState((s) => ({ ...s, profile: next }));
      return next;
    },
    [userId],
  );

  // Assets with the freshest prices layered on top (overlay is applied immediately, DB write follows).
  const assets = useMemo(
    () => state.tables.assets.map((a) => (overlay[a.id] ? { ...a, ...overlay[a.id] } : a)),
    [state.tables.assets, overlay],
  );
  const assetsById = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, a])), [assets]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const refreshPrices = useCallback(async ({ force = false } = {}) => {
    const list = assetsRef.current.filter((a) => a.price_source === 'market' && a.symbol);
    const due = force ? list : list.filter((a) => !a.price_updated_at || Date.now() - new Date(a.price_updated_at).getTime() > PRICE_TTL);
    if (!due.length) return;
    setPriceStatus((s) => ({ ...s, state: 'loading', message: null }));
    try {
      const quotes = await getQuotes(due.map((a) => a.symbol), { force });
      const bySymbol = new Map(due.map((a) => [a.symbol, a]));
      const updates = [];
      const errors = [];
      const now = new Date().toISOString();
      for (const q of quotes) {
        const a = bySymbol.get(q.symbol);
        if (!a) continue;
        if (!q.ok) errors.push(`${a.symbol}: ${q.error ?? 'no data'}`);
        else if (q.currency && q.currency !== a.currency) errors.push(`${a.symbol}: market currency ${q.currency} differs from the asset's ${a.currency}`);
        else updates.push({ id: a.id, current_price: q.price, previous_close: q.previousClose, price_updated_at: now });
      }
      if (updates.length) {
        setOverlay((o) => ({ ...o, ...Object.fromEntries(updates.map((u) => [u.id, u])) }));
        if (!isDemoMode) await svc.assets.updatePrices(updates); // demo prices are never persisted
      }
      setPriceStatus({ state: errors.length ? (updates.length ? 'partial' : 'error') : 'ok', message: errors.length && !updates.length ? 'Unable to fetch market data.' : null, errors, updatedAt: now });
    } catch (e) {
      setPriceStatus({ state: 'error', message: friendlyError(e, 'Unable to fetch market data.'), errors: [], updatedAt: null });
    }
  }, []);

  const ready = state.status === 'ready';
  const assetCount = state.tables.assets.length;
  useEffect(() => {
    if (ready && assetCount > 0) refreshPrices();
  }, [ready, assetCount, refreshPrices]);

  const portfolioIds = useMemo(() => {
    if (selected === 'all') return null;
    return state.tables.portfolios.some((p) => p.id === selected) ? [selected] : null;
  }, [selected, state.tables.portfolios]);
  const selectedId = portfolioIds ? portfolioIds[0] : 'all';

  const value = useMemo(
    () => ({
      status: state.status,
      error: state.error,
      reload: loadAll,
      profile: state.profile,
      ...state.tables,
      assets,
      assetsById,
      portfolioIds,
      selectedPortfolioId: selectedId,
      setSelectedPortfolioId,
      refresh,
      mutate,
      updateProfile,
      refreshPrices,
      priceStatus,
      isDemoMode,
    }),
    [state, assets, assetsById, portfolioIds, selectedId, setSelectedPortfolioId, refresh, mutate, updateProfile, refreshPrices, priceStatus, loadAll],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAppData = () => useContext(DataContext);
