-- WealthFolio bank accounts, bank ledger, statement imports, reconciliation and provider connections.
-- Apply after 0005.
--
-- ACCOUNTING MODEL (single source of truth, enforced here):
--   ledger_balance = opening_balance + SUM(settled credits) - SUM(settled debits)
--   * only transaction_status = 'settled' counts; pending / reversed / failed never move the balance;
--   * rows flagged needs_review (ambiguous provider matches) do not count until the user confirms them;
--   * the bank's own reported balance is stored SEPARATELY (bank_balance_observations) and compared, never written
--     over the ledger, and the opening balance is never touched by imports or syncs.
--   * two linked legs of an own-account transfer (transfer_id) cancel out for net worth, income and expenses.

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_name text not null check (char_length(btrim(bank_name)) between 1 and 80),
  nickname text not null check (char_length(btrim(nickname)) between 1 and 80),
  account_type text not null default 'savings' check (account_type in ('savings', 'current', 'salary', 'overdraft', 'other')),
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),                      -- never the full account number
  currency text not null default 'INR' check (currency in ('INR', 'USD', 'EUR', 'GBP')),
  opening_balance numeric(18, 2) not null default 0 check (abs(opening_balance) < 1000000000000),
  allow_overdraft boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index bank_accounts_user_idx on public.bank_accounts (user_id);
create trigger bank_accounts_updated_at before update on public.bank_accounts for each row execute function public.set_updated_at();

create table public.bank_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_account_id uuid not null,
  source text not null default 'csv' check (source in ('csv')),
  filename text check (filename is null or char_length(filename) <= 200),
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_imported integer not null default 0 check (rows_imported >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  created_at timestamptz not null default now(),
  foreign key (bank_account_id, user_id) references public.bank_accounts (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index bank_import_batches_account_idx on public.bank_import_batches (bank_account_id, created_at desc);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_account_id uuid not null,
  transaction_date date not null check (transaction_date >= date '1990-01-01'),
  description text not null check (char_length(btrim(description)) between 1 and 300),
  amount numeric(18, 2) not null check (amount > 0 and amount < 1000000000000),   -- always positive; transaction_type carries the sign
  transaction_type text not null check (transaction_type in ('credit', 'debit')),
  category text not null default 'Other' check (category in (
    'Food and Dining', 'Shopping', 'Travel', 'Bills and Utilities', 'Rent', 'Healthcare', 'Entertainment', 'Education',
    'Transfers', 'Investments', 'Salary and Income', 'Other', 'Adjustment')),
  source text not null default 'manual' check (source in ('manual', 'csv', 'provider')),
  transaction_status text not null default 'settled' check (transaction_status in ('pending', 'settled', 'reversed', 'failed')),
  external_transaction_id text check (external_transaction_id is null or char_length(external_transaction_id) between 1 and 200),
  provider_transaction_reference text check (provider_transaction_reference is null or char_length(provider_transaction_reference) <= 200),
  reference text check (reference is null or char_length(reference) <= 100),               -- UTR / cheque / user reference
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) <= 400),
  import_batch_id uuid,
  transfer_id uuid,                                                                          -- shared by both legs of an own-account transfer
  needs_review boolean not null default false,                                               -- ambiguous provider match: excluded from balance until confirmed
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bank_account_id, user_id) references public.bank_accounts (id, user_id) on delete cascade,
  foreign key (import_batch_id, user_id) references public.bank_import_batches (id, user_id) on delete set null (import_batch_id) deferrable initially deferred
);
create index bank_tx_user_date_idx on public.bank_transactions (user_id, transaction_date desc, created_at desc);
create index bank_tx_account_date_idx on public.bank_transactions (bank_account_id, transaction_date desc, created_at desc);
create index bank_tx_transfer_idx on public.bank_transactions (transfer_id) where transfer_id is not null;
-- Idempotency: the same provider transaction id, or the same statement row, can exist only once per account.
create unique index bank_tx_external_uidx on public.bank_transactions (bank_account_id, external_transaction_id) where external_transaction_id is not null;
create unique index bank_tx_dedupe_uidx on public.bank_transactions (bank_account_id, dedupe_key) where dedupe_key is not null;
create trigger bank_transactions_updated_at before update on public.bank_transactions for each row execute function public.set_updated_at();

create table public.bank_balance_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  bank_account_id uuid not null,
  observed_balance numeric(18, 2) not null,
  observed_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual', 'provider')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  foreign key (bank_account_id, user_id) references public.bank_accounts (id, user_id) on delete cascade
);
create index bank_obs_account_idx on public.bank_balance_observations (bank_account_id, observed_at desc);

-- Status of an authorised provider link. Clients can READ it and REVOKE it, never create or activate it.
-- No tokens or secrets are stored here.
create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bank_account_id uuid not null,
  provider text not null check (char_length(provider) between 1 and 40),
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'revoked')),
  provider_consent_ref text check (provider_consent_ref is null or char_length(provider_consent_ref) <= 200),
  consent_expires_at timestamptz,
  last_event_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bank_account_id, user_id) references public.bank_accounts (id, user_id) on delete cascade,
  unique (bank_account_id)
);
create trigger bank_connections_updated_at before update on public.bank_connections for each row execute function public.set_updated_at();

-- Replay protection for provider webhooks. Service role only (RLS on, no policies).
create table public.bank_webhook_events (
  event_id text not null,
  provider text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

-- ---------------------------------------------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.bank_flag(p_name text) returns boolean language sql stable as
$$ select coalesce(current_setting(p_name, true), '') = 'on' $$;

create or replace function public.bank_counts(p_status text, p_review boolean) returns boolean language sql immutable as
$$ select p_status = 'settled' and not p_review $$;

create or replace function public.bank_ledger_balance(p_account uuid) returns numeric language sql stable as $$
  select a.opening_balance + coalesce(sum(case when t.transaction_type = 'credit' then t.amount else -t.amount end)
                                      filter (where public.bank_counts(t.transaction_status, t.needs_review)), 0)
  from public.bank_accounts a left join public.bank_transactions t on t.bank_account_id = a.id
  where a.id = p_account group by a.opening_balance
$$;

create or replace function public.bank_tx_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'provider' and not public.bank_flag('wf.provider_ingest') then
      raise exception 'Provider transactions can only be created by the synchronisation service' using errcode = '42501';
    end if;
    if new.transaction_date > current_date + 30 then
      raise exception 'Transaction date is too far in the future';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.bank_account_id <> old.bank_account_id or new.source <> old.source
       or new.external_transaction_id is distinct from old.external_transaction_id then
      raise exception 'Account, owner, source and external id of a transaction cannot be changed';
    end if;
    -- the transfer link may only change through the link/unlink functions
    if new.transfer_id is distinct from old.transfer_id and not public.bank_flag('wf.transfer_op') then
      raise exception 'Use the link/unlink transfer actions to change a transfer link';
    end if;
    if public.bank_flag('wf.provider_ingest') then return new; end if;
    if old.source = 'provider' then
      -- bank-confirmed data is immutable for customers; they may only categorise, annotate or confirm a flagged row
      if new.transaction_date <> old.transaction_date or new.amount <> old.amount or new.transaction_type <> old.transaction_type
         or new.transaction_status <> old.transaction_status or new.description <> old.description
         or new.provider_transaction_reference is distinct from old.provider_transaction_reference then
        raise exception 'Bank-confirmed transactions cannot be edited; add an adjustment or change the category/notes instead';
      end if;
      if new.needs_review and not old.needs_review then raise exception 'Only the sync service can flag a transaction for review'; end if;
    end if;
    if old.transfer_id is not null and not public.bank_flag('wf.transfer_op') then
      if new.transaction_date <> old.transaction_date or new.amount <> old.amount or new.transaction_type <> old.transaction_type
         or new.transaction_status <> old.transaction_status then
        raise exception 'Edit the transfer by deleting and re-creating it';
      end if;
    end if;
    return new;
  end if;

  -- DELETE
  if not exists (select 1 from public.bank_accounts a where a.id = old.bank_account_id) then return old; end if;   -- cascade from account delete
  if old.source = 'provider' and not old.needs_review and not public.bank_flag('wf.provider_ingest') then
    raise exception 'Bank-confirmed transactions cannot be deleted; add an adjustment instead';
  end if;
  if old.transfer_id is not null and not public.bank_flag('wf.transfer_op') then
    raise exception 'Delete the transfer (both legs) instead of a single leg';
  end if;
  return old;
end $$;
create trigger bank_transactions_guard before insert or update or delete on public.bank_transactions for each row execute function public.bank_tx_guard();

-- Overdraft protection. Bulk RPCs (import) and provider ingestion set a flag and verify once at the end instead.
create or replace function public.bank_overdraft_check() returns trigger language plpgsql as $$
declare v_acc uuid; v_allow boolean; v_bal numeric;
begin
  if public.bank_flag('wf.bulk') or public.bank_flag('wf.provider_ingest') then return null; end if;
  v_acc := case when tg_op = 'DELETE' then old.bank_account_id else new.bank_account_id end;
  select allow_overdraft into v_allow from public.bank_accounts where id = v_acc;
  if v_allow is null or v_allow then return null; end if;   -- account gone (cascade) or overdraft allowed
  v_bal := public.bank_ledger_balance(v_acc);
  if v_bal < 0 then
    raise exception 'This would overdraw the account (balance %.2f). Enable overdraft on the account or adjust the opening balance.', v_bal using errcode = '23514';
  end if;
  return null;
end $$;
create trigger bank_transactions_overdraft after insert or update or delete on public.bank_transactions for each row execute function public.bank_overdraft_check();

create or replace function public.bank_account_overdraft_check() returns trigger language plpgsql as $$
begin
  if not new.allow_overdraft and public.bank_ledger_balance(new.id) < 0 then
    raise exception 'The recorded transactions put this account below zero; keep overdraft enabled or correct the opening balance' using errcode = '23514';
  end if;
  return null;
end $$;
create trigger bank_accounts_overdraft after update of opening_balance, allow_overdraft on public.bank_accounts for each row execute function public.bank_account_overdraft_check();

-- ---------------------------------------------------------------------------------------------------------------
-- Views (security_invoker: queries run with the CALLER's rights, so RLS on the base tables still applies)
-- ---------------------------------------------------------------------------------------------------------------
create view public.bank_accounts_overview with (security_invoker = true) as
select
  a.id, a.user_id, a.bank_name, a.nickname, a.account_type, a.last4, a.currency, a.opening_balance, a.allow_overdraft, a.notes, a.created_at, a.updated_at,
  a.opening_balance + coalesce(l.net, 0) as ledger_balance,
  coalesce(l.pending_net, 0) as pending_net,
  coalesce(l.tx_count, 0) as transaction_count,
  coalesce(l.review_count, 0) as needs_review_count,
  l.last_tx_date as last_transaction_date,
  o.observed_balance, o.observed_at, o.source as observed_source,
  c.status as connection_status, c.provider as connection_provider, c.last_event_at as last_synced_at, c.consent_expires_at,
  case when c.status = 'active' then 'provider' else 'manual' end as connection_type
from public.bank_accounts a
left join lateral (
  select
    sum(case when t.transaction_type = 'credit' then t.amount else -t.amount end) filter (where public.bank_counts(t.transaction_status, t.needs_review)) as net,
    sum(case when t.transaction_type = 'credit' then t.amount else -t.amount end) filter (where t.transaction_status = 'pending') as pending_net,
    count(*) as tx_count,
    count(*) filter (where t.needs_review) as review_count,
    max(t.transaction_date) as last_tx_date
  from public.bank_transactions t where t.bank_account_id = a.id
) l on true
left join lateral (
  select observed_balance, observed_at, source from public.bank_balance_observations b
  where b.bank_account_id = a.id order by observed_at desc, created_at desc limit 1
) o on true
left join public.bank_connections c on c.bank_account_id = a.id;

-- ---------------------------------------------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------------------------------------------
-- Statement import: atomic, idempotent, safe to retry. Rows: [{date, description, amount, type, reference?, dedupe_key?, category?}]
create or replace function public.bank_import_rows(p_account uuid, p_rows jsonb, p_filename text default null)
returns jsonb language plpgsql as $$
declare v_total int; v_imported int; v_batch uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then raise exception 'No rows to import'; end if;
  if v_total > 5000 then raise exception 'Import at most 5000 rows at a time'; end if;
  if not exists (select 1 from public.bank_accounts where id = p_account) then raise exception 'Bank account not found'; end if;

  perform set_config('wf.bulk', 'on', true);
  v_batch := gen_random_uuid();      -- the batch row is written once, with final counts, after the rows (FK is deferred)

  with ins as (
    insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type, category, source, reference, dedupe_key, import_batch_id)
    select p_account, r.date, left(btrim(r.description), 300), r.amount, r.type, coalesce(nullif(r.category, ''), 'Other'), 'csv', nullif(left(r.reference, 100), ''), r.dedupe_key, v_batch
    from jsonb_to_recordset(p_rows) as r(date date, description text, amount numeric, type text, reference text, dedupe_key text, category text)
    on conflict do nothing
    returning 1
  ) select count(*) into v_imported from ins;

  perform set_config('wf.bulk', 'off', true);
  if public.bank_ledger_balance(p_account) < 0 and not (select allow_overdraft from public.bank_accounts where id = p_account) then
    raise exception 'Importing these rows would overdraw the account. Enable overdraft or correct the opening balance (nothing was imported).' using errcode = '23514';
  end if;
  insert into public.bank_import_batches (id, bank_account_id, filename, rows_total, rows_imported, rows_skipped) values (v_batch, p_account, left(p_filename, 200), v_total, v_imported, v_total - v_imported);
  return jsonb_build_object('batch_id', v_batch, 'total', v_total, 'imported', v_imported, 'skipped_duplicates', v_total - v_imported);
end $$;

-- Own-account transfer: two linked legs created atomically. Excluded from income/expenses and net worth impact.
create or replace function public.bank_record_transfer(p_from uuid, p_to uuid, p_amount numeric, p_date date, p_description text default 'Transfer', p_notes text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_cf text; v_ct text;
begin
  if p_from = p_to then raise exception 'Choose two different accounts'; end if;
  select currency into v_cf from public.bank_accounts where id = p_from;
  select currency into v_ct from public.bank_accounts where id = p_to;
  if v_cf is null or v_ct is null then raise exception 'Bank account not found'; end if;
  if v_cf <> v_ct then raise exception 'Transfers between different currencies are not supported'; end if;
  perform set_config('wf.transfer_op', 'on', true);
  insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type, category, source, transfer_id, notes)
  values (p_from, p_date, left(coalesce(nullif(btrim(p_description), ''), 'Transfer'), 300), p_amount, 'debit', 'Transfers', 'manual', v_id, p_notes),
         (p_to,   p_date, left(coalesce(nullif(btrim(p_description), ''), 'Transfer'), 300), p_amount, 'credit', 'Transfers', 'manual', v_id, p_notes);
  perform set_config('wf.transfer_op', 'off', true);
  return v_id;
end $$;

create or replace function public.bank_delete_transfer(p_transfer uuid) returns integer language plpgsql as $$
declare v_n integer;
begin
  perform set_config('wf.transfer_op', 'on', true);
  delete from public.bank_transactions where transfer_id = p_transfer;
  get diagnostics v_n = row_count;
  perform set_config('wf.transfer_op', 'off', true);
  if v_n = 0 then raise exception 'Transfer not found'; end if;
  return v_n;
end $$;

-- Link two EXISTING transactions (e.g. from two imported statements) as one own-account transfer.
create or replace function public.bank_link_transfer(p_a uuid, p_b uuid) returns uuid language plpgsql as $$
declare a public.bank_transactions; b public.bank_transactions; v_id uuid := gen_random_uuid(); ca text; cb text;
begin
  select * into a from public.bank_transactions where id = p_a;
  select * into b from public.bank_transactions where id = p_b;
  if a.id is null or b.id is null then raise exception 'Transaction not found'; end if;
  if a.bank_account_id = b.bank_account_id then raise exception 'A transfer needs two different accounts'; end if;
  if a.transaction_type = b.transaction_type then raise exception 'One transaction must be a debit and the other a credit'; end if;
  if a.amount <> b.amount then raise exception 'The two amounts must be equal'; end if;
  if a.transfer_id is not null or b.transfer_id is not null then raise exception 'One of these is already part of a transfer'; end if;
  select currency into ca from public.bank_accounts where id = a.bank_account_id;
  select currency into cb from public.bank_accounts where id = b.bank_account_id;
  if ca <> cb then raise exception 'Transfers between different currencies are not supported'; end if;
  perform set_config('wf.transfer_op', 'on', true);
  update public.bank_transactions set transfer_id = v_id, category = 'Transfers' where id in (p_a, p_b);
  perform set_config('wf.transfer_op', 'off', true);
  return v_id;
end $$;

create or replace function public.bank_unlink_transfer(p_transfer uuid) returns integer language plpgsql as $$
declare v_n integer;
begin
  perform set_config('wf.transfer_op', 'on', true);
  update public.bank_transactions set transfer_id = null where transfer_id = p_transfer;
  get diagnostics v_n = row_count;
  perform set_config('wf.transfer_op', 'off', true);
  if v_n = 0 then raise exception 'Transfer not found'; end if;
  return v_n;
end $$;

-- Ledger balance as of a date (settled, confirmed rows dated on/before it) and the latest observation, for reconciliation.
create or replace function public.bank_reconciliation(p_account uuid)
returns table (observed_balance numeric, observed_at timestamptz, observed_source text, ledger_balance_asof numeric, difference numeric, ledger_balance numeric, pending_net numeric, needs_review_count bigint)
language sql stable as $$
  select o.observed_balance, o.observed_at, o.source,
         a.opening_balance + coalesce((select sum(case when t.transaction_type = 'credit' then t.amount else -t.amount end) from public.bank_transactions t
            where t.bank_account_id = a.id and public.bank_counts(t.transaction_status, t.needs_review) and t.transaction_date <= (o.observed_at at time zone 'Asia/Kolkata')::date), 0),
         o.observed_balance - (a.opening_balance + coalesce((select sum(case when t.transaction_type = 'credit' then t.amount else -t.amount end) from public.bank_transactions t
            where t.bank_account_id = a.id and public.bank_counts(t.transaction_status, t.needs_review) and t.transaction_date <= (o.observed_at at time zone 'Asia/Kolkata')::date), 0)),
         public.bank_ledger_balance(a.id),
         coalesce((select sum(case when t.transaction_type = 'credit' then t.amount else -t.amount end) from public.bank_transactions t where t.bank_account_id = a.id and t.transaction_status = 'pending'), 0),
         (select count(*) from public.bank_transactions t where t.bank_account_id = a.id and t.needs_review)
  from public.bank_accounts a
  left join lateral (select * from public.bank_balance_observations b where b.bank_account_id = a.id order by observed_at desc, created_at desc limit 1) o on true
  where a.id = p_account
$$;

-- Provider ingestion. SERVICE ROLE ONLY (executed by the verified webhook / sync function). Idempotent: the same external
-- transaction id updates its existing row (e.g. pending -> settled) instead of creating a second one.
create or replace function public.bank_ingest_provider(p_user uuid, p_account uuid, p_rows jsonb, p_balance numeric default null, p_balance_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_conn public.bank_connections; v_total int; v_ins int := 0; v_upd int := 0; v_flag int := 0; r record; v_dup boolean; v_xmax_zero boolean;
begin
  select * into v_conn from public.bank_connections where bank_account_id = p_account and user_id = p_user;
  if not found or v_conn.status <> 'active' then raise exception 'No active bank connection for this account' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total > 5000 then raise exception 'Too many rows'; end if;
  perform set_config('wf.provider_ingest', 'on', true);

  for r in select * from jsonb_to_recordset(p_rows) as x(external_id text, date date, description text, amount numeric, type text, status text, reference text) loop
    if r.type not in ('credit', 'debit') or r.amount is null or r.amount <= 0 or r.date is null then continue; end if;
    v_xmax_zero := null;
    if r.external_id is not null and btrim(r.external_id) <> '' then
      insert into public.bank_transactions (user_id, bank_account_id, transaction_date, description, amount, transaction_type, source, transaction_status, external_transaction_id, provider_transaction_reference)
      values (p_user, p_account, r.date, left(coalesce(nullif(btrim(r.description), ''), 'Bank transaction'), 300), r.amount, r.type, 'provider', coalesce(r.status, 'settled'), r.external_id, left(r.reference, 200))
      on conflict (bank_account_id, external_transaction_id) where external_transaction_id is not null
      do update set transaction_status = excluded.transaction_status, amount = excluded.amount, transaction_date = excluded.transaction_date, description = excluded.description,
                    provider_transaction_reference = excluded.provider_transaction_reference
         where public.bank_transactions.source = 'provider'
      returning (xmax = 0) into v_xmax_zero;
      if v_xmax_zero is true then v_ins := v_ins + 1; elsif v_xmax_zero is false then v_upd := v_upd + 1; end if;
    else
      -- No stable id: be conservative. If a manual/csv row already looks like the same money movement, flag for review.
      select exists (select 1 from public.bank_transactions t where t.bank_account_id = p_account and t.source <> 'provider' and t.transaction_date = r.date and t.amount = r.amount and t.transaction_type = r.type) into v_dup;
      insert into public.bank_transactions (user_id, bank_account_id, transaction_date, description, amount, transaction_type, source, transaction_status, provider_transaction_reference, needs_review, dedupe_key)
      values (p_user, p_account, r.date, left(coalesce(nullif(btrim(r.description), ''), 'Bank transaction'), 300), r.amount, r.type, 'provider', coalesce(r.status, 'settled'), left(r.reference, 200), v_dup,
              'prov|' || r.date || '|' || r.amount || '|' || r.type || '|' || md5(coalesce(r.description, '') || coalesce(r.reference, '')))
      on conflict do nothing;
      if found then v_ins := v_ins + 1; if v_dup then v_flag := v_flag + 1; end if; end if;
    end if;
  end loop;

  if p_balance is not null and p_balance_at is not null then
    insert into public.bank_balance_observations (user_id, bank_account_id, observed_balance, observed_at, source) values (p_user, p_account, p_balance, p_balance_at, 'provider');
  end if;
  update public.bank_connections set last_event_at = now() where id = v_conn.id;
  perform set_config('wf.provider_ingest', 'off', true);
  return jsonb_build_object('received', v_total, 'inserted', v_ins, 'updated', v_upd, 'flagged_for_review', v_flag);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Row Level Security + privileges
-- ---------------------------------------------------------------------------------------------------------------
alter table public.bank_accounts enable row level security;
alter table public.bank_import_batches enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.bank_balance_observations enable row level security;
alter table public.bank_connections enable row level security;
alter table public.bank_webhook_events enable row level security;      -- no policies: service role only

create policy "bank_accounts_select_own" on public.bank_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy "bank_accounts_insert_own" on public.bank_accounts for insert to authenticated with check (user_id = (select auth.uid()));
create policy "bank_accounts_update_own" on public.bank_accounts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "bank_accounts_delete_own" on public.bank_accounts for delete to authenticated using (user_id = (select auth.uid()));

create policy "bank_batches_select_own" on public.bank_import_batches for select to authenticated using (user_id = (select auth.uid()));
create policy "bank_batches_insert_own" on public.bank_import_batches for insert to authenticated with check (user_id = (select auth.uid()));

create policy "bank_tx_select_own" on public.bank_transactions for select to authenticated using (user_id = (select auth.uid()));
create policy "bank_tx_insert_own" on public.bank_transactions for insert to authenticated with check (user_id = (select auth.uid()) and source in ('manual', 'csv'));
create policy "bank_tx_update_own" on public.bank_transactions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "bank_tx_delete_own" on public.bank_transactions for delete to authenticated using (user_id = (select auth.uid()));

create policy "bank_obs_select_own" on public.bank_balance_observations for select to authenticated using (user_id = (select auth.uid()));
create policy "bank_obs_insert_manual" on public.bank_balance_observations for insert to authenticated with check (user_id = (select auth.uid()) and source = 'manual');
create policy "bank_obs_delete_manual" on public.bank_balance_observations for delete to authenticated using (user_id = (select auth.uid()) and source = 'manual');

create policy "bank_conn_select_own" on public.bank_connections for select to authenticated using (user_id = (select auth.uid()));
-- A customer can disconnect (revoke) but can never create or activate a connection: only the server does that.
create policy "bank_conn_revoke_own" on public.bank_connections for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and status = 'revoked');

revoke all on public.bank_accounts, public.bank_import_batches, public.bank_transactions, public.bank_balance_observations, public.bank_connections, public.bank_webhook_events from anon;
revoke all on public.bank_accounts_overview from anon;
revoke insert, delete, truncate, update on public.bank_connections from authenticated;
grant update (status, disconnected_at) on public.bank_connections to authenticated;       -- revoke only; never activate
revoke all on public.bank_webhook_events from authenticated;
revoke update, delete, truncate on public.bank_import_batches from authenticated;
revoke update, truncate on public.bank_balance_observations from authenticated;
revoke execute on function public.bank_ingest_provider(uuid, uuid, jsonb, numeric, timestamptz) from public, anon, authenticated;
revoke execute on function public.bank_import_rows(uuid, jsonb, text), public.bank_record_transfer(uuid, uuid, numeric, date, text, text), public.bank_delete_transfer(uuid), public.bank_reconciliation(uuid), public.bank_link_transfer(uuid, uuid), public.bank_unlink_transfer(uuid) from anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bank_ingest_provider(uuid, uuid, jsonb, numeric, timestamptz) to service_role;
  end if;
end $$;
