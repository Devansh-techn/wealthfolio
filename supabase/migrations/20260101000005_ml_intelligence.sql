-- WealthFolio Stock Intelligence (ML layer)
-- Shared, NON-user data. Written ONLY by the offline Python pipeline using the service-role key.
-- Authenticated users may READ model metadata and predictions; nobody but service_role may write.
-- Large artifacts (trained model files) live in the private Storage bucket `ml-artifacts`, not in Postgres.
-- Run order: ... 0004 storage -> 0005 ml_intelligence

-- ml_models: the model registry (audit trail of every trained model, including rejected ones) -------------
create table public.ml_models (
  id uuid primary key default gen_random_uuid(),
  version text not null unique check (version ~ '^v[0-9]+\.[0-9]+$'),
  model_type text not null check (char_length(model_type) <= 60),
  target text not null,
  features jsonb not null,
  training_start date not null,
  training_end date not null,
  validation_start date,
  validation_end date,
  test_start date,
  test_end date,
  metrics jsonb not null default '{}'::jsonb,          -- validation + held-out test + baselines + walk-forward (never training accuracy)
  backtest jsonb,                                       -- historical simulation, labelled "not a guarantee"
  blend_weights jsonb not null default '{"rule":0.6,"ml":0.4}'::jsonb,
  status text not null check (status in ('candidate','production','archived','rejected')),
  decision_reason text,
  ml_status text check (ml_status in ('ok','insufficient_evidence','not_enough_data','unavailable')),
  artifact_uri text,
  artifact_sha256 text,
  dataset_hash text,
  feature_set_version int,
  n_train_rows int check (n_train_rows is null or n_train_rows >= 0),
  n_symbols int check (n_symbols is null or n_symbols >= 0),
  promoted_at timestamptz,
  created_at timestamptz not null default now()
);
-- At most ONE production model at any time.
create unique index ml_models_single_production on public.ml_models ((true)) where status = 'production';
create index ml_models_status_idx on public.ml_models (status, created_at desc);

-- ml_predictions: one row per (symbol, date, model version). Never overwritten across versions. ------------
create table public.ml_predictions (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[A-Za-z0-9.\-^=&:_]{1,32}$'),
  prediction_date date not null,
  model_version text not null references public.ml_models (version) on delete restrict,
  status text not null check (status in ('ok','insufficient_history','low_quality','stale_data','unavailable')),
  positive_3m_probability numeric(6,5) check (positive_3m_probability is null or positive_3m_probability between 0 and 1),
  positive_6m_probability numeric(6,5) check (positive_6m_probability is null or positive_6m_probability between 0 and 1),
  expected_3m_return numeric(10,6),
  expected_6m_return numeric(10,6),
  expected_volatility_3m numeric(10,6) check (expected_volatility_3m is null or expected_volatility_3m >= 0),
  expected_drawdown_3m numeric(10,6) check (expected_drawdown_3m is null or expected_drawdown_3m <= 0),
  risk_level text check (risk_level is null or risk_level in ('low','moderate','high','unknown')),
  risk_source text check (risk_source is null or risk_source in ('ml','rule','none')),
  ml_score numeric(6,3) check (ml_score is null or ml_score between 0 and 100),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  confidence_label text check (confidence_label is null or confidence_label in ('high','medium','low')),
  confidence_components jsonb,
  data_completeness numeric(5,4) check (data_completeness is null or data_completeness between 0 and 1),
  top_positive_factors jsonb not null default '[]'::jsonb,
  top_negative_factors jsonb not null default '[]'::jsonb,
  detail text check (detail is null or char_length(detail) <= 300),
  created_at timestamptz not null default now(),
  unique (symbol, prediction_date, model_version)       -- prediction cache key
);
create index ml_predictions_symbol_date_idx on public.ml_predictions (symbol, prediction_date desc);
create index ml_predictions_version_idx on public.ml_predictions (model_version);

-- ml_evaluations: detailed evaluation payloads per model (metrics / backtest) ---------------------------------
create table public.ml_evaluations (
  id uuid primary key default gen_random_uuid(),
  model_version text not null references public.ml_models (version) on delete cascade,
  split text not null check (split in ('metrics','validation','test','walk_forward','backtest')),
  metrics jsonb not null,
  created_at timestamptz not null default now(),
  unique (model_version, split)
);

-- ml_fundamental_snapshots: POINT-IN-TIME fundamentals, captured whenever the screener fetches them. ----------
-- The provider only exposes CURRENT fundamentals, so history cannot be reconstructed without look-ahead bias.
-- Accumulating dated snapshots lets a future model version train on fundamentals legitimately.
create table public.ml_fundamental_snapshots (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol ~ '^[A-Za-z0-9.\-^=&:_]{1,32}$'),
  snapshot_date date not null,
  payload jsonb not null,
  source text not null default 'yahoo-quoteSummary (unofficial)',
  created_at timestamptz not null default now(),
  unique (symbol, snapshot_date)
);
create index ml_fund_snap_symbol_idx on public.ml_fundamental_snapshots (symbol, snapshot_date desc);

-- Row Level Security --------------------------------------------------------------------------------------------
alter table public.ml_models                enable row level security;
alter table public.ml_predictions           enable row level security;
alter table public.ml_evaluations           enable row level security;
alter table public.ml_fundamental_snapshots enable row level security;

create policy "ml_models_read" on public.ml_models for select to authenticated using (true);
create policy "ml_predictions_read" on public.ml_predictions for select to authenticated using (true);
create policy "ml_evaluations_read" on public.ml_evaluations for select to authenticated using (true);
-- ml_fundamental_snapshots: intentionally NO policy => no client access at all (service_role bypasses RLS).

-- Defence in depth: clients can never write these tables; anonymous visitors get nothing.
revoke all on public.ml_models, public.ml_predictions, public.ml_evaluations, public.ml_fundamental_snapshots from anon;
revoke insert, update, delete, truncate on public.ml_models, public.ml_predictions, public.ml_evaluations from authenticated;
revoke all on public.ml_fundamental_snapshots from authenticated;

-- Private bucket for trained model files (pickles!): no policies for anon/authenticated => service_role only.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ml-artifacts', 'ml-artifacts', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
