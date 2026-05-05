# Training Plan Upgrade Rollout

## 1) Apply database migration

- Run the SQL migration: `supabase/migrations/20260505_training_plan_editor.sql`.
- This creates:
  - `training_plans`
  - `training_plan_days`
  - `training_plan_day_goals`
- This also extends `intervals_activity_snapshots` with:
  - `avg_power`
  - `normalized_power`
  - `max_power`
  - `source`

## 2) Seed initial legacy plan (one-time)

- Sign in to the app as the allowed account.
- Open **Plan Editor**.
- If no plans exist, call `POST /api/training-plan-seed-legacy` with:
  - `start_date` (default `2026-05-04`)
  - `weeks` (legacy `WEEKS` array payload)

## 3) Configure workout providers

- Garmin primary provider:
  - `GARMIN_CONNECT_BASE_URL`
  - `GARMIN_API_TOKEN`
  - optional `GARMIN_ATHLETE_ID`
- Intervals fallback:
  - `INTERVALS_API_KEY`
  - `INTERVALS_ATHLETE_ID`

If Garmin is unavailable/unconfigured, sync falls back to Intervals automatically.

## 4) Validate the full flow

- Plan management:
  - create/select plan in **Plan Editor**
  - edit and save a workout day with goals JSON
  - verify Today/Week/Calendar reflect changes
- Export/import:
  - export a plan and inspect top-level `documentation` section
  - import exported file as a new version
- Workout sync:
  - trigger **Sync to DB**
  - verify response source (`garmin` or `intervals`)
  - verify power columns persisted in `intervals_activity_snapshots`

## 5) Backward compatibility checks

- If plan APIs fail, app still uses built-in legacy `WEEKS`.
- Existing nutrition logging endpoints and dashboard loading remain unchanged.
