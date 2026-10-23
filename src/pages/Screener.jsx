import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Download, Filter, Play, Plus, RotateCcw } from 'lucide-react';
import { useAppData } from '../contexts/DataContext';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, EmptyState, InlineNotice, Disclaimer, ProgressBar, Spinner } from '../components/ui/Feedback';
import Modal from '../components/ui/Modal';
import { Field } from '../components/ui/Form';
import { getScreenerMetrics } from '../services/marketDataService';
import { invokeFunction } from '../services/functions';
import { loadScreenerResult, saveScreenerResult, watchlist as wlSvc } from '../services/dataService';
import { technicalMetrics } from '../lib/indicators';
import { applyFilters, buildMetrics, explainScores, FILTERS, MA_OPTIONS, PILLAR_LABELS, PILLAR_WEIGHTS, scoreSecurity } from '../lib/scoring';
import { UNIVERSES } from '../lib/universes';
import { fetchIntelligence } from '../services/intelligenceService';
import { blendIntelligence, CONFIDENCE_LABEL, ESTIMATE_NOTE, EXCLUDED_COPY, FACTOR_NOTE, fmtPct, fmtProb, fmtSignedPct, INTELLIGENCE_CONFIG, ML_STATUS_COPY, PREDICTION_STATUS_COPY, RISK_LABEL } from '../lib/intelligence';
import { SYMBOL_RE, friendlyError } from '../lib/validation';
import { formatMoney, formatNumber, formatPercent, formatRelativeTime } from '../lib/format';

const BATCH = 12;
const fmtN = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d));
const scoreTone = (s) => (s === null ? '' : s >= 70 ? 'sc-hi' : s >= 45 ? 'sc-mid' : 'sc-lo');
const ScoreCell = ({ v }) => <td className={`num score ${scoreTone(v)}`}>{v === null ? 'n/a' : v.toFixed(0)}</td>;

const SORTS = [['overall', 'Overall'], ['intelligence', 'Intelligence'], ['fundamental', 'Fundamental'], ['technical', 'Technical'], ['momentum', 'Momentum'], ['risk', 'Risk']];

const CONF_COMPONENT_LABELS = { data_completeness: 'Data completeness', history_depth: 'History depth', training_size: 'Training data size', model_quality: 'Held-out model quality', model_agreement: 'Agreement between models', in_distribution: 'Inputs within training range', prediction_stability: 'Stability over recent days' };
const NO_INTEL = { mlStatus: 'unavailable', model: null, predictions: {}, forKey: null };
const sortValue = (r, key) => (key === 'intelligence' ? r.intel?.score : r.scores[key]);

function IntelligenceSection({ intel, prediction, mlState, scores }) {
  const w = intel.weights;
  const wTotal = w.rule + w.ml;
  const evidence = mlState.model?.evidence;
  const ok = prediction?.status === 'ok';
  return (
    <section className="intel-box" aria-label="WealthFolio Intelligence">
      <div className="intel-head">
        <div>
          <small>WealthFolio Intelligence</small>
          <strong className={scoreTone(intel.score)}>{intel.score === null ? 'n/a' : intel.score.toFixed(0)}<span> / 100</span></strong>
        </div>
        <p className="field-hint">{intel.mlIncluded ? `${Math.round((w.rule / wTotal) * 100)}% rule-based score + ${Math.round((w.ml / wTotal) * 100)}% ML signal (weights are configurable and recorded with each model version).` : EXCLUDED_COPY[intel.excludedBecause] ?? 'Rule-based only.'}</p>
      </div>
      <ul className="intel-components" aria-label="Score components">
        {[['Fundamental', scores.fundamental], ['Technical', scores.technical], ['Momentum', scores.momentum], ['Risk', scores.risk], ['ML signal', intel.ml]].map(([label, v]) => (
          <li key={label}><small>{label}</small><strong className={scoreTone(v ?? null)}>{v === null || v === undefined ? 'n/a' : Math.round(v)}</strong></li>
        ))}
      </ul>
      {mlState.mlStatus !== 'ok' && <p className="field-hint">{ML_STATUS_COPY[mlState.mlStatus]}</p>}
      {mlState.mlStatus === 'ok' && !ok && <p className="field-hint">{PREDICTION_STATUS_COPY[prediction?.status] ?? PREDICTION_STATUS_COPY.unavailable}{prediction?.detail ? ` (${prediction.detail})` : ''}</p>}
      {ok && (
        <>
          <h3 className="mini-title">Model estimates <small className="mini-note">not guarantees</small></h3>
          <dl className="kv">
            <dt>Chance of a positive 3-month return</dt><dd>{fmtProb(prediction.positive3mProbability)}</dd>
            <dt>Chance of a positive 6-month return</dt><dd>{fmtProb(prediction.positive6mProbability)}</dd>
            {prediction.expected3mReturn !== null && <><dt>Expected 3-month return (estimate)</dt><dd>{fmtSignedPct(prediction.expected3mReturn)}</dd></>}
            {prediction.expected6mReturn !== null && <><dt>Expected 6-month return (estimate)</dt><dd>{fmtSignedPct(prediction.expected6mReturn)}</dd></>}
            {prediction.expectedVolatility3m !== null && <><dt>Expected volatility (annualised)</dt><dd>{fmtPct(prediction.expectedVolatility3m)}</dd></>}
            {prediction.expectedDrawdown3m !== null && <><dt>Expected worst dip over 3 months</dt><dd>{fmtSignedPct(prediction.expectedDrawdown3m, 0)}</dd></>}
            <dt>Risk level{prediction.riskSource === 'rule' ? ' (rule-based)' : ''}</dt><dd>{RISK_LABEL[prediction.riskLevel] ?? 'Unknown'}</dd>
            <dt>Model confidence</dt><dd><span className={`conf conf-${prediction.confidenceLabel}`}>{CONFIDENCE_LABEL[prediction.confidenceLabel] ?? 'n/a'}</span></dd>
            <dt>Estimate date · model</dt><dd>{prediction.predictionDate} · {prediction.modelVersion}</dd>
          </dl>
          {prediction.stale && <p className="field-hint">This estimate is older than {10} days.</p>}
          {(prediction.topPositiveFactors.length > 0 || prediction.topNegativeFactors.length > 0) && (
            <div className="grid-2 tight">
              <div><h4 className="mini-sub pos">Raised the estimate</h4><ul className="bullets">{prediction.topPositiveFactors.map((f) => <li key={f.feature}>{f.label}: {f.valueText}</li>)}</ul></div>
              <div><h4 className="mini-sub neg">Lowered the estimate</h4><ul className="bullets">{prediction.topNegativeFactors.map((f) => <li key={f.feature}>{f.label}: {f.valueText}</li>)}</ul></div>
            </div>
          )}
          <p className="field-hint">{FACTOR_NOTE}</p>
          {evidence && (
            <p className="field-hint">Held-out test evidence for the 3-month model: ROC-AUC {evidence.rocAuc == null ? 'n/a' : evidence.rocAuc.toFixed(3)} vs {evidence.baselineRocAuc == null ? 'n/a' : evidence.baselineRocAuc.toFixed(3)} for the rule-score baseline; calibration error {evidence.ece == null ? 'n/a' : evidence.ece.toFixed(3)}. Trained on data through {mlState.model.trainingEnd}.</p>
          )}
          <details className="breakdown">
            <summary>How the confidence level is built</summary>
            <ul className="bullets">{Object.entries(prediction.confidenceComponents ?? {}).map(([k, v]) => <li key={k}>{CONF_COMPONENT_LABELS[k] ?? k}: {Math.round(v * 100)}%</li>)}</ul>
            <p className="field-hint">Confidence reflects data quality, model evidence and stability. It is not the probability that the estimate is right.</p>
          </details>
        </>
      )}
      <p className="field-hint">{ESTIMATE_NOTE}</p>
    </section>
  );
}

function StockDetail({ row, onClose, onWatch, watched, intel, prediction, mlState }) {
  const [ai, setAi] = useState({ state: 'idle', text: '', error: '' });
  const exp = useMemo(() => explainScores(row.metrics, row.scores), [row]);
  const m = row.metrics;
  const explain = async () => {
    setAi({ state: 'loading', text: '', error: '' });
    try {
      const metrics = Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object'));
      const r = await invokeFunction('explain-stock', { symbol: row.symbol, name: row.name, metrics, scores: { overall: row.scores.overall, rule: row.scores.overall, ...(intel?.score != null ? { intelligence: intel.score } : {}), fundamental: row.scores.fundamental, technical: row.scores.technical, momentum: row.scores.momentum, risk: row.scores.risk, coverage: row.scores.coverage } });
      setAi({ state: 'done', text: r.explanation, error: '' });
    } catch (e) {
      setAi({ state: 'error', text: '', error: e.status === 501 ? 'AI explanations are not enabled on this deployment. The rule-based explanation above is always available.' : friendlyError(e, 'AI explanation is unavailable right now.') });
    }
  };
  return (
    <Modal open onClose={onClose} title={`${row.name ?? row.symbol} (${row.symbol})`} size="lg"
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Close</button><button type="button" className="btn-secondary" onClick={onWatch} disabled={watched}>{watched ? 'On watchlist' : 'Add to watchlist'}</button></>}>
      <p className="text-body">{exp.headline}</p>
      {intel && <IntelligenceSection intel={intel} prediction={prediction} mlState={mlState} scores={row.scores} />}
      <div className="score-grid">
        {Object.entries(PILLAR_LABELS).map(([k, label]) => (
          <div key={k} className="score-box">
            <small>{label} · {PILLAR_WEIGHTS[k]}%</small>
            <strong className={scoreTone(row.scores[k])}>{row.scores[k] === null ? 'n/a' : row.scores[k].toFixed(0)}</strong>
            <ProgressBar value={row.scores[k] ?? 0} tone={row.scores[k] >= 70 ? 'green' : row.scores[k] >= 45 ? 'gold' : 'red'} label={label} />
          </div>
        ))}
      </div>
      <div className="grid-2 tight">
        <div>
          <h3 className="mini-title">Why it scored this way</h3>
          {exp.strengths.length > 0 && <><h4 className="mini-sub pos">Supporting</h4><ul className="bullets">{exp.strengths.map((s) => <li key={s}>{s}</li>)}</ul></>}
          {exp.weaknesses.length > 0 && <><h4 className="mini-sub neg">Weighing on the score</h4><ul className="bullets">{exp.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul></>}
          {exp.missing.length > 0 && <p className="field-hint">Data not available from the provider: {exp.missing.join(', ')}. These are skipped, not estimated.</p>}
        </div>
        <div>
          <h3 className="mini-title">Key metrics</h3>
          <dl className="kv">
            <dt>Price</dt><dd>{formatMoney(m.price, row.currency, { maxFraction: 2 })}</dd>
            <dt>Market cap</dt><dd>{m.marketCap ? formatMoney(m.marketCap, row.currency, { compact: true }) : 'n/a'}</dd>
            <dt>P/E</dt><dd>{fmtN(m.pe)}</dd>
            <dt>EPS growth</dt><dd>{m.epsGrowth == null ? 'n/a' : formatPercent(m.epsGrowth)}</dd>
            <dt>Revenue growth</dt><dd>{m.revenueGrowth == null ? 'n/a' : formatPercent(m.revenueGrowth)}</dd>
            <dt>ROE</dt><dd>{m.roe == null ? 'n/a' : formatPercent(m.roe)}</dd>
            <dt>ROCE</dt><dd>{m.roce == null ? 'n/a (not provided)' : formatPercent(m.roce)}</dd>
            <dt>Debt / equity</dt><dd>{fmtN(m.debtToEquity, 2)}</dd>
            <dt>Dividend yield</dt><dd>{m.dividendYield == null ? 'n/a' : formatPercent(m.dividendYield)}</dd>
            <dt>RSI (14)</dt><dd>{fmtN(m.rsi14, 0)}</dd>
            <dt>50 / 200-day avg</dt><dd>{fmtN(m.sma50, 2)} / {fmtN(m.sma200, 2)}</dd>
            <dt>Momentum 1m / 3m / 6m</dt><dd>{fmtN(m.momentum1m)}% / {fmtN(m.momentum3m)}% / {fmtN(m.momentum6m)}%</dd>
            <dt>Volatility (ann.)</dt><dd>{m.volatility == null ? 'n/a' : formatPercent(m.volatility)}</dd>
            <dt>Max drawdown (1y)</dt><dd>{m.maxDrawdown1y == null ? 'n/a' : formatPercent(m.maxDrawdown1y)}</dd>
            <dt>Avg volume (20d)</dt><dd>{m.avgVolume20 ? formatNumber(Math.round(m.avgVolume20), 0) : 'n/a'}</dd>
          </dl>
        </div>
      </div>
      <details className="breakdown">
        <summary>Score breakdown by component</summary>
        {Object.entries(row.scores.pillars).map(([k, p]) => (
          <div key={k}>
            <h4 className="mini-sub">{PILLAR_LABELS[k]} — data coverage {p.coverage.toFixed(0)}%</h4>
            <ul className="bullets">{p.components.map((c) => <li key={c.key}>{c.label} (weight {c.weight}): {c.score === null ? 'no data' : c.score.toFixed(0)}</li>)}</ul>
          </div>
        ))}
      </details>
      <div className="ai-box">
        <button type="button" className="btn-secondary btn-sm" onClick={explain} disabled={ai.state === 'loading'}><Bot size={14} aria-hidden="true" /> {ai.state === 'loading' ? 'Generating…' : 'Explain with AI'}</button>
        {ai.state === 'done' && <div className="ai-text"><p>{ai.text}</p><small>AI-generated from the metrics above only. It can make mistakes — check the numbers.</small></div>}
        {ai.state === 'error' && <p className="field-hint">{ai.error}</p>}
      </div>
      <Disclaimer />
    </Modal>
  );
}

export default function Screener() {
  const data = useAppData();
  const toast = useToast();
  const [universeId, setUniverseId] = useState('in-largecap');
  const [custom, setCustom] = useState('');
  const [filters, setFilters] = useState({});
  const [ma, setMa] = useState('');
  const [sortKey, setSortKey] = useState('overall');
  const [showFilters, setShowFilters] = useState(false);
  const [scan, setScan] = useState({ state: 'idle', done: 0, total: 0, failed: [], error: '' });
  const [stored, setStored] = useState({ universe: null, rows: [], runAt: null });
  const [loadedFor, setLoadedFor] = useState(null);
  const [detail, setDetail] = useState(null);
  const [intelState, setIntelState] = useState(NO_INTEL);
  const cancel = useRef(false);

  const universe = UNIVERSES.find((u) => u.id === universeId);

  // Load the last saved scan for this universe.
  useEffect(() => {
    let alive = true;
    loadScreenerResult(data.profile.id, universeId)
      .then((r) => {
        if (!alive) return;
        setStored({ universe: universeId, rows: r?.results ?? [], runAt: r?.run_at ?? null });
        setLoadedFor(universeId);
      })
      .catch(() => alive && setLoadedFor(universeId));
    return () => {
      alive = false;
    };
  }, [data.profile.id, universeId]);

  // ML layer: fetched AFTER the rule-based table is already usable, and never blocks it. Any failure => rule-based only.
  useEffect(() => {
    if (stored.universe !== universeId || !stored.rows.length) return undefined;
    let alive = true;
    const key = `${universeId}|${stored.runAt}`;
    fetchIntelligence(stored.rows.map((r) => r.symbol)).then((r) => alive && setIntelState({ ...r, forKey: key }));
    return () => {
      alive = false;
    };
  }, [stored, universeId]);
  // Only ever use ML output that belongs to the scan currently on screen.
  const intel = intelState.forKey === `${universeId}|${stored.runAt}` ? intelState : NO_INTEL;

  const scored = useMemo(
    () => (stored.universe === universeId ? stored.rows : []).map((r) => ({ ...r, scores: scoreSecurity(r.metrics) })),
    [stored, universeId],
  );
  const withIntel = useMemo(
    () => scored.map((r) => ({ ...r, intel: blendIntelligence(r.scores.overall, intel.predictions?.[r.symbol] ?? null, intel.model) })),
    [scored, intel],
  );
  const results = useMemo(() => {
    const f = applyFilters(withIntel, filters, ma);
    return [...f].sort((a, b) => (sortValue(b, sortKey) ?? -1) - (sortValue(a, sortKey) ?? -1));
  }, [withIntel, filters, ma, sortKey]);

  const symbolsToScan = () => {
    if (universeId !== 'custom') return { symbols: universe.symbols, error: '' };
    const list = [...new Set(custom.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (!list.length) return { symbols: [], error: 'Enter at least one symbol.' };
    if (list.length > 36) return { symbols: [], error: 'Custom scans are limited to 36 symbols.' };
    const bad = list.find((s) => !SYMBOL_RE.test(s) || s.startsWith('AMFI:'));
    if (bad) return { symbols: [], error: `“${bad}” is not a valid symbol.` };
    return { symbols: list, error: '' };
  };

  const run = async () => {
    const { symbols, error } = symbolsToScan();
    if (error) return setScan((s) => ({ ...s, state: 'error', error }));
    cancel.current = false;
    setScan({ state: 'running', done: 0, total: symbols.length, failed: [], error: '' });
    const rows = [];
    const failed = [];
    try {
      for (let i = 0; i < symbols.length; i += BATCH) {
        if (cancel.current) break;
        const batch = symbols.slice(i, i + BATCH);
        const out = await getScreenerMetrics(batch);
        for (const r of out) {
          if (!r.ok) {
            failed.push(`${r.symbol}: ${r.error ?? 'unavailable'}`);
            continue;
          }
          const tech = technicalMetrics(r.closes, r.volumes);
          if (!tech) {
            failed.push(`${r.symbol}: not enough price history`);
            continue;
          }
          rows.push({ symbol: r.symbol, name: r.name ?? r.symbol, currency: r.currency, exchange: r.exchange, lastDate: r.lastDate, metrics: buildMetrics(r.fundamentals, tech), fundamentalsMissing: !r.fundamentals });
        }
        setScan((s) => ({ ...s, done: Math.min(i + BATCH, symbols.length) }));
      }
      if (!rows.length) throw new Error(failed.length ? 'No data could be retrieved. The market-data provider may be unavailable.' : 'No results.');
      const runAt = new Date().toISOString();
      setStored({ universe: universeId, rows, runAt });
      setScan({ state: 'done', done: symbols.length, total: symbols.length, failed, error: '' });
      saveScreenerResult(data.profile.id, universeId, { filters, ma }, rows).catch(() => toast.info('Results shown, but could not be saved for next time.'));
    } catch (e) {
      setScan({ state: 'error', done: 0, total: symbols.length, failed, error: friendlyError(e, 'Unable to fetch market data.') });
    }
  };

  const watch = async (row) => {
    try {
      await data.mutate(() => wlSvc.create(data.profile.id, { symbol: row.symbol, name: row.name, exchange: row.exchange, currency: ['INR', 'USD', 'EUR', 'GBP'].includes(row.currency) ? row.currency : null }), ['watchlist']);
      toast.success(`${row.symbol} added to your watchlist.`);
    } catch (e) {
      toast.error(friendlyError(e, 'Could not add to the watchlist.'));
    }
  };
  const watchedSet = useMemo(() => new Set(data.watchlist.map((w) => w.symbol)), [data.watchlist]);
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const activeFilters = Object.values(filters).filter((v) => v !== '' && v != null).length + (ma ? 1 : 0);

  const exportCsv = () => {
    const head = ['Symbol', 'Name', 'Overall', 'Fundamental', 'Technical', 'Momentum', 'Risk', 'Price', 'PE', 'RSI14', 'Intelligence', 'ML P(+3m)', 'ML confidence'];
    const lines = results.map((r) => [r.symbol, `"${(r.name ?? '').replace(/"/g, '""')}"`, ...['overall', 'fundamental', 'technical', 'momentum', 'risk'].map((k) => fmtN(r.scores[k], 0)), fmtN(r.metrics.price, 2), fmtN(r.metrics.pe), fmtN(r.metrics.rsi14, 0), fmtN(r.intel?.score, 0), r.intel?.mlIncluded || intel.predictions?.[r.symbol]?.status === 'ok' ? fmtProb(intel.predictions[r.symbol].positive3mProbability) : 'n/a', intel.predictions?.[r.symbol]?.confidenceLabel ?? 'n/a'].join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wealthfolio-screener-${universeId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const running = scan.state === 'running';
  return (
    <>
      <PageHeader title="AI Screener" subtitle="Rank securities with transparent rule-based scores, plus validated machine-learning estimates where available" />
      <InlineNotice tone="ok">Scores summarise the data shown; they are not recommendations. ML figures are model estimates from historical data, never guarantees. AI only explains stored numbers and never supplies them.</InlineNotice>

      <section className="panel glass-panel" aria-label="Scan setup">
        <div className="scan-bar">
          <div className="inline-field"><label htmlFor="uni">Universe</label>
            <select id="uni" className="input input-sm" value={universeId} onChange={(e) => { setUniverseId(e.target.value); setScan({ state: 'idle', done: 0, total: 0, failed: [], error: '' }); }} disabled={running}>
              {UNIVERSES.map((u) => <option key={u.id} value={u.id}>{u.label}{u.symbols.length ? ` (${u.symbols.length})` : ''}</option>)}
            </select></div>
          <button type="button" className="btn-primary-sm" onClick={run} disabled={running}><Play size={16} aria-hidden="true" /> {running ? 'Scanning…' : 'Run scan'}</button>
          {running && <button type="button" className="btn-ghost btn-sm" onClick={() => { cancel.current = true; }}>Stop</button>}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}><Filter size={14} aria-hidden="true" /> Filters{activeFilters ? ` (${activeFilters})` : ''}</button>
          {results.length > 0 && <button type="button" className="btn-secondary btn-sm" onClick={exportCsv}><Download size={14} aria-hidden="true" /> CSV</button>}
        </div>
        {universeId === 'custom' && (
          <Field label="Symbols (comma or space separated, up to 36)" hint="Use provider symbols, e.g. INFY.NS, MSFT, VOD.L">
            {(p) => <textarea className="input" rows={2} {...p} value={custom} onChange={(e) => setCustom(e.target.value)} />}
          </Field>
        )}
        {universeId !== 'custom' && <p className="field-hint">Curated symbol list, not an official index. Verify membership with the exchange.</p>}
        {running && (
          <div className="scan-progress" role="status"><Spinner label="Scanning" /> <span>Fetching {scan.done}/{scan.total}…</span><ProgressBar value={scan.total ? (scan.done / scan.total) * 100 : 0} label="Scan progress" /></div>
        )}
        {scan.state === 'error' && <p className="form-error" role="alert">{scan.error}</p>}
        {scan.failed.length > 0 && scan.state === 'done' && <p className="field-hint">{scan.failed.length} symbol(s) skipped: {scan.failed.slice(0, 4).join('; ')}{scan.failed.length > 4 ? '…' : ''}</p>}

        {showFilters && (
          <div className="filter-grid">
            {FILTERS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`f-${f.key}`}>{f.label}</label>
                <input id={`f-${f.key}`} className="input input-sm" type="number" step={f.step} value={filters[f.key] ?? ''} onChange={setF(f.key)} />
              </div>
            ))}
            <div className="field span-2"><label htmlFor="f-ma">Moving average</label>
              <select id="f-ma" className="input input-sm" value={ma} onChange={(e) => setMa(e.target.value)}>{MA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div className="field"><label htmlFor="f-sort">Sort by</label>
              <select id="f-sort" className="input input-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l} score</option>)}</select></div>
            <div className="field"><label>&nbsp;</label><button type="button" className="btn-ghost btn-sm" onClick={() => { setFilters({}); setMa(''); }}><RotateCcw size={14} aria-hidden="true" /> Reset</button></div>
            <p className="field-hint span-all">Securities with missing data for an active filter are excluded rather than guessed.</p>
          </div>
        )}
      </section>

      {loadedFor !== universeId ? (
        <div className="center-row"><Spinner label="Loading last scan" /></div>
      ) : scored.length === 0 ? (
        <EmptyState icon={Play} title="No scan yet" text="Run a scan to fetch real prices and fundamentals and rank the universe. This can take up to a minute." action={<button type="button" className="btn-primary" onClick={run} disabled={running}>Run scan</button>} />
      ) : (
        <section className="panel glass-panel" aria-label="Results">
          <div className="panel-head">
            <h2 className="panel-title">{results.length} of {scored.length} securities</h2>
            <small className="text-body">Data from {formatRelativeTime(stored.runAt)} · delayed</small>
          </div>
          {intel.forKey && intel.mlStatus !== 'ok' && <p className="field-hint intel-status">{ML_STATUS_COPY[intel.mlStatus]}</p>}
          {intel.mlStatus === 'ok' && intel.model && <p className="field-hint intel-status">ML model {intel.model.version} · trained on data through {intel.model.trainingEnd} · {ESTIMATE_NOTE}</p>}
          {results.length === 0 ? <p className="text-body">No securities match your filters.</p> : (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Screener results ranked by {sortKey} score</caption>
                <thead>
                  <tr><th scope="col" className="num">#</th><th scope="col">Security</th><th scope="col" className="num">Price</th><th scope="col" className="num">P/E</th><th scope="col" className="num">RSI</th><th scope="col" className="num">Overall</th><th scope="col" className="num">Fund.</th><th scope="col" className="num">Tech.</th><th scope="col" className="num">Mom.</th><th scope="col" className="num">Risk</th><th scope="col" className="num" title="Rule-based score blended with the ML signal when a validated model is available">Intel.</th><th scope="col" className="num" title="Model-estimated probability of a positive 3-month return">P(+3m)</th><th scope="col" className="num" title="Model confidence (data quality, held-out evidence, agreement, stability)">Conf.</th><th scope="col" className="num">Data</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {results.slice(0, 100).map((r, i) => (
                    <tr key={r.symbol}>
                      <td className="num">{i + 1}</td>
                      <th scope="row"><button type="button" className="row-link" onClick={() => setDetail(r)}><strong>{r.symbol}</strong><small>{r.name}</small></button></th>
                      <td className="num">{formatMoney(r.metrics.price, r.currency, { maxFraction: 2 })}</td>
                      <td className="num">{fmtN(r.metrics.pe)}</td>
                      <td className="num">{fmtN(r.metrics.rsi14, 0)}</td>
                      <ScoreCell v={r.scores.overall} /><ScoreCell v={r.scores.fundamental} /><ScoreCell v={r.scores.technical} /><ScoreCell v={r.scores.momentum} /><ScoreCell v={r.scores.risk} />
                      <ScoreCell v={r.intel.score} />
                      <td className="num">{fmtProb(intel.predictions?.[r.symbol]?.status === 'ok' ? intel.predictions[r.symbol].positive3mProbability : null).replace('n/a', '–')}</td>
                      <td className="num">{intel.predictions?.[r.symbol]?.status === 'ok' ? <span className={`conf conf-${intel.predictions[r.symbol].confidenceLabel}`}>{CONFIDENCE_LABEL[intel.predictions[r.symbol].confidenceLabel]}</span> : '–'}</td>
                      <td className="num">{r.scores.coverage.toFixed(0)}%</td>
                      <td className="actions"><button type="button" className="icon-btn" aria-label={`Add ${r.symbol} to watchlist`} disabled={watchedSet.has(r.symbol)} onClick={() => watch(r)}><Plus size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="field-hint">Overall = 35% Fundamental + 20% Technical + 25% Momentum + 20% Risk (higher Risk score = lower risk). Missing metrics are skipped and “Data” shows how much of the rubric had data. Intelligence = {Math.round(INTELLIGENCE_CONFIG.weights.rule * 100)}% rule-based score + {Math.round(INTELLIGENCE_CONFIG.weights.ml * 100)}% ML signal when a validated model with at least {INTELLIGENCE_CONFIG.minConfidenceForBlend} confidence is available; otherwise it equals Overall. Click a security for the full breakdown.</p>
        </section>
      )}
      <Disclaimer />
      {detail && (() => {
        const scores = scoreSecurity(detail.metrics);
        const pred = intel.predictions?.[detail.symbol] ?? null;
        return <StockDetail row={{ ...detail, scores }} onClose={() => setDetail(null)} watched={watchedSet.has(detail.symbol)} onWatch={() => watch(detail)}
          intel={blendIntelligence(scores.overall, pred, intel.model)} prediction={pred} mlState={{ mlStatus: intel.forKey ? intel.mlStatus : 'unavailable', model: intel.model }} />;
      })()}
    </>
  );
}
