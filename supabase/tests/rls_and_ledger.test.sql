-- Self-asserting database tests: Row Level Security isolation + ledger/holding logic.
-- Run against a scratch Postgres/Supabase DB AFTER applying all migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_ledger.test.sql
-- Any failed assertion aborts the script with a non-zero exit code. Test rows are removed at the end.
-- (On a plain Postgres, create stub auth/storage schemas first; see README "Testing".)

\set ON_ERROR_STOP on

create or replace function pg_temp.expect_fail(q text, why text) returns void language plpgsql as $f$
begin
  begin
    execute q;
  exception when others then
    return; -- failed as expected
  end;
  raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', why;
end $f$;

create or replace function pg_temp.act_as(uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claim.sub', uid::text, false);
end $f$;

-- two users; signup trigger must create profile + default portfolio
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@test.local', '{"full_name":"Alice","preferred_currency":"INR"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@test.local', '{}');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'signup trigger should create 2 profiles';
  assert (select count(*) from public.portfolios where is_default) = 2, 'signup trigger should create default portfolios';
  assert (select preferred_currency from public.profiles where email = 'alice@test.local') = 'INR', 'currency metadata honoured';
  assert (select preferred_currency from public.profiles where email = 'bob@test.local') = 'USD', 'currency default is USD';
end $$;

-- ===== Alice: ledger maths =====
set role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');

insert into public.assets (user_id, symbol, name, asset_type, currency, price_source, current_price)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'TCS.NS', 'TCS', 'Stock', 'INR', 'market', 4000);

do $$
declare p uuid; a uuid;
begin
  select id into p from public.portfolios;
  select id into a from public.assets;
  insert into public.transactions (user_id, portfolio_id, asset_id, type, quantity, price, fees, currency, transaction_date) values
    ('aaaaaaaa-0000-0000-0000-000000000001', p, a, 'BUY', 10, 100, 10, 'INR', '2025-01-01'),
    ('aaaaaaaa-0000-0000-0000-000000000001', p, a, 'BUY', 10, 200, 0,  'INR', '2025-02-01'),
    ('aaaaaaaa-0000-0000-0000-000000000001', p, a, 'SELL', 5, 300, 0, 'INR', '2025-03-01');
  -- expected results are asserted in the next block
end $$;

do $$
declare h record;
begin
  select * into h from public.holdings;
  -- BUY 10@100+10 fee => cost 1010 ; BUY 10@200 => cost 3010, qty 20, avg 150.5 ; SELL 5 => cost 3010-752.5 = 2257.5, qty 15
  assert h.quantity = 15, 'qty after buy/buy/sell is 15';
  assert h.average_buy_price = 150.5, 'average cost is 150.5';
  assert h.invested_amount = 2257.5, 'invested amount is 2257.5';
end $$;

select pg_temp.expect_fail($q$
  insert into public.transactions (user_id, portfolio_id, asset_id, type, quantity, price, currency, transaction_date)
  select p.user_id, p.id, a.id, 'SELL', 100, 1, 'INR', '2025-04-01' from public.portfolios p, public.assets a$q$,
  'overselling must be rejected');
select pg_temp.expect_fail($q$
  insert into public.transactions (user_id, portfolio_id, asset_id, type, quantity, price, currency)
  select p.user_id, p.id, a.id, 'BUY', 1, 1, 'USD' from public.portfolios p, public.assets a$q$,
  'transaction currency must match asset currency');
select pg_temp.expect_fail($q$insert into public.holdings (user_id, portfolio_id, asset_id, quantity, average_buy_price, invested_amount)
  select user_id, (select id from public.portfolios), id, 1, 1, 1 from public.assets$q$, 'clients cannot insert holdings');
select pg_temp.expect_fail($q$update public.holdings set quantity = 999999$q$, 'clients cannot update holdings') ;

do $$ begin
  -- update/delete on holdings silently affect 0 rows under RLS/privileges; value must be intact
  begin delete from public.holdings; exception when others then null; end;
  assert (select quantity from public.holdings) = 15, 'holding untouched by client writes';
end $$;

do $$ begin
  delete from public.transactions where type = 'SELL';
  assert (select quantity from public.holdings) = 20, 'deleting the sell restores quantity to 20';
  assert (select average_buy_price from public.holdings) = 150.5, 'avg unchanged';
end $$;

-- ===== Bob: must see nothing of Alice's, and cannot write into her data =====
reset role;
set role authenticated;
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');

do $$ begin
  assert (select count(*) from public.assets) = 0, 'bob sees no assets';
  assert (select count(*) from public.transactions) = 0, 'bob sees no transactions';
  assert (select count(*) from public.holdings) = 0, 'bob sees no holdings';
  assert (select count(*) from public.profiles) = 1, 'bob sees only his profile';
  assert (select count(*) from public.portfolios) = 1, 'bob sees only his portfolio';
end $$;

-- spoofing user_id, and cross-tenant foreign keys (alice's real ids)
reset role;
select set_config('wf.alice_portfolio', (select id::text from public.portfolios where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), false);
select set_config('wf.alice_asset', (select id::text from public.assets limit 1), false);
set role authenticated;
select pg_temp.act_as('bbbbbbbb-0000-0000-0000-000000000002');

select pg_temp.expect_fail($q$insert into public.assets (user_id, symbol, name, asset_type, currency, price_source)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'EVIL', 'x', 'Stock', 'INR', 'market')$q$, 'cannot insert rows as another user');
select pg_temp.expect_fail(format($q$insert into public.transactions (user_id, portfolio_id, type, quantity, price, currency)
  values ('bbbbbbbb-0000-0000-0000-000000000002', %L, 'DIVIDEND', 1, 5, 'INR')$q$, current_setting('wf.alice_portfolio')),
  'cannot write into another user''s portfolio (composite FK)');
select pg_temp.expect_fail(format($q$insert into public.transactions (user_id, portfolio_id, asset_id, type, quantity, price, currency)
  values ('bbbbbbbb-0000-0000-0000-000000000002', (select id from public.portfolios), %L, 'BUY', 1, 5, 'INR')$q$, current_setting('wf.alice_asset')),
  'cannot reference another user''s asset (composite FK)');

do $$ declare n int; begin
  update public.profiles set full_name = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  assert n = 0, 'bob cannot update alice profile';
  delete from public.portfolios where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'; get diagnostics n = row_count;
  assert n = 0, 'bob cannot delete alice portfolio';
  update public.assets set current_price = 1; get diagnostics n = row_count;
  assert n = 0, 'bob cannot update alice assets';
end $$;

-- ===== anon =====
reset role;
set role anon;
select pg_temp.expect_fail('select count(*) from public.assets', 'anon has no table privileges');


-- ===== ML intelligence tables (migration 0005) =====
reset role;   -- superuser == stand-in for service_role (the offline pipeline) when seeding
insert into public.ml_models (version, model_type, target, features, training_start, training_end, status, ml_status, decision_reason)
values ('v9.0', 'hist_gb', 'positive_3m', '["ret_3m"]'::jsonb, '2018-01-01', '2023-12-31', 'production', 'ok', 'rls test');
insert into public.ml_predictions (symbol, prediction_date, model_version, status, positive_3m_probability, ml_score, confidence, confidence_label, risk_level)
values ('TEST.NS', '2026-01-02', 'v9.0', 'ok', 0.61, 58.2, 0.7, 'medium', 'moderate');
insert into public.ml_fundamental_snapshots (symbol, snapshot_date, payload) values ('TEST.NS', '2026-01-02', '{"pe": 21}'::jsonb);

-- constraints (run as owner so only the constraint can be what fails)
select pg_temp.expect_fail($q$insert into public.ml_models (version, model_type, target, features, training_start, training_end, status) values ('v9.1','x','t','[]','2018-01-01','2019-01-01','production')$q$, 'only one production model may exist');
select pg_temp.expect_fail($q$insert into public.ml_models (version, model_type, target, features, training_start, training_end, status) values ('9.2','x','t','[]','2018-01-01','2019-01-01','candidate')$q$, 'version format enforced');
select pg_temp.expect_fail($q$insert into public.ml_predictions (symbol, prediction_date, model_version, status) values ('TEST.NS','2026-01-02','v9.0','ok')$q$, 'prediction cache key (symbol,date,version) is unique');
select pg_temp.expect_fail($q$insert into public.ml_predictions (symbol, prediction_date, model_version, status, positive_3m_probability) values ('T2.NS','2026-01-02','v9.0','ok',1.5)$q$, 'probability must be within 0..1');
select pg_temp.expect_fail($q$insert into public.ml_predictions (symbol, prediction_date, model_version, status, expected_drawdown_3m) values ('T3.NS','2026-01-02','v9.0','ok',0.2)$q$, 'drawdown must be <= 0');
select pg_temp.expect_fail($q$insert into public.ml_predictions (symbol, prediction_date, model_version, status) values ('T4.NS','2026-01-02','v0.0','ok')$q$, 'prediction must reference a registered model version');
select pg_temp.expect_fail($q$delete from public.ml_models where version = 'v9.0'$q$, 'a model with predictions cannot be deleted (audit trail)');

-- authenticated users: read-only
set role authenticated;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.ml_models where version = 'v9.0') = 1, 'users can read model registry';
  assert (select count(*) from public.ml_predictions where symbol = 'TEST.NS') = 1, 'users can read predictions';
end $$;
select pg_temp.expect_fail($q$insert into public.ml_predictions (symbol, prediction_date, model_version, status) values ('HACK.NS','2026-02-02','v9.0','ok')$q$, 'users cannot insert predictions');
select pg_temp.expect_fail($q$update public.ml_predictions set ml_score = 100$q$, 'users cannot update predictions');
select pg_temp.expect_fail($q$delete from public.ml_predictions$q$, 'users cannot delete predictions');
select pg_temp.expect_fail($q$update public.ml_models set status = 'rejected'$q$, 'users cannot change the model registry');
select pg_temp.expect_fail($q$insert into public.ml_evaluations (model_version, split, metrics) values ('v9.0','test','{}')$q$, 'users cannot write evaluations');
select pg_temp.expect_fail($q$select count(*) from public.ml_fundamental_snapshots$q$, 'users cannot read raw fundamental snapshots');
select pg_temp.expect_fail($q$insert into public.ml_fundamental_snapshots (symbol, snapshot_date, payload) values ('X','2026-01-01','{}')$q$, 'users cannot write snapshots');

-- anonymous visitors: nothing
reset role;
set role anon;
select pg_temp.expect_fail('select count(*) from public.ml_predictions', 'anon cannot read predictions');
select pg_temp.expect_fail('select count(*) from public.ml_models', 'anon cannot read the model registry');

reset role;
delete from public.ml_predictions;
delete from public.ml_evaluations;
delete from public.ml_models;
delete from public.ml_fundamental_snapshots;

-- ===== cleanup =====
reset role;
delete from auth.users where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');
do $$ begin
  assert (select count(*) from public.portfolios) = 0, 'cascade removed portfolios';
  assert (select count(*) from public.transactions) = 0, 'cascade removed transactions';
  assert (select count(*) from public.holdings) = 0, 'cascade removed holdings';
end $$;
select 'ALL DATABASE TESTS PASSED' as result;
