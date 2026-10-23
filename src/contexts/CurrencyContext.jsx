import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAppData } from './DataContext';
import { detectCurrency } from '../lib/locale';
import { getRates } from '../services/currencyService';
import { convert } from '../lib/fx';
import { formatMoney } from '../lib/format';
import { CURRENCY_CODES } from '../lib/constants';

const CurrencyContext = createContext(null);
const LOCAL_KEY = 'wf.currency';

export function CurrencyProvider({ children }) {
  const { profile, updateProfile } = useAppData();
  const [local, setLocal] = useState(() => {
    try {
      const v = localStorage.getItem(LOCAL_KEY);
      return CURRENCY_CODES.includes(v) ? v : detectCurrency();
    } catch {
      return detectCurrency();
    }
  });
  const [fxState, setFxState] = useState({ fx: null, status: 'loading', stale: false, error: null });

  const currency = profile?.preferred_currency ?? local;

  const loadFx = useCallback((force = false) => {
    let alive = true;
    getRates({ force }).then((r) => {
      if (!alive) return;
      setFxState({ fx: r.fx, status: r.fx ? 'ready' : 'error', stale: r.stale, error: r.error });
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => loadFx(false), [loadFx]);

  const setCurrency = useCallback(
    async (code) => {
      if (!CURRENCY_CODES.includes(code)) return;
      setLocal(code);
      try {
        localStorage.setItem(LOCAL_KEY, code);
      } catch {
        /* ignore */
      }
      if (profile) await updateProfile({ preferred_currency: code }); // persisted to the user's profile
    },
    [profile, updateProfile],
  );

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      fx: fxState.fx,
      fxStatus: fxState.status,
      fxStale: fxState.stale,
      fxError: fxState.error,
      retryFx: () => {
        setFxState((s) => ({ ...s, status: 'loading' }));
        loadFx(true);
      },
      /** Convert from a native currency into the display currency (null if no rate). */
      toDisplay: (amount, from) => convert(amount, from, currency, fxState.fx),
      /** Format a number that is ALREADY in the display currency. */
      format: (value2, opts) => formatMoney(value2, currency, opts),
      /** Format an amount in its own native currency. */
      formatNative: (value2, cur, opts) => formatMoney(value2, cur, opts),
    }),
    [currency, setCurrency, fxState, loadFx],
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useCurrency = () => useContext(CurrencyContext);
