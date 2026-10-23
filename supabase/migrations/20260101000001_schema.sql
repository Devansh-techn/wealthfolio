-- WealthFolio core schema
-- Run order: 0001 schema -> 0002 rls -> 0003 functions & triggers -> 0004 storage

create extension if not exists pgcrypto;

-- Generic updated_at trigger ---------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles --------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or char_length(full_name) <= 120),
  email text,
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  preferred_currency text not null default 'USD' check (preferred_currency in ('INR','USD','EUR','GBP')),
  risk_preference text not null default 'moderate' check (risk_preference in ('conservative','moderate','aggressive')),
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- portfolios ------------------------------------------------------------------
create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);
create index portfolios_user_idx on public.portfolios (user_id);

-- assets (per-user catalogue of instruments) -----------------------------------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text check (symbol is null or symbol ~ '^[A-Za-z0-9.\-^=&:_]{1,32}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  asset_type text not null check (asset_type in ('Stock','ETF','Mutual Fund','Crypto','Cash','Real Estate','Gold','Bond','Other')),
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  exchange text check (exchange is null or char_length(exchange) <= 30),
  sector text check (sector is null or char_length(sector) <= 60),
  price_source text not null default 'manual' check (price_source in ('manual','market')),
  current_price numeric(24,8) not null default 0 check (current_price >= 0),
  previous_close numeric(24,8) check (previous_close is null or previous_close >= 0),
  price_updated_at timestamptz,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  -- market-priced assets need a symbol
  check (price_source = 'manual' or symbol is not null)
);
create index assets_user_idx on public.assets (user_id);
create unique index assets_user_symbol_type_uidx
  on public.assets (user_id, upper(symbol), asset_type) where symbol is not null;

-- holdings (maintained by trigger from transactions; read-only for clients) ----
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  portfolio_id uuid not null,
  asset_id uuid not null,
  quantity numeric(24,8) not null check (quantity > 0),
  average_buy_price numeric(24,8) not null check (average_buy_price >= 0),
  invested_amount numeric(24,8) not null check (invested_amount >= 0),
  first_purchase_date date,
  updated_at timestamptz not null default now(),
  unique (portfolio_id, asset_id),
  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references public.assets (id, user_id) on delete cascade
);
create index holdings_user_idx on public.holdings (user_id);
create index holdings_portfolio_idx on public.holdings (portfolio_id);

-- transactions ----------------------------------------------------------------
-- BUY/SELL/DEPOSIT/WITHDRAWAL: quantity > 0, price >= 0 (price per unit, asset currency)
-- DIVIDEND/FEE: quantity = 1 and price holds the amount (asset optional)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  portfolio_id uuid not null,
  asset_id uuid,
  type text not null check (type in ('BUY','SELL','DEPOSIT','WITHDRAWAL','DIVIDEND','FEE')),
  quantity numeric(24,8) not null default 1 check (quantity > 0),
  price numeric(24,8) not null default 0 check (price >= 0),
  fees numeric(24,8) not null default 0 check (fees >= 0),
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  transaction_date date not null default current_date,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade,
  foreign key (asset_id, user_id) references public.assets (id, user_id) on delete cascade,
  check (type in ('DIVIDEND','FEE') or asset_id is not null)
);
create index transactions_user_date_idx on public.transactions (user_id, transaction_date desc);
create index transactions_portfolio_idx on public.transactions (portfolio_id);
create index transactions_asset_idx on public.transactions (asset_id);

-- watchlists (one row per watched symbol) --------------------------------------
create table public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Za-z0-9.\-^=&:_]{1,32}$'),
  name text check (name is null or char_length(name) <= 120),
  exchange text check (exchange is null or char_length(exchange) <= 30),
  currency text check (currency is null or currency in ('INR','USD','EUR','GBP')),
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
);
create index watchlists_user_idx on public.watchlists (user_id);

-- goals -----------------------------------------------------------------------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  goal_type text not null default 'Custom' check (goal_type in ('House','Car','Education','Emergency Fund','Retirement','Travel','Custom')),
  target_amount numeric(24,2) not null check (target_amount > 0),
  current_amount numeric(24,2) not null default 0 check (current_amount >= 0),
  target_date date not null,
  monthly_contribution numeric(24,2) not null default 0 check (monthly_contribution >= 0),
  expected_annual_return numeric(7,3) not null default 0 check (expected_annual_return between -50 and 100),
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_user_idx on public.goals (user_id);

-- income ----------------------------------------------------------------------
create table public.income (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (char_length(btrim(category)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  amount numeric(24,2) not null check (amount > 0),
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  income_date date not null default current_date,
  is_recurring boolean not null default false,
  recurrence_end date,
  created_at timestamptz not null default now()
);
create index income_user_date_idx on public.income (user_id, income_date desc);

-- expenses --------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (char_length(btrim(category)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  amount numeric(24,2) not null check (amount > 0),
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  expense_date date not null default current_date,
  is_recurring boolean not null default false,
  recurrence_end date,
  created_at timestamptz not null default now()
);
create index expenses_user_date_idx on public.expenses (user_id, expense_date desc);

-- budgets (recurring monthly limit per category) -------------------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (char_length(btrim(category)) between 1 and 60),
  monthly_limit numeric(24,2) not null check (monthly_limit > 0),
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category)
);
create index budgets_user_idx on public.budgets (user_id);

-- liabilities -----------------------------------------------------------------
create table public.liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  liability_type text not null default 'Other' check (liability_type in ('Home Loan','Car Loan','Personal Loan','Education Loan','Credit Card','Other')),
  principal numeric(24,2) not null check (principal > 0),
  outstanding numeric(24,2) not null check (outstanding >= 0),
  interest_rate numeric(7,3) not null check (interest_rate >= 0 and interest_rate <= 100),
  tenure_months integer not null check (tenure_months between 1 and 720),
  emi numeric(24,2) not null check (emi >= 0),
  start_date date not null default current_date,
  currency text not null check (currency in ('INR','USD','EUR','GBP')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index liabilities_user_idx on public.liabilities (user_id);

-- notifications ---------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null default 'info' check (type in ('info','warning','success')),
  title text not null check (char_length(title) <= 160),
  body text check (body is null or char_length(body) <= 500),
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 120),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- screener_results (latest scan per universe per user) --------------------------
create table public.screener_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  universe text not null check (char_length(universe) <= 60),
  criteria jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  run_at timestamptz not null default now(),
  unique (user_id, universe)
);
create index screener_results_user_idx on public.screener_results (user_id);

-- updated_at triggers ---------------------------------------------------------
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger trg_portfolios_updated before update on public.portfolios for each row execute function public.set_updated_at();
create trigger trg_assets_updated before update on public.assets for each row execute function public.set_updated_at();
create trigger trg_goals_updated before update on public.goals for each row execute function public.set_updated_at();
create trigger trg_budgets_updated before update on public.budgets for each row execute function public.set_updated_at();
create trigger trg_liabilities_updated before update on public.liabilities for each row execute function public.set_updated_at();
