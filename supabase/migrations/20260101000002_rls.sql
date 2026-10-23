-- Row Level Security: every table is locked to the owning user.
-- Policies use (select auth.uid()) so Postgres evaluates it once per statement.

alter table public.profiles        enable row level security;
alter table public.portfolios      enable row level security;
alter table public.assets          enable row level security;
alter table public.holdings        enable row level security;
alter table public.transactions    enable row level security;
alter table public.watchlists      enable row level security;
alter table public.goals           enable row level security;
alter table public.income          enable row level security;
alter table public.expenses        enable row level security;
alter table public.budgets         enable row level security;
alter table public.liabilities     enable row level security;
alter table public.notifications   enable row level security;
alter table public.screener_results enable row level security;

-- profiles: id is the auth user id. Normally created by the signup trigger (security definer).
create policy "profiles_select_own" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
-- Insert is allowed only for the caller's own id (covers accounts created before the signup trigger existed).
create policy "profiles_insert_own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- holdings: read-only for clients. Written only by the transaction trigger.
create policy "holdings_select_own" on public.holdings for select to authenticated
  using (user_id = (select auth.uid()));

-- Full CRUD on own rows for the remaining tables.
do $$
declare t text;
begin
  foreach t in array array[
    'portfolios','assets','transactions','watchlists','goals',
    'income','expenses','budgets','liabilities','notifications','screener_results'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

-- Anonymous visitors get nothing. (Supabase grants default privileges to anon; RLS has no
-- anon policies so reads return zero rows, but we also revoke to be explicit.)
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.holdings from authenticated;
