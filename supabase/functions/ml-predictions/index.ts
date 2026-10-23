// POST { symbols: string[] (<=50) } -> the latest stored WealthFolio ML estimates for those symbols.
// The browser only ever REQUESTS predictions: training and inference happen offline (ml/ Python pipeline),
// results are stored in `ml_predictions` (RLS: read-only for signed-in users) and served from there.
// If no model has passed validation the response says so (mlStatus) and the app falls back to the rule-based score.
import { preflight, json, safeHandler } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { rateLimited } from '../_shared/ratelimit.ts';
import { DISCLAIMER, SYMBOL_RE, deriveMlStatus, latestPerSymbol, summariseEvidence } from '../_shared/ml.ts';

const PRED_COLS = 'symbol,prediction_date,model_version,status,positive_3m_probability,positive_6m_probability,expected_3m_return,expected_6m_return,expected_volatility_3m,expected_drawdown_3m,risk_level,risk_source,ml_score,confidence,confidence_label,data_completeness,top_positive_factors,top_negative_factors,detail';
const MODEL_COLS = 'version,model_type,status,ml_status,decision_reason,training_start,training_end,test_start,test_end,created_at,promoted_at,blend_weights,clf3m:metrics->heads->clf_3m';

Deno.serve(safeHandler(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  if (rateLimited(`ml:${auth.user.id}`, 60, 60_000)) return json(req, { error: 'Too many requests. Please slow down.' }, 429);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400);
  }
  const symbols: string[] = Array.isArray(body?.symbols) ? [...new Set<string>(body.symbols.map(String))] : [];
  if (!symbols.length || symbols.length > 50) return json(req, { error: 'Provide 1-50 symbols' }, 400);
  if (!symbols.every((s) => SYMBOL_RE.test(s))) return json(req, { error: 'Invalid symbol' }, 400);

  try {
    const sb = auth.supabase;
    const prod = await sb.from('ml_models').select(MODEL_COLS).eq('status', 'production').maybeSingle();
    if (prod.error) throw prod.error;
    let latest: any = null;
    if (!prod.data) {
      const l = await sb.from('ml_models').select('version,status,ml_status,decision_reason,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (l.error) throw l.error;
      latest = l.data;
    }
    const mlStatus = deriveMlStatus(prod.data, latest);
    if (mlStatus !== 'ok') {
      return json(req, { mlStatus, model: null, predictions: {}, missing: symbols, reason: latest?.decision_reason ?? 'No ML model has been trained and validated yet.', disclaimer: DISCLAIMER });
    }
    const m: any = prod.data;
    const rows = await sb.from('ml_predictions').select(PRED_COLS).eq('model_version', m.version).in('symbol', symbols).order('prediction_date', { ascending: false }).limit(symbols.length * 4);
    if (rows.error) throw rows.error;
    const predictions = latestPerSymbol(rows.data ?? []);
    return json(req, {
      mlStatus: 'ok',
      model: {
        version: m.version, modelType: m.model_type, trainingStart: m.training_start, trainingEnd: m.training_end, testStart: m.test_start, testEnd: m.test_end,
        createdAt: m.created_at, promotedAt: m.promoted_at, blendWeights: m.blend_weights, evidence: summariseEvidence(m.clf3m),
      },
      predictions,
      missing: symbols.filter((s) => !predictions[s]),
      disclaimer: DISCLAIMER,
    });
  } catch (e) {
    console.error('ml-predictions error', e);
    // The screener keeps working with the rule-based score.
    return json(req, { mlStatus: 'unavailable', model: null, predictions: {}, missing: symbols, reason: 'ML service temporarily unavailable', disclaimer: DISCLAIMER });
  }
}));
