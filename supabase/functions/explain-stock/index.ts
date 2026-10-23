// POST { symbol, name, metrics, scores } -> a short narrative grounded ONLY in the supplied numbers.
// Requires ANTHROPIC_API_KEY (server-side secret). Without it the endpoint returns 501 and the
// app falls back to its deterministic rule-based explanation.
import { preflight, json, safeHandler } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { rateLimited } from '../_shared/ratelimit.ts';
import { deriveMlStatus, latestPerSymbol, mlForExplanation, SYMBOL_RE } from '../_shared/ml.ts';

const SYSTEM = `You explain stock-screener results to retail investors.
Rules you must follow without exception:
- Use ONLY the numbers present in the JSON provided. Never add, estimate, recall or infer any price, return, ratio, statistic, forecast or news that is not in the JSON.
- If a metric is null or missing, say it is unavailable. Do not guess.
- Do not give investment advice, price targets, guarantees, or buy/sell/hold recommendations. Describe what the data shows.
- Do not claim accuracy, success rates or expected profit.
- The JSON may contain an 'ml' object: outputs of a statistical model trained on historical price data (NOT a prediction that will come true). Call them "model estimates". Quote probabilities as probabilities, name the confidence level, and never present them as certain. Never invent, round into a different claim, or extrapolate any ML number.
- If 'ml.status' is not "ok" (or 'ml' is absent), say the ML estimate is unavailable and explain using the rule-based scores only. Do not guess what the model would have said.
- 'ml.topPositiveFactors' / 'ml.topNegativeFactors' were inputs that were INFLUENTIAL in the model's estimate. Describe them that way; never say they caused or will cause a price move.
- 'scores.intelligence' (if present) blends the rule-based score and the ML signal; 'scores.rule' is the rule-based score alone. Keep them distinct.
- 170 words maximum, plain prose, up to three short paragraphs: (1) what ranks well and why, (2) what the model estimate says and how confident it is (only if ml.status is "ok"), (3) what weighs on the score or is missing.
- End with the exact sentence: "Informational only — not investment advice."`;

Deno.serve(safeHandler(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  if (rateLimited(`ex:${auth.user.id}`, 10, 60_000)) return json(req, { error: 'Too many requests. Please slow down.' }, 429);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json(req, { error: 'AI explanations are not configured on this deployment.' }, 501);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'Invalid JSON body' }, 400);
  }
  // Only plain numbers/booleans from the client are forwarded, so free text can never reach the model
  // as an instruction. Symbol/name are restricted to a conservative character set.
  const numericOnly = (o: unknown): Record<string, number | boolean> => {
    const out: Record<string, number | boolean> = {};
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
        if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
      }
    }
    return out;
  };
  const clean = (v: unknown, n: number) => String(v ?? '').replace(/[^A-Za-z0-9 .,&\-^=_()]/g, '').slice(0, n);
  const payload = { symbol: clean(body?.symbol, 32), name: clean(body?.name, 120), metrics: numericOnly(body?.metrics), scores: numericOnly(body?.scores) };
  // ML outputs are NEVER taken from the client: they are looked up server-side (RLS-protected read of the
  // stored predictions) so the model can only ever be shown real, versioned model output.
  let ml: unknown = { status: 'unavailable', note: 'No validated ML estimate is available; explain using the rule-based scores only.' };
  try {
    if (SYMBOL_RE.test(payload.symbol)) {
      const prod = await auth.supabase.from('ml_models').select('version,ml_status').eq('status', 'production').maybeSingle();
      if (!prod.error) {
        const status = deriveMlStatus(prod.data, null);
        if (prod.data) {
          const rows = await auth.supabase.from('ml_predictions').select('*').eq('model_version', prod.data.version).eq('symbol', payload.symbol).order('prediction_date', { ascending: false }).limit(1);
          ml = mlForExplanation(status, rows.error ? null : latestPerSymbol(rows.data ?? [])[payload.symbol] ?? null, prod.data);
        } else {
          ml = mlForExplanation(status, null, null);
        }
      }
    }
  } catch (e) {
    console.error('explain-stock ml lookup failed', e); // explanation continues without ML
  }
  const serialized = JSON.stringify({ ...payload, ml });
  if (serialized.length > 9000) return json(req, { error: 'Payload too large' }, 413);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Screener data (JSON):\n${serialized}` }],
      }),
    });
    if (!res.ok) {
      console.error('anthropic error', res.status);
      return json(req, { error: 'AI explanation is temporarily unavailable' }, 502);
    }
    const data = await res.json();
    const text = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    return json(req, { explanation: text, generatedBy: 'AI', basedOn: 'supplied metrics and stored model estimates only', mlIncluded: (ml as any)?.status === 'ok' });
  } catch (e) {
    console.error('explain-stock error', e);
    return json(req, { error: 'AI explanation is temporarily unavailable' }, 502);
  }
}));
