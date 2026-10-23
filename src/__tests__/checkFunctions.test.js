// @vitest-environment node
// The diagnostic script must tell "not deployed" / "CORS blocked" / "OK" / "unreachable" apart.
import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { startGateway } from '../../supabase/tests/harness/gateway.mjs';

// Async on purpose: the gateway runs in THIS process, so a blocking spawnSync would deadlock it.
const run = (url, extra = []) => new Promise((resolve) => execFile('node', ['scripts/check-edge-functions.mjs', ...extra], { env: { ...process.env, VITE_SUPABASE_URL: url }, timeout: 30_000 }, (err, stdout, stderr) => resolve({ status: err ? (err.code ?? 1) : 0, stdout, stderr })));
const gws = [];
afterAll(() => Promise.all(gws.map((g) => g.close())));

describe('npm run check:functions', () => {
  it('reports CORS OK for deployed functions and NOT DEPLOYED for the rest', async () => {
    const gw = await startGateway({ env: {}, deployed: ['market-data', 'ml-predictions'] });
    gws.push(gw);
    const r = await run(gw.url);
    expect(r.stdout).toMatch(/market-data\s+http:\/\/localhost:5174\s+CORS OK/);
    expect(r.stdout).toMatch(/screener-metrics\s+http:\/\/localhost:5174\s+NOT DEPLOYED/);
    expect(r.stdout).toMatch(/supabase functions deploy/);
    expect(r.status).toBe(1);
  }, 60_000);
  it('reports CORS BLOCKED when the origin is not allowed (the originally reported failure)', async () => {
    const gw = await startGateway({ env: { ALLOW_LOCALHOST_ORIGINS: 'false' }, deployed: ['market-data'] });
    gws.push(gw);
    const r = await run(gw.url, ['--origin', 'http://localhost:5174']);
    expect(r.stdout).toMatch(/market-data\s+http:\/\/localhost:5174\s+CORS BLOCKED/);
    expect(r.stdout).toMatch(/ALLOWED_ORIGINS/);
  }, 60_000);
  it('flags an unresolvable hostname (a typo like the original one) as UNREACHABLE', async () => {
    const r = await run('http://wrong-host-that-does-not-exist.invalid');
    expect(r.stdout).toMatch(/UNREACHABLE/);
    expect(r.stdout).toMatch(/typo|resolve|network/i);
  }, 60_000);
});
