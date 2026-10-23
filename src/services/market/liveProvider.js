import { invokeFunction } from '../functions';

// Live provider: calls the `market-data` / `screener-metrics` Edge Functions (secrets stay server-side).
const live = {
  id: 'live',
  async quotes(symbols) {
    const r = await invokeFunction('market-data', { action: 'quotes', symbols });
    return r.quotes;
  },
  async history(symbol, period) {
    const r = await invokeFunction('market-data', { action: 'history', symbol, period });
    return r.unavailable ? [] : r.points;
  },
  async search(query) {
    const r = await invokeFunction('market-data', { action: 'search', query });
    // `warnings` says when one provider (stocks vs mutual funds) was down, so the list is never silently incomplete.
    return Object.assign([...(r.results ?? [])], { warnings: Array.isArray(r.warnings) ? r.warnings : [] });
  },
  async fundamentals(symbols) {
    const r = await invokeFunction('market-data', { action: 'fundamentals', symbols });
    return r.items;
  },
  async screenerMetrics(symbols) {
    const r = await invokeFunction('screener-metrics', { symbols });
    return r.results;
  },
};
export default live;
