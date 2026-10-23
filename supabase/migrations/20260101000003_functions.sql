-- New user bootstrap ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur text;
begin
  cur := upper(coalesce(new.raw_user_meta_data ->> 'preferred_currency', 'USD'));
  if cur not in ('INR','USD','EUR','GBP') then cur := 'USD'; end if;

  insert into public.profiles (id, email, full_name, avatar_url, preferred_currency)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 120),
    null,
    cur
  );

  insert into public.portfolios (user_id, name, is_default)
  values (new.id, 'My Portfolio', true);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profile email in sync with auth.users
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Holding recomputation ----------------------------------------------------------
-- Average-cost method. Replays every BUY/DEPOSIT (adds) and SELL/WITHDRAWAL (removes)
-- for one (portfolio, asset) pair in chronological order. Raises if a sell would take the
-- position negative, which makes out-of-order edits impossible rather than silently wrong.
create or replace function public.recompute_holding(p_portfolio uuid, p_asset uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_user uuid;
  v_qty numeric := 0;
  v_cost numeric := 0;
  v_avg numeric := 0;
  v_first date := null;
begin
  if p_asset is null then
    return;
  end if;

  select user_id into v_user from public.portfolios where id = p_portfolio;
  if v_user is null then
    return; -- portfolio is being deleted; cascade removes holdings
  end if;

  for r in
    select type, quantity, price, fees, transaction_date
    from public.transactions
    where portfolio_id = p_portfolio
      and asset_id = p_asset
      and type in ('BUY','SELL','DEPOSIT','WITHDRAWAL')
    order by transaction_date, created_at, id
  loop
    if r.type in ('BUY','DEPOSIT') then
      v_cost := v_cost + (r.quantity * r.price) + r.fees;
      v_qty := v_qty + r.quantity;
      if v_first is null then v_first := r.transaction_date; end if;
      v_avg := case when v_qty > 0 then v_cost / v_qty else 0 end;
    else
      if r.quantity > v_qty + 0.00000001 then
        raise exception 'Cannot sell or withdraw more than the quantity held (held %, requested %) as of %',
          v_qty, r.quantity, r.transaction_date
          using errcode = 'check_violation';
      end if;
      v_cost := greatest(v_cost - (v_avg * r.quantity), 0);
      v_qty := v_qty - r.quantity;
      if v_qty <= 0.00000001 then
        v_qty := 0; v_cost := 0; v_avg := 0;
      end if;
    end if;
  end loop;

  if v_qty > 0 then
    insert into public.holdings (user_id, portfolio_id, asset_id, quantity, average_buy_price, invested_amount, first_purchase_date, updated_at)
    values (v_user, p_portfolio, p_asset, v_qty, v_avg, v_cost, v_first, now())
    on conflict (portfolio_id, asset_id) do update
      set quantity = excluded.quantity,
          average_buy_price = excluded.average_buy_price,
          invested_amount = excluded.invested_amount,
          first_purchase_date = excluded.first_purchase_date,
          updated_at = now();
  else
    delete from public.holdings where portfolio_id = p_portfolio and asset_id = p_asset;
  end if;
end;
$$;

revoke all on function public.recompute_holding(uuid, uuid) from public, anon, authenticated;

create or replace function public.transactions_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public.recompute_holding(old.portfolio_id, old.asset_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform public.recompute_holding(new.portfolio_id, new.asset_id);
  end if;
  return null;
end;
$$;

create trigger trg_transactions_after_change
  after insert or update or delete on public.transactions
  for each row execute function public.transactions_after_change();

-- Transactions cannot be re-parented to another portfolio/asset after creation
-- (keeps the replay logic simple and auditable). Edit quantity/price/date/notes only.
create or replace function public.transactions_lock_keys()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.portfolio_id is distinct from old.portfolio_id
     or new.asset_id is distinct from old.asset_id
     or new.user_id is distinct from old.user_id then
    raise exception 'portfolio and asset cannot be changed on an existing transaction; delete and re-create it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_transactions_lock_keys
  before update on public.transactions
  for each row execute function public.transactions_lock_keys();

-- Currency of an asset-linked transaction must match the asset's currency.
create or replace function public.transactions_check_currency()
returns trigger
language plpgsql
set search_path = public
as $$
declare a_cur text;
begin
  if new.asset_id is not null then
    select currency into a_cur from public.assets where id = new.asset_id;
    if a_cur is not null and a_cur <> new.currency then
      raise exception 'transaction currency (%) must match the asset currency (%)', new.currency, a_cur
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_transactions_check_currency
  before insert or update on public.transactions
  for each row execute function public.transactions_check_currency();

-- An asset's currency cannot change once transactions exist.
create or replace function public.assets_lock_currency()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.transactions where asset_id = old.id) then
    raise exception 'asset currency cannot be changed after transactions exist'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_assets_lock_currency
  before update on public.assets
  for each row execute function public.assets_lock_currency();
