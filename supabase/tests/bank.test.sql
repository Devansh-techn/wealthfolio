-- Self-asserting database tests for bank accounts, the bank ledger, statement import, transfers, reconciliation,
-- provider ingestion and Row Level Security. Run on a scratch DB AFTER applying all migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/bank.test.sql
\set ON_ERROR_STOP on

create or replace function pg_temp.expect_fail(q text, why text) returns void language plpgsql as $f$
begin
  begin execute q; exception when others then return; end;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', why;
end $f$;
create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin perform set_config('request.jwt.claim.sub', uid::text, false); perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, false); end $f$;
create or replace function pg_temp.bal(acc uuid) returns numeric language sql as $$ select ledger_balance from public.bank_accounts_overview where id = acc $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'alice@bank.test', '{}'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'bob@bank.test', '{}');

-- ======================= Alice: accounts and the balance model =======================
set role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-00000000000a');

insert into public.bank_accounts (id, bank_name, nickname, account_type, last4, opening_balance) values ('a1a1a1a1-0000-0000-0000-000000000001', 'HDFC Bank', 'Salary account', 'savings', '4321', 25000);
insert into public.bank_accounts (id, bank_name, nickname, account_type, opening_balance) values ('a2a2a2a2-0000-0000-0000-000000000002', 'ICICI Bank', 'Spending', 'savings', 0);
do $$ begin
  assert (select user_id from public.bank_accounts where id = 'a1a1a1a1-0000-0000-0000-000000000001') = 'aaaaaaaa-0000-0000-0000-00000000000a', 'user_id comes from the auth context, not the client';
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25000, 'opening balance is the starting ledger balance';
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 0, 'a zero balance is allowed';
end $$;
select pg_temp.expect_fail($q$insert into public.bank_accounts (bank_name, nickname, last4) values ('X','Y','12345678')$q$, 'only the last four digits may be stored');
select pg_temp.expect_fail($q$insert into public.bank_accounts (bank_name, nickname, currency) values ('X','Y','JPY')$q$, 'unsupported currency');
select pg_temp.expect_fail($q$insert into public.bank_accounts (bank_name, nickname) values ('   ','Y')$q$, 'blank bank name');

-- "paid Rs 500 via Google Pay": the ledger changes by exactly that amount
insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type, category) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'UPI/GPay/Swiggy', 500, 'debit', 'Food and Dining');
do $$ begin assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 24500, 'HDFC 25,000 - 500 = 24,500'; end $$;
insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type, category) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'Salary', 1000.50, 'credit', 'Salary and Income');
do $$ begin assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25500.50, 'credits add, decimals exact'; end $$;
select pg_temp.expect_fail($q$insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'bad', 0, 'debit')$q$, 'zero amount');
select pg_temp.expect_fail($q$insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'bad', -5, 'debit')$q$, 'negative amount');
select pg_temp.expect_fail($q$insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date + 400, 'future', 5, 'debit')$q$, 'far-future date');

-- pending / reversed / failed never move the balance
insert into public.bank_transactions (id, bank_account_id, transaction_date, description, amount, transaction_type, transaction_status) values ('c0c0c0c0-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', current_date, 'Card hold', 200, 'debit', 'pending');
do $$ begin
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25500.50, 'pending debit not counted';
  assert (select pending_net from public.bank_accounts_overview where id = 'a1a1a1a1-0000-0000-0000-000000000001') = -200, 'pending shown separately';
end $$;
update public.bank_transactions set transaction_status = 'settled' where id = 'c0c0c0c0-0000-0000-0000-000000000001';
do $$ begin assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25300.50, 'settling the hold counts it exactly once'; end $$;
update public.bank_transactions set transaction_status = 'reversed' where id = 'c0c0c0c0-0000-0000-0000-000000000001';
do $$ begin assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25500.50, 'reversal removes it from the balance'; end $$;

-- overdraft is explicit
select pg_temp.expect_fail($q$insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'too much', 99999, 'debit')$q$, 'overdraft blocked by default');
update public.bank_accounts set allow_overdraft = true where id = 'a1a1a1a1-0000-0000-0000-000000000001';
insert into public.bank_transactions (id, bank_account_id, transaction_date, description, amount, transaction_type) values ('c0c0c0c0-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001', current_date, 'overdrawn', 30000, 'debit');
do $$ begin assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = -4499.50, 'overdraft allowed when enabled'; end $$;
select pg_temp.expect_fail($q$update public.bank_accounts set allow_overdraft = false where id = 'a1a1a1a1-0000-0000-0000-000000000001'$q$, 'cannot disable overdraft while negative');
delete from public.bank_transactions where id = 'c0c0c0c0-0000-0000-0000-000000000002';
update public.bank_accounts set allow_overdraft = false where id = 'a1a1a1a1-0000-0000-0000-000000000001';

-- ======================= statement import: atomic + idempotent =======================
create temp table imp as select jsonb_build_array(
  jsonb_build_object('date', current_date - 3, 'description', 'ATM WDL', 'amount', 2000, 'type', 'debit', 'dedupe_key', 'k|1|2000|debit|atm|1', 'category', 'Other'),
  jsonb_build_object('date', current_date - 2, 'description', 'NEFT Rent received', 'amount', 5000, 'type', 'credit', 'dedupe_key', 'k|2|5000|credit|neft|1', 'reference', 'UTR123'),
  jsonb_build_object('date', current_date - 2, 'description', 'Coffee', 'amount', 120, 'type', 'debit', 'dedupe_key', 'k|3|120|debit|coffee|1'),
  jsonb_build_object('date', current_date - 2, 'description', 'Coffee', 'amount', 120, 'type', 'debit', 'dedupe_key', 'k|3|120|debit|coffee|2')) as rows;
grant select on imp to authenticated;
do $$ declare r jsonb; begin
  r := public.bank_import_rows('a1a1a1a1-0000-0000-0000-000000000001', (select rows from imp), 'march.csv');
  assert (r->>'imported')::int = 4 and (r->>'skipped_duplicates')::int = 0, 'first import inserts all four rows (two identical coffees are distinct)';
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25500.50 - 2000 + 5000 - 240, 'balance reflects the import once';
  r := public.bank_import_rows('a1a1a1a1-0000-0000-0000-000000000001', (select rows from imp), 'march.csv');
  assert (r->>'imported')::int = 0 and (r->>'skipped_duplicates')::int = 4, 'importing the same statement again adds nothing';
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25500.50 - 2000 + 5000 - 240, 'no double counting after re-import';
  assert (select opening_balance from public.bank_accounts where id = 'a1a1a1a1-0000-0000-0000-000000000001') = 25000, 'import never touches the opening balance';
  assert (select count(*) from public.bank_import_batches) = 2, 'each import is summarised';
end $$;
select pg_temp.expect_fail($q$select public.bank_import_rows('a1a1a1a1-0000-0000-0000-000000000001', '[{"date":"2026-01-01","description":"ok","amount":10,"type":"debit","dedupe_key":"z1"},{"date":"2026-01-01","description":"bad","amount":-1,"type":"debit","dedupe_key":"z2"}]'::jsonb)$q$, 'bad row aborts import');
do $$ begin assert not exists (select 1 from public.bank_transactions where dedupe_key = 'z1'), 'atomic: the valid row was rolled back too'; end $$;
select pg_temp.expect_fail($q$select public.bank_import_rows('a2a2a2a2-0000-0000-0000-000000000002', '[{"date":"2026-01-01","description":"big","amount":9999,"type":"debit","dedupe_key":"o1"}]'::jsonb)$q$, 'import that overdraws is rejected whole');

-- ======================= transfers between own accounts =======================
do $$ declare t uuid; before_total numeric; begin
  before_total := pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') + pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002');
  t := public.bank_record_transfer('a1a1a1a1-0000-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000002', 1000, current_date, 'To spending');
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 1000, 'receiving account credited';
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') + pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = before_total, 'a transfer does not change total money';
  assert (select count(*) from public.bank_transactions where transfer_id = t) = 2, 'both legs linked';
  perform set_config('wf.t', t::text, false);
end $$;
select pg_temp.expect_fail($q$delete from public.bank_transactions where transfer_id = current_setting('wf.t')::uuid and transaction_type = 'debit'$q$, 'single transfer leg cannot be deleted');
select pg_temp.expect_fail($q$update public.bank_transactions set amount = 1 where transfer_id = current_setting('wf.t')::uuid$q$, 'transfer leg amount cannot be edited');
select pg_temp.expect_fail($q$select public.bank_record_transfer('a1a1a1a1-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 5, current_date)$q$, 'same-account transfer');
do $$ begin
  perform public.bank_delete_transfer(current_setting('wf.t')::uuid);
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 0, 'deleting the transfer removes both legs';
end $$;

-- two imported legs can be linked into one transfer (and then stop counting as income/expense)
insert into public.bank_transactions (id, bank_account_id, transaction_date, description, amount, transaction_type, category) values
  ('e0e0e0e0-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', current_date, 'NEFT to own ICICI', 777, 'debit', 'Other'),
  ('e0e0e0e0-0000-0000-0000-000000000002', 'a2a2a2a2-0000-0000-0000-000000000002', current_date, 'NEFT from own HDFC', 777, 'credit', 'Other'),
  ('e0e0e0e0-0000-0000-0000-000000000003', 'a2a2a2a2-0000-0000-0000-000000000002', current_date, 'Unrelated credit', 778, 'credit', 'Other');
select pg_temp.expect_fail($q$select public.bank_link_transfer('e0e0e0e0-0000-0000-0000-000000000001', 'e0e0e0e0-0000-0000-0000-000000000003')$q$, 'unequal amounts cannot be linked');
select pg_temp.expect_fail($q$select public.bank_link_transfer('e0e0e0e0-0000-0000-0000-000000000002', 'e0e0e0e0-0000-0000-0000-000000000003')$q$, 'two credits cannot be linked');
select pg_temp.expect_fail($q$update public.bank_transactions set transfer_id = gen_random_uuid() where id = 'e0e0e0e0-0000-0000-0000-000000000001'$q$, 'the link cannot be set by a plain update');
do $$ declare t uuid; begin
  t := public.bank_link_transfer('e0e0e0e0-0000-0000-0000-000000000001', 'e0e0e0e0-0000-0000-0000-000000000002');
  assert (select count(*) from public.bank_transactions where transfer_id = t and category = 'Transfers') = 2, 'both legs linked and categorised as Transfers';
  assert public.bank_unlink_transfer(t) = 2, 'unlink restores independent rows';
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 25500.50 - 2000 + 5000 - 240 - 777, 'linking never changes balances';
end $$;
delete from public.bank_transactions where id in ('e0e0e0e0-0000-0000-0000-000000000001','e0e0e0e0-0000-0000-0000-000000000002','e0e0e0e0-0000-0000-0000-000000000003');

-- ======================= reconciliation =======================
insert into public.bank_balance_observations (bank_account_id, observed_balance, observed_at) values ('a1a1a1a1-0000-0000-0000-000000000001', 28000.50, now());
do $$ declare r record; begin
  select * into r from public.bank_reconciliation('a1a1a1a1-0000-0000-0000-000000000001');
  assert r.observed_balance = 28000.50 and r.ledger_balance_asof = 28260.50 and r.difference = -260.00, 'discrepancy is reported, not hidden: ' || r.difference;
  assert pg_temp.bal('a1a1a1a1-0000-0000-0000-000000000001') = 28260.50, 'the ledger is untouched by an observation';
end $$;
select pg_temp.expect_fail($q$insert into public.bank_balance_observations (bank_account_id, observed_balance, observed_at, source) values ('a1a1a1a1-0000-0000-0000-000000000001', 1, now(), 'provider')$q$, 'customers cannot fake a provider balance');

-- ======================= provider integrity (customer side) =======================
select pg_temp.expect_fail($q$insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type, source) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'fake bank txn', 10, 'credit', 'provider')$q$, 'customers cannot forge provider transactions');
select pg_temp.expect_fail($q$insert into public.bank_connections (user_id, bank_account_id, provider, status) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', 'x', 'active')$q$, 'customers cannot create a connection');
select pg_temp.expect_fail($q$select public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', '[]'::jsonb)$q$, 'ingestion is not callable by customers');

-- ======================= provider ingestion (service side) =======================
reset role;
insert into public.bank_connections (user_id, bank_account_id, provider, status) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', 'test-aa', 'pending');
do $$ begin
  begin perform public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', '[]'::jsonb);
        raise exception 'EXPECTED FAILURE: ingestion while the connection is only pending';
  exception when sqlstate '42501' then null; end;
end $$;
update public.bank_connections set status = 'active' where bank_account_id = 'a2a2a2a2-0000-0000-0000-000000000002';
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-00000000000a');
do $$ declare r jsonb; rows jsonb := jsonb_build_array(
    jsonb_build_object('external_id', 'TXN-1', 'date', current_date - 1, 'description', 'UPI/GPAY/Merchant', 'amount', 500, 'type', 'debit', 'status', 'settled'),
    jsonb_build_object('external_id', 'TXN-2', 'date', current_date, 'description', 'Credit interest', 'amount', 1500, 'type', 'credit', 'status', 'pending')); begin
  r := public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', rows, 1000, now());
  assert (r->>'inserted')::int = 2 and (r->>'updated')::int = 0, 'first sync inserts';
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = -500, 'pending credit not counted yet (balance 0 - 500)';
  r := public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', rows, 1000, now());
  assert (r->>'inserted')::int = 0 and (r->>'updated')::int = 2, 'repeated sync updates in place, never duplicates';
  assert (select count(*) from public.bank_transactions where bank_account_id = 'a2a2a2a2-0000-0000-0000-000000000002' and source = 'provider') = 2, 'still two rows';
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = -500, 'repeated sync does not double count';
  r := public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('external_id', 'TXN-2', 'date', current_date, 'description', 'Credit interest', 'amount', 1500, 'type', 'credit', 'status', 'settled')));
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 1000, 'settled credit counted exactly once: -500 + 1500';
  r := public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('external_id', 'TXN-1', 'date', current_date - 1, 'description', 'UPI/GPAY/Merchant', 'amount', 500, 'type', 'debit', 'status', 'reversed')));
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 1500, 'reversed debit no longer counted';
  assert (select observed_balance from public.bank_balance_observations where source = 'provider' order by created_at desc limit 1) = 1000, 'bank-reported balance stored separately';
end $$;
do $$ declare r record; begin
  select * into r from public.bank_reconciliation('a2a2a2a2-0000-0000-0000-000000000002');
  assert r.observed_balance = 1000 and r.difference = -500, 'ledger 1500 vs bank 1000: the 500 difference is visible: ' || coalesce(r.difference::text, 'null');
end $$;

-- ambiguous provider row (no stable id) that looks like a manual entry is flagged and kept out of the balance
set role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-00000000000a');
insert into public.bank_transactions (id, bank_account_id, transaction_date, description, amount, transaction_type) values ('d0d0d0d0-0000-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000002', current_date, 'Lunch (entered by me)', 300, 'debit');
reset role;
do $$ declare r jsonb; begin
  r := public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('date', current_date, 'description', 'UPI/Lunch', 'amount', 300, 'type', 'debit')));
  assert (r->>'flagged_for_review')::int = 1, 'ambiguous match flagged';
  r := public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('date', current_date, 'description', 'UPI/Lunch', 'amount', 300, 'type', 'debit')));
  assert (r->>'inserted')::int = 0, 'the same ambiguous row is not inserted twice';
end $$;
set role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-00000000000a');
do $$ begin
  assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 1200, 'only the manual 300 counts (1500 - 300): the flagged duplicate is excluded';
  assert (select needs_review_count from public.bank_accounts_overview where id = 'a2a2a2a2-0000-0000-0000-000000000002') = 1, 'review count visible';
end $$;

-- customers cannot rewrite bank-confirmed data
select pg_temp.expect_fail($q$update public.bank_transactions set amount = 1 where external_transaction_id = 'TXN-2'$q$, 'provider amount immutable');
select pg_temp.expect_fail($q$update public.bank_transactions set transaction_status = 'settled' where external_transaction_id = 'TXN-1'$q$, 'provider status immutable');
select pg_temp.expect_fail($q$delete from public.bank_transactions where external_transaction_id = 'TXN-2'$q$, 'provider rows cannot be deleted');
update public.bank_transactions set category = 'Food and Dining', notes = 'dinner' where external_transaction_id = 'TXN-1';
do $$ begin assert (select category from public.bank_transactions where external_transaction_id = 'TXN-1') = 'Food and Dining', 'category/notes may be changed'; end $$;
delete from public.bank_transactions where source = 'provider' and needs_review;
do $$ begin assert pg_temp.bal('a2a2a2a2-0000-0000-0000-000000000002') = 1200, 'dismissed duplicate leaves the balance unchanged'; end $$;

-- disconnecting stops future synchronisation
update public.bank_connections set status = 'revoked', disconnected_at = now() where bank_account_id = 'a2a2a2a2-0000-0000-0000-000000000002';
select pg_temp.expect_fail($q$update public.bank_connections set status = 'active' where bank_account_id = 'a2a2a2a2-0000-0000-0000-000000000002'$q$, 'customers cannot re-activate');
reset role;
do $$ begin
  begin perform public.bank_ingest_provider('aaaaaaaa-0000-0000-0000-00000000000a', 'a2a2a2a2-0000-0000-0000-000000000002', jsonb_build_array(jsonb_build_object('external_id', 'TXN-9', 'date', current_date, 'description', 'x', 'amount', 1, 'type', 'credit')));
        raise exception 'EXPECTED FAILURE: ingestion after disconnect';
  exception when sqlstate '42501' then null; end;
end $$;

-- ======================= Bob cannot see or touch Alice's money =======================
set role authenticated;
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-00000000000b');
do $$ begin
  assert (select count(*) from public.bank_accounts) = 0, 'Bob sees no accounts';
  assert (select count(*) from public.bank_accounts_overview) = 0, 'Bob sees no overview rows (security_invoker view)';
  assert (select count(*) from public.bank_transactions) = 0, 'Bob sees no transactions';
  assert (select count(*) from public.bank_connections) = 0, 'Bob sees no connections';
  assert (select count(*) from public.bank_balance_observations) = 0, 'Bob sees no observations';
  assert (select count(*) from public.bank_import_batches) = 0, 'Bob sees no import batches';
  assert (select count(*) from public.bank_reconciliation('a1a1a1a1-0000-0000-0000-000000000001') where observed_balance is not null) = 0, 'Bob cannot reconcile Alice''s account';
end $$;
select pg_temp.expect_fail($q$insert into public.bank_transactions (bank_account_id, transaction_date, description, amount, transaction_type) values ('a1a1a1a1-0000-0000-0000-000000000001', current_date, 'stolen', 1, 'credit')$q$, 'Bob cannot write into Alice''s account');
select pg_temp.expect_fail($q$insert into public.bank_transactions (user_id, bank_account_id, transaction_date, description, amount, transaction_type) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001', current_date, 'spoofed owner', 1, 'credit')$q$, 'Bob cannot spoof Alice''s user_id');
select pg_temp.expect_fail($q$select public.bank_import_rows('a1a1a1a1-0000-0000-0000-000000000001', '[{"date":"2026-01-01","description":"x","amount":1,"type":"credit","dedupe_key":"b1"}]'::jsonb)$q$, 'Bob cannot import into Alice''s account');
select pg_temp.expect_fail($q$select public.bank_record_transfer('a1a1a1a1-0000-0000-0000-000000000001', 'a2a2a2a2-0000-0000-0000-000000000002', 1, current_date)$q$, 'Bob cannot transfer Alice''s money');
do $$ declare n int; begin
  update public.bank_accounts set nickname = 'pwned'; get diagnostics n = row_count; assert n = 0, 'Bob cannot update Alice''s accounts';
  delete from public.bank_accounts; get diagnostics n = row_count; assert n = 0, 'Bob cannot delete Alice''s accounts';
end $$;
reset role;
set role anon;
select pg_temp.expect_fail('select count(*) from public.bank_accounts', 'anon cannot read accounts');
select pg_temp.expect_fail('select count(*) from public.bank_transactions', 'anon cannot read transactions');
select pg_temp.expect_fail('select count(*) from public.bank_accounts_overview', 'anon cannot read the overview');
reset role;
set role authenticated;
select pg_temp.expect_fail('select count(*) from public.bank_webhook_events', 'customers cannot read webhook events');
reset role;

-- deleting an account removes its ledger (including bank-confirmed rows) and connection
set role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-00000000000a');
delete from public.bank_accounts where id = 'a2a2a2a2-0000-0000-0000-000000000002';
do $$ begin assert not exists (select 1 from public.bank_transactions where bank_account_id = 'a2a2a2a2-0000-0000-0000-000000000002'), 'account delete cascades to its transactions'; end $$;
reset role;

delete from public.bank_accounts; delete from auth.users where email like '%@bank.test';
select 'ALL BANK DATABASE TESTS PASSED' as result;
