// @vitest-environment jsdom
// End-to-end smoke tests: the real App, router, auth guards, data layer, calculations and pages,
// running against an in-memory fake of the Supabase client and market-data functions.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ session: null, db: {} }));

vi.mock('../lib/supabase', () => {
  const uid = () => `id-${Math.random().toString(36).slice(2, 10)}`;
  function from(table) {
    let op = 'select';
    let payload = null;
    const filters = [];
    let one = false;
    const run = () => {
      const rows = (h.db[table] ??= []);
      const match = (r) => filters.every((f) => f(r));
      let data;
      if (op === 'select') data = rows.filter(match);
      else if (op === 'insert') {
        const row = { id: uid(), created_at: new Date().toISOString(), ...payload };
        rows.push(row);
        data = [row];
      } else if (op === 'update') {
        data = rows.filter(match);
        data.forEach((r) => Object.assign(r, payload));
      } else if (op === 'delete') {
        data = rows.filter(match);
        h.db[table] = rows.filter((r) => !match(r));
      } else data = [];
      if (one) data = data[0] ?? null;
      return { data, error: null };
    };
    const b = {
      select: () => b,
      insert: (p) => ((op = 'insert'), (payload = p), b),
      update: (p) => ((op = 'update'), (payload = p), b),
      delete: () => ((op = 'delete'), b),
      upsert: (p) => ((op = 'insert'), (payload = p), b),
      eq: (k, v) => (filters.push((r) => r[k] === v), b),
      in: (k, vs) => (filters.push((r) => vs.includes(r[k])), b),
      order: () => b,
      limit: () => b,
      range: () => b,
      single: () => ((one = true), b),
      maybeSingle: () => ((one = true), b),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  }
  const QUOTES = { AAPL: { price: 120, previousClose: 100, currency: 'USD' }, 'TCS.NS': { price: 4000, previousClose: 4000, currency: 'INR' } };
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {},
    },
    from,
    storage: { from: () => ({}) },
    functions: {
      invoke: async (name, { body }) => {
        if (name === 'market-data' && body.action === 'quotes') return { data: { quotes: body.symbols.map((s) => ({ symbol: s, ok: Boolean(QUOTES[s]), error: 'x', ...QUOTES[s] })) }, error: null };
        if (name === 'market-data' && body.action === 'history') {
          const pts = Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.now() - (119 - i) * 86400000).toISOString().slice(0, 10), close: 100 + i * 0.2 + (i % 7) }));
          return { data: { points: pts }, error: null };
        }
        if (name === 'market-data' && body.action === 'search') return { data: { results: [] }, error: null };
        return { data: {}, error: null };
      },
    },
  };
  return { supabase, isSupabaseConfigured: true };
});

import App from '../App';

const user = { id: 'u1', email: 'devansh@example.com', user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const now = new Date().toISOString();

function seed({ empty = false } = {}) {
  h.session = { user };
  h.db = {
    profiles: [{ id: 'u1', email: user.email, full_name: 'Devansh Test', avatar_url: null, preferred_currency: 'USD', risk_preference: 'moderate', theme: 'dark', notifications_enabled: true, created_at: now }],
    portfolios: [{ id: 'p1', user_id: 'u1', name: 'Main', is_default: true, created_at: now }],
    assets: empty ? [] : [
      { id: 'a1', user_id: 'u1', symbol: 'AAPL', name: 'Apple', asset_type: 'Stock', currency: 'USD', price_source: 'market', current_price: 120, previous_close: 100, price_updated_at: now },
      { id: 'a2', user_id: 'u1', symbol: 'TCS.NS', name: 'TCS', asset_type: 'Stock', currency: 'INR', price_source: 'market', current_price: 4000, previous_close: 4000, price_updated_at: now },
      { id: 'a3', user_id: 'u1', symbol: null, name: 'Cash USD', asset_type: 'Cash', currency: 'USD', price_source: 'manual', current_price: 1, previous_close: null, price_updated_at: null },
    ],
    holdings: empty ? [] : [
      { id: 'h1', user_id: 'u1', portfolio_id: 'p1', asset_id: 'a1', quantity: '10', average_buy_price: '90', invested_amount: '900', first_purchase_date: '2025-06-01' },
      { id: 'h2', user_id: 'u1', portfolio_id: 'p1', asset_id: 'a2', quantity: '5', average_buy_price: '3000', invested_amount: '15000', first_purchase_date: '2025-06-01' },
      { id: 'h3', user_id: 'u1', portfolio_id: 'p1', asset_id: 'a3', quantity: '1000', average_buy_price: '1', invested_amount: '1000', first_purchase_date: '2025-06-01' },
    ],
    transactions: empty ? [] : [
      { id: 't1', user_id: 'u1', portfolio_id: 'p1', asset_id: 'a1', type: 'BUY', quantity: '10', price: '90', fees: '0', currency: 'USD', transaction_date: '2025-06-01', created_at: now },
      { id: 't2', user_id: 'u1', portfolio_id: 'p1', asset_id: 'a2', type: 'BUY', quantity: '5', price: '3000', fees: '0', currency: 'INR', transaction_date: '2025-06-01', created_at: now },
      { id: 't3', user_id: 'u1', portfolio_id: 'p1', asset_id: 'a3', type: 'DEPOSIT', quantity: '1000', price: '1', fees: '0', currency: 'USD', transaction_date: '2025-06-01', created_at: now },
    ],
    watchlists: [], goals: [{ id: 'g1', user_id: 'u1', name: 'House', goal_type: 'House', target_amount: '10000', current_amount: '2500', target_date: '2035-01-01', monthly_contribution: '100', expected_annual_return: '6', currency: 'USD', created_at: now }],
    income: [], expenses: [], budgets: [], liabilities: [], notifications: [], screener_results: [],
  };
}

async function go(path) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  global.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { this.cb([{ contentRect: { width: 600 } }]); } disconnect() {} };
  window.matchMedia = window.matchMedia || (() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  window.scrollTo = () => {};
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ date: '2026-10-05', rates: { INR: 80, EUR: 0.9, GBP: 0.8 } }) }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('auth guards', () => {
  it('redirects signed-out users from protected routes to /login', async () => {
    h.session = null;
    await go('/dashboard');
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
  });
  it('redirects signed-in users away from /login to the dashboard', async () => {
    seed();
    await go('/login');
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
  });
});

describe('dashboard', () => {
  it('renders a complete terminal with zeros and no fake figures for a brand-new user', async () => {
    seed({ empty: true });
    await go('/dashboard');
    // the full wealth terminal is present even with zero data ...
    expect(await screen.findByText(/total net worth/i)).toBeTruthy();
    expect(screen.getByLabelText(/total net worth \$0\.00/i)).toBeTruthy();
    for (const t of [/no portfolio history yet/i, /no assets yet/i, /no activity yet\./i, /no assets on your watchlist yet\./i, /no holdings yet\./i, /market intelligence/i, /asset allocation/i, /recent activity/i]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('button', { name: /add your first asset/i }).length).toBeGreaterThan(0);
    // ... the giant onboarding card is gone, and nothing is fabricated
    expect(screen.queryByText(/your wealth journey starts here/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/1,?245,?890|650,?890|450,?000/);
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });
  it('calculates net worth from the user’s own holdings, converting INR at live rates', async () => {
    seed();
    await go('/dashboard');
    // AAPL 10*120=1200 USD + TCS 5*4000=20000 INR/80=250 USD + cash 1000 = 2450
    await waitFor(() => expect(screen.getByLabelText('Total net worth $2,450.00')).toBeTruthy());
    // invested = 900 + 15000/80 = 1087.5 ; value ex cash = 1450 ; P&L = 362.5
    expect(document.body.textContent).toMatch(/\$1,087\.50/);
    expect(document.body.textContent).toMatch(/\+\$362\.50/);
    // Today's P&L: AAPL moved 100 -> 120 on 10 shares = $200
    expect(document.body.textContent).toMatch(/\+\$200\.00/);
  });
  it('converts when the display currency is INR', async () => {
    seed();
    h.db.profiles[0].preferred_currency = 'INR';
    await go('/dashboard');
    await waitFor(() => expect(document.body.textContent).toMatch(/₹1,96,000/)); // 2450 * 80
  });
});

describe('every protected page renders with data and without crashing', () => {
  const pages = [
    ['/portfolio', /^portfolio$/i], ['/assets', /^assets$/i], ['/transactions', /^transactions$/i], ['/screener', /ai screener/i],
    ['/analytics', /^analytics$/i], ['/goals', /^goals$/i], ['/budget', /^budget$/i], ['/loans', /loans & emi/i],
    ['/watchlist', /^watchlist$/i], ['/settings', /^settings$/i], ['/profile', /^profile$/i],
  ];
  for (const [path, name] of pages) {
    it(`renders ${path}`, async () => {
      seed();
      await go(path);
      expect(await screen.findByRole('heading', { level: 1, name })).toBeTruthy();
      expect(screen.queryByText(/something went wrong/i)).toBeNull();
    });
  }
  it('portfolio lists holdings with computed return', async () => {
    seed();
    await go('/portfolio');
    expect(await screen.findByText('Apple')).toBeTruthy();
    expect(document.body.textContent).toMatch(/\+33\.33%/); // (1200-900)/900
  });
  it('goals page computes progress and required contribution', async () => {
    seed();
    await go('/goals');
    expect(await screen.findByText('House')).toBeTruthy();
    expect(document.body.textContent).toMatch(/25\.0%/);
  });
  it('loans page computes the EMI from the defaults', async () => {
    seed();
    await go('/loans');
    await waitFor(() => expect(document.body.textContent).toMatch(/8,678\.23/)); // 10L @ 8.5% / 20y
  });
  it('shows empty states (not fake data) on every list page for a new user', async () => {
    seed({ empty: true });
    h.db.goals = [];
    await go('/transactions');
    expect(await screen.findByText(/no transactions yet/i)).toBeTruthy();
    cleanup();
    await go('/assets');
    expect(await screen.findByText(/no assets yet/i)).toBeTruthy();
  });
});

describe('public pages', () => {
  it('login, signup, forgot-password render', async () => {
    h.session = null;
    for (const [p, n] of [['/login', /welcome back/i], ['/signup', /create your account/i], ['/forgot-password', /reset your password/i]]) {
      cleanup();
      await go(p);
      expect(await screen.findByRole('heading', { level: 1, name: n })).toBeTruthy();
    }
  });
  it('unknown routes show 404', async () => {
    h.session = null;
    await go('/nope');
    expect(await screen.findByText(/page not found/i)).toBeTruthy();
  });
});
