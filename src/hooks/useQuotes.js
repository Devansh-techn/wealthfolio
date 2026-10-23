import { useEffect, useMemo, useState } from 'react';
import { getQuotes } from '../services/marketDataService';
import { friendlyError } from '../lib/validation';

/** Live quotes for a list of symbols. status: 'empty' | 'loading' | 'ready' | 'error' */
export function useQuotes(symbols) {
  const [token, setToken] = useState(0);
  const list = useMemo(() => [...new Set(symbols.filter(Boolean))].sort(), [symbols]);
  const key = `${list.join(',')}|${token}`;
  const [res, setRes] = useState({ key: null, map: {}, error: null });

  useEffect(() => {
    if (!list.length) return undefined;
    let alive = true;
    getQuotes(list, { force: token > 0 })
      .then((qs) => alive && setRes({ key, map: Object.fromEntries(qs.map((q) => [q.symbol, q])), error: null }))
      .catch((e) => alive && setRes({ key, map: {}, error: friendlyError(e, 'Unable to fetch market data.') }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const status = !list.length ? 'empty' : res.key !== key ? 'loading' : res.error ? 'error' : 'ready';
  return { status, quotes: res.key === key ? res.map : {}, error: res.error, reload: () => setToken((t) => t + 1) };
}
