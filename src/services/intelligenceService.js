import { invokeFunction } from './functions';
import { SYMBOL_RE } from '../lib/validation';
import { normalizeIntelligenceResponse, UNAVAILABLE } from '../lib/intelligence';

const BATCH = 50;

/**
 * Requests stored ML estimates for symbols. The browser never trains or runs a model; it only reads what the offline
 * pipeline produced. Any failure degrades to {mlStatus:'unavailable'} so callers can fall back to rule-based scores.
 */
export async function fetchIntelligence(symbols, invoke = invokeFunction) {
  const list = [...new Set((symbols ?? []).map(String))].filter((s) => SYMBOL_RE.test(s));
  if (!list.length) return { ...UNAVAILABLE, reason: 'No symbols.' };
  try {
    const chunks = [];
    for (let i = 0; i < list.length; i += BATCH) chunks.push(list.slice(i, i + BATCH));
    const parts = [];
    for (const c of chunks) parts.push(normalizeIntelligenceResponse(await invoke('ml-predictions', { symbols: c })));
    const first = parts[0];
    if (first.mlStatus !== 'ok') return first;
    return { ...first, predictions: Object.assign({}, ...parts.map((p) => p.predictions)) };
  } catch {
    return { ...UNAVAILABLE };
  }
}
