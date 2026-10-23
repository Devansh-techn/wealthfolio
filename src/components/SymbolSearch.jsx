import { useEffect, useId, useState } from 'react';
import { RotateCw, Search } from 'lucide-react';
import { searchAssets } from '../services/marketDataService';

/** Debounced instrument search against the market-data service (keyboard accessible combobox). */
export default function SymbolSearch({ onSelect, label = 'Search by name or symbol', placeholder = 'e.g. Reliance, TCS.NS, AAPL, parag parikh' }) {
  const id = useId();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState({ q: '', items: [], warnings: [], error: null, attempt: 0 });
  const [cursor, setCursor] = useState(-1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (debounced.length < 2) return undefined;
    let alive = true;
    searchAssets(debounced)
      .then((items) => alive && (setCursor(-1), setResult({ q: debounced, attempt, items, warnings: items.warnings ?? [], error: null })))
      // The message from the service layer is already user-safe (e.g. "Market data is temporarily unavailable.").
      .catch((e) => alive && setResult({ q: debounced, attempt, items: [], warnings: [], error: e?.message || 'Search is unavailable' }));
    return () => {
      alive = false;
    };
  }, [debounced, attempt]);

  const active = debounced.length >= 2;
  const fresh = result.q === debounced && result.attempt === attempt;
  const loading = active && !fresh;
  const shown = active && fresh ? result : { items: [], warnings: [], error: null };

  const choose = (it) => {
    onSelect(it);
    setText('');
    setDebounced('');
    setCursor(-1);
  };
  const onKeyDown = (e) => {
    if (!shown.items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c + 1) % shown.items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c <= 0 ? shown.items.length - 1 : c - 1)); }
    else if (e.key === 'Enter' && cursor >= 0) { e.preventDefault(); choose(shown.items[cursor]); }
    else if (e.key === 'Escape') setCursor(-1);
  };

  return (
    <div className="symbol-search field">
      <label htmlFor={id}>{label}</label>
      <div className="search-input">
        <Search size={16} aria-hidden="true" />
        <input id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={shown.items.length > 0} aria-controls={`${id}-list`} aria-activedescendant={cursor >= 0 ? `${id}-opt-${cursor}` : undefined} />
      </div>
      {loading && <p className="field-hint" role="status">Searching…</p>}
      {shown.error && (
        <p className="field-error search-error" role="alert">
          {shown.error} You can still enter details manually.{' '}
          <button type="button" className="link-sm" onClick={() => setAttempt((n) => n + 1)}><RotateCw size={12} aria-hidden="true" /> Retry</button>
        </p>
      )}
      {shown.warnings.map((w) => <p key={w} className="field-hint search-warning" role="status">{w}</p>)}
      {active && !loading && !shown.error && shown.items.length === 0 && (shown.warnings.length ? <p className="field-hint">Some sources are unavailable, so no match was found. Try again shortly or enter details manually.</p> : <p className="field-hint">No matches. Check the spelling or enter details manually.</p>)}
      {shown.items.length > 0 && (
        <ul className="search-results" id={`${id}-list`} role="listbox" aria-label="Search results">
          {shown.items.map((it, i) => (
            <li key={`${it.symbol}-${it.provider}`} id={`${id}-opt-${i}`} role="option" aria-selected={i === cursor} className={i === cursor ? 'active' : ''}>
              <button type="button" onClick={() => choose(it)} tabIndex={-1}>
                <strong>{it.symbol}</strong>
                <span>{it.name}</span>
                <small>{[it.assetType, it.exchange].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
