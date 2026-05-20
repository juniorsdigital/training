-- Allow multiple training sessions per calendar day (AM/PM slots).
-- Safe to re-run: skips steps that are already applied.

alter table public.training_plan_days
  add column if not exists session_slot integer not null default 0;

alter table public.training_plan_days
  add column if not exists time_slot text;

alter table public.training_plan_days
  add column if not exists week_target_tss numeric;

alter table public.training_plan_days
  drop constraint if exists training_plan_days_plan_id_week_index_day_index_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'training_plan_days_plan_week_day_slot_key'
      and conrelid = 'public.training_plan_days'::regclass
  ) then
    alter table public.training_plan_days
      add constraint training_plan_days_plan_week_day_slot_key
      unique (plan_id, week_index, day_index, session_slot);
  end if;
end $$;
