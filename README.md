# WealthFolio — Intelligent Wealth Management

A private, premium wealth-management app: track stocks, ETFs, mutual funds, crypto, cash, gold, real estate and more; analyse performance and risk; plan goals; budget; calculate loans; keep a watchlist; and rank stocks with a **transparent, rule-based screener**.

**Stack:** React 19 + Vite + React Router + GSAP · Supabase (Auth, Postgres with Row Level Security, Edge Functions) · Vercel.

> WealthFolio gives information, not advice. It never promises returns, and AI is used only to *explain* numbers — it is never the source of any price or statistic.

---

## Contents
1. [How it works](#how-it-works)
2. [Supabase setup](#1-supabase-setup)
3. [Database migration](#2-database-migration)
4. [Authentication setup](#3-authentication-setup)
5. [OAuth (Google)](#4-oauth-google-optional)
6. [Environment variables](#5-environment-variables)
7. [Market data setup](#6-market-data-setup)
8. [AI explanation setup](#7-ai-explanation-setup-optional)
9. [Local development](#8-local-development)
10. [Vercel deployment](#9-vercel-deployment)
11. [Domain configuration](#10-domain-configuration)
12. [Production security checklist](#11-production-security-checklist)
13. [Testing](#testing)
14. [Known limitations](#known-limitations)

---

## How it works

| Concern | Approach |
|---|---|
| **Auth** | Supabase Auth sessions (email/password, email verification, password reset, optional Google). Protected routes are guarded by the session — there is no client-side "isLoggedIn" flag. |
| **Data isolation** | Every table has Row Level Security; policies restrict rows to `auth.uid()`. Composite foreign keys also stop a user from attaching rows to another user's portfolio/asset. |
| **Holdings** | Holdings are **derived from the transaction ledger** by a database trigger (average-cost method) and are read-only for clients. Opening a position creates a `BUY` (or `DEPOSIT` for cash). Selling more than you hold is rejected. |
| **Transactions** | `BUY`, `SELL`, `DEPOSIT`, `WITHDRAWAL` use quantity × price. `DIVIDEND` and `FEE` store the amount in `price` with quantity 1. `DEPOSIT`/`WITHDRAWAL` act on **Cash** assets. |
| **Currency** | Each asset keeps its native currency (INR/USD/EUR/GBP). Totals are converted for display only, using live ECB reference rates (Frankfurter). **No built-in fallback rates exist** — if rates are unavailable the UI says so and excludes unconvertible items rather than guessing. |
| **Market data** | `marketDataService` → Supabase Edge Function `market-data` (Yahoo Finance adapter, AMFI for Indian mutual funds). Secrets and provider calls stay server-side. |
| **Screener** | Edge Function returns raw prices/fundamentals; scores are computed client-side by open formulas in `src/lib/scoring.js`. Missing metrics are skipped (never estimated) and reported as coverage. |
| **Analytics** | Value series rebuilt from your ledger + historical closes; time-weighted return, CAGR, volatility, Sharpe, max drawdown, concentration, risk score. Method is shown in the UI. |

Project layout:

```
src/
  components/   landing sections + ui/ + charts/
  pages/        route pages (Dashboard, Portfolio, Screener, ...)
  layouts/      authenticated app shell (sidebar, mobile nav)
  contexts/     Auth, Data, Currency, Toast
  hooks/        usePortfolio (valuation + series), useQuotes
  services/     dataService (Supabase CRUD), marketDataService, currencyService
  lib/          pure, unit-tested logic (portfolio, analytics, scoring, loans, goals, ...)
supabase/
  migrations/   SQL schema, RLS, triggers, storage
  functions/    market-data, screener-metrics, explain-stock, delete-account (+ _shared)
  tests/        self-asserting SQL tests
```

---

## 1. Supabase setup

1. Create a project at <https://supabase.com> (note the **Project URL**, **anon key**, and **project ref**).
2. Install the CLI: `npm i -g supabase` (or use `npx supabase`), then:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

## 2. Database migration

Apply the migrations in `supabase/migrations/` (schema → RLS → functions/triggers → storage → ML intelligence):

```bash
supabase db push
```

No CLI? Paste the five files, **in filename order**, into *SQL Editor → New query* and run each.

Tables: `profiles, portfolios, assets, holdings, transactions, watchlists, goals, income, expenses, budgets, liabilities, notifications, screener_results` (+ an `avatars` storage bucket). Migration `0005` adds the shared, read-only ML tables `ml_models, ml_predictions, ml_evaluations, ml_fundamental_snapshots` and a private `ml-artifacts` bucket (see [`ml/README.md`](ml/README.md)).

## 3. Authentication setup

In *Authentication → URL Configuration*:
- **Site URL:** your production URL (e.g. `https://your-domain.com`)
- **Redirect URLs:** add
  - `https://your-domain.com/auth/callback`
  - `https://your-domain.com/reset-password`
  - `http://localhost:5173/auth/callback`
  - `http://localhost:5173/reset-password`

In *Authentication → Providers → Email*: keep **Confirm email** enabled (email verification). Customise the email templates if you like. For production, configure a custom **SMTP** provider (Supabase's built-in mailer is rate-limited and for testing only).

## 4. OAuth (Google) — optional

1. In Google Cloud Console create an *OAuth client ID* (type **Web application**). Add the authorised redirect URI shown in Supabase under *Authentication → Providers → Google* (`https://<project-ref>.supabase.co/auth/v1/callback`).
2. Paste the Client ID and Secret into Supabase's Google provider and enable it.
3. The "Continue with Google" button then works; if the provider is not enabled the app shows a clear error.

## 5. Environment variables

**Browser (`.env`, copy from `.env.example`)** — safe to expose:

| Variable | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Public anon key (RLS protects data) |
| `VITE_SITE_URL` | recommended | Canonical/OpenGraph URL; also generates `robots.txt` + `sitemap.xml` |
| `VITE_MARKET_PROVIDER` | dev only | `demo` = synthetic prices, **ignored and compiled out of production builds** |

**Edge Function secrets (server-side only)** — set with `supabase secrets set KEY=value`:

| Secret | Required | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | production | Comma-separated production browser origins allowed to call the functions (CORS). Trailing slashes are ignored. Local dev (`http://localhost:<any port>`, `http://127.0.0.1:<any port>`) is allowed automatically. |
| `ALLOW_LOCALHOST_ORIGINS` | optional | Set to `false` in production to stop accepting localhost origins. |
| `ANTHROPIC_API_KEY` | optional | Enables "Explain with AI". |
| `ANTHROPIC_MODEL` | optional | Defaults to `claude-sonnet-5-5`. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge Functions automatically. **Never** put the service-role key in a `VITE_*` variable, the repo, or Vercel's frontend env.

## 6. Market data setup

Deploy the functions:

```bash
supabase link --project-ref <your-project-ref>
supabase secrets set ALLOWED_ORIGINS="https://your-domain.com"        # production only; localhost works without it
supabase functions deploy market-data screener-metrics explain-stock delete-account ml-predictions
npm run check:functions                                              # verifies each function is deployed and CORS-correct
```

**Changing code under `supabase/functions/` has no effect until you redeploy it.** The project ref must match `VITE_SUPABASE_URL` exactly.

### Troubleshooting: "blocked by CORS policy … No 'Access-Control-Allow-Origin' header"

A browser shows that same message for several different problems, because in every case the response has no CORS headers. Run `npm run check:functions` — it sends the browser's preflight and tells you which one you have:

| Result | Meaning | Fix |
|---|---|---|
| `NOT DEPLOYED` | the platform answers 404 for that function | `supabase functions deploy <name>` |
| `CORS BLOCKED` | deployed, but your origin isn't allowed (secret unset/wrong, or the deployed code is older than this repo) | redeploy; in production set `ALLOWED_ORIGINS` |
| `UNREACHABLE` + "hostname does not resolve" | typo in `VITE_SUPABASE_URL` | fix `.env`, restart `npm run dev` |
| `SERVER ERROR` | the function crashed on start | `supabase functions logs <name>` |
| `CORS OK` for preflight but the app still fails | the request is rejected after preflight (e.g. 401 expired session, 502 provider outage). The app now shows the real message instead of a network error. | sign in again / check provider status |

Providers used (no keys required):

- **Yahoo Finance (unofficial)** — quotes, history, search, fundamentals. Symbols: NSE `RELIANCE.NS`, BSE `RELIANCE.BO`, NIFTY 50 `^NSEI`, Bank Nifty `^NSEBANK`, US `AAPL`, etc. **Data is typically delayed ~15 minutes** and the endpoint is unofficial: Yahoo can change or rate-limit it without notice. WealthFolio does *not* claim live NSE/BSE data.
- **AMFI India** — official daily NAVs for Indian mutual funds (symbols stored as `AMFI:<schemeCode>`). Latest NAV only (no history / day change).
- **Frankfurter (ECB)** — FX reference rates, called from the browser.

Want a different provider (Twelve Data, Alpha Vantage, a licensed NSE feed…)? Replace `supabase/functions/_shared/yahoo.ts`; the rest of the app talks only to `marketDataService`.

ROCE is not provided by the Yahoo adapter, so it is shown as "n/a" and skipped in scoring — never estimated.

## 7. AI explanation setup (optional)

`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`. The function sends only numeric metrics already on screen, with a system prompt that forbids inventing data or giving advice. Without a key, the button reports the feature is disabled; the deterministic rule-based explanation always works.

### 7b. Stock Intelligence (machine learning, optional)

The screener keeps its rule-based score (`RULE_SCORE`) and can additionally show a **validated** ML signal and a blended *WealthFolio Intelligence* score. Training/inference run **offline in Python** (`ml/`), never in the browser. Until a model passes held-out validation against the rule-based baseline, the app shows rule-based scores only and says why (`not_enough_data` / `insufficient_evidence`). Deploy: apply migration `0005`, `supabase functions deploy ml-predictions`, then follow [`ml/README.md`](ml/README.md) to download data, train, and push predictions.

## 8. Local development

```bash
npm install
cp .env.example .env     # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev              # http://localhost:5173
```

Offline UI work: add `VITE_MARKET_PROVIDER=demo` to `.env` for clearly-labelled synthetic prices (never saved, never in production).

Scripts: `npm run lint` · `npm test` · `npm run build` · `npm run preview`.

## 9. Vercel deployment

1. Push the repo to GitHub and **Import** it in Vercel (framework: Vite — `vercel.json` is included).
2. Add environment variables (Production + Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SITE_URL`.
3. Deploy. `vercel.json` provides the SPA rewrite, security headers (CSP, HSTS, X-Frame-Options, …) and asset caching.
4. After you know the final URL: add it to Supabase **Site URL / Redirect URLs** and to the `ALLOWED_ORIGINS` secret (`supabase secrets set ALLOWED_ORIGINS=...`).

## 10. Domain configuration

Vercel → *Project → Settings → Domains* → add your domain and create the DNS records Vercel shows. Then update `VITE_SITE_URL`, Supabase Site URL/redirects, and `ALLOWED_ORIGINS` to the new domain and redeploy.

## 11. Production security checklist

- [ ] Migrations applied; run `supabase/tests/rls_and_ledger.test.sql` against a scratch DB to confirm isolation.
- [ ] Email confirmation **on**; custom SMTP configured; consider enabling CAPTCHA and leaked-password protection in Supabase Auth.
- [ ] Redirect URLs list contains only your real domains.
- [ ] `ALLOWED_ORIGINS` contains only your real origins (no `*`).
- [ ] Service-role key exists only in Supabase (never in Vercel/browser/GitHub).
- [ ] `.env` is not committed (it is git-ignored).
- [ ] CSP in `vercel.json` reviewed if you add third-party scripts/images.
- [ ] Replace `/privacy` and `/terms` templates with documents reviewed for your jurisdiction.
- [ ] Review Yahoo Finance's terms for your use; consider a licensed data provider for commercial use.
- [ ] Enable Supabase backups / PITR on a paid plan for real user data.
- [ ] Note: Edge Function rate limiting is per-instance best-effort; add API-gateway limits if you expect abuse.

---

## Testing

```bash
npm run lint
npm test                                   # calculations, scoring, loans, goals, ML-intelligence logic, app smoke tests
(cd ml && pip install -r requirements.txt && pytest)   # ML pipeline: look-ahead proof, targets, splits, gates, registry, inference
deno test --allow-env supabase/functions/_shared/shared_test.ts   # edge-function helpers
deno check supabase/functions/*/index.ts   # type-check edge functions
```

Database tests (plain Postgres needs stub Supabase schemas first):

```bash
psql "$SCRATCH_DB" -f supabase/tests/stub_supabase.sql     # skip on a real Supabase DB
# apply supabase/migrations/*.sql in order, then:
psql "$SCRATCH_DB" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_ledger.test.sql
```

## Known limitations

- Live market-data and Supabase round-trips were **not** exercised against real services in CI (no network access in the build environment); they are covered by mocked tests plus type-checks. Do a manual end-to-end pass after deploying.
- Analytics convert historical values at *current* FX rates and exclude dividends from return (shown separately).
- Indian mutual funds (AMFI) have no price history, so analytics value them at last transaction price and say so.
- Screener universes are curated symbol lists, not official index constituents.
- The ML layer ships as a complete, tested pipeline but **no trained model is included**: it needs real price history (see `ml/README.md`). Until one passes validation, `ML_STATUS` is `not_enough_data` and only rule-based scores are shown.
- `design-assets/hero-sequence/` holds the unused 240-frame sequence that previously sat in `public/` (18 MB shipped to every deployment but never referenced). Delete it if you don't need it.
