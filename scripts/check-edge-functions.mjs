#!/usr/bin/env node
// Diagnoses the "blocked by CORS policy ... No 'Access-Control-Allow-Origin'" error for your Supabase Edge Functions.
//
//   npm run check:functions                       # uses VITE_SUPABASE_URL from the environment or .env
//   npm run check:functions -- --origin https://app.example.com
//
// Browsers report ALL of these as the same CORS error: function not deployed, origin not allowed, a crash, or a wrong
// hostname. This sends the same preflight a browser would and tells them apart. No secrets or keys are needed.
import fs from 'node:fs';

const args = process.argv.slice(2);
const originArg = args.includes('--origin') ? args[args.indexOf('--origin') + 1] : null;
const FUNCTIONS = ['market-data', 'screener-metrics', 'explain-stock', 'delete-account', 'ml-predictions'];

function readEnvFile() {
  try {
    const t = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    return Object.fromEntries(t.split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
  } catch {
    return {};
  }
}

const base = (process.env.VITE_SUPABASE_URL || readEnvFile().VITE_SUPABASE_URL || '').replace(/\/+$/, '');
if (!base) {
  console.error('VITE_SUPABASE_URL is not set (environment or .env).');
  process.exit(2);
}
const origins = originArg ? [originArg] : ['http://localhost:5173', 'http://localhost:5174'];
console.log(`Checking ${base}\n`);

let bad = 0;
for (const fn of FUNCTIONS) {
  const url = `${base}/functions/v1/${fn}`;
  for (const origin of origins) {
    let line;
    try {
      const res = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,apikey,x-client-info' } });
      const acao = res.headers.get('access-control-allow-origin');
      if (res.status === 404) line = ['NOT DEPLOYED', `the platform has no function "${fn}" (HTTP 404). Deploy it: supabase functions deploy ${fn}`];
      else if (res.status >= 500) line = ['SERVER ERROR', `HTTP ${res.status} on preflight. Check logs: supabase functions logs ${fn}`];
      else if (!acao) line = ['CORS BLOCKED', `deployed (HTTP ${res.status}) but ${origin} is not allowed. Either the ALLOWED_ORIGINS secret is unset/wrong, or the deployed code is older than this repo: redeploy ${fn} (current code always allows localhost ports).`];
      else line = ['CORS OK', `HTTP ${res.status}, Allow-Origin: ${acao}`];
    } catch (e) {
      const code = e?.cause?.code || e?.cause?.message || e?.message;
      line = ['UNREACHABLE', `${code}. ${/ENOTFOUND|EAI_AGAIN/.test(String(code)) ? 'The hostname does not resolve: check VITE_SUPABASE_URL for a typo.' : 'Check network/VPN/firewall.'}`];
    }
    if (line[0] !== 'CORS OK') bad++;
    console.log(`${fn.padEnd(17)} ${origin.padEnd(24)} ${line[0].padEnd(13)} ${line[1]}`);
  }
}
console.log(bad ? `\n${bad} problem(s) found. Fix with:\n  supabase functions deploy ${FUNCTIONS.join(' ')}\n  supabase secrets set ALLOWED_ORIGINS=https://your-production-domain   # production only; localhost is allowed by default` : '\nAll checked functions are deployed and accept these origins.');
process.exit(bad ? 1 : 0);
