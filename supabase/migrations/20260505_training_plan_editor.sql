-- Training plan editor schema + workout power persistence.

create extension if not exists "pgcrypto";

create table if not exists public.training_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  version integer not null default 1,
  start_date date not null,
  total_weeks integer,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.training_plan_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.training_plans(id) on delete cascade,
  week_index integer not null,
  day_index integer not null check (day_index between 0 and 6),
  day_date date not null,
  session_type text not null default 'rest',
  label text not null,
  details text,
  target_watts_label text,
  am_session text,
  pm_session text,
  phase_label text,
  phase_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_id, week_index, day_index)
);

create table if not exists public.training_plan_day_goals (
  id uuid primary key default gen_random_uuid(),
  plan_day_id uuid not null references public.training_plan_days(id) on delete cascade,
  goal_type text not null,
  target_value numeric,
  unit text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_training_plan_days_plan_week_day
  on public.training_plan_days(plan_id, week_index, day_index);

create index if not exists idx_training_plan_day_goals_plan_day
  on public.training_plan_day_goals(plan_day_id, sort_order);

alter table if exists public.intervals_activity_snapshots
  add column if not exists avg_power numeric,
  add column if not exists normalized_power numeric,
  add column if not exists max_power numeric,
  add column if not exists source text;
