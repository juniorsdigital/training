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

### 2b) CSV template + CSV import/export

- In **Plan Editor**, use **Download Template CSV** to download a canonical CSV based on the current plan.
- Edit the CSV offline and import with **Import and Overwrite Plan**.
- You can also use **Export Canonical CSV** to download a fresh CSV snapshot at any time.
- **Import via API:** `POST /api/training-plan-import` with `Content-Type: text/csv` and `Authorization: Bearer <access_token>`.
- **Verify:** reload the app, confirm **Plan Editor** shows the plan and **Today / Week / Full Calendar** reflect the imported CSV.

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
  - open **Plan Editor** and confirm canonical plan loads
  - click **Export Canonical CSV** and verify file downloads
  - click **Download Template CSV**, edit it offline, and import it with **Import and Overwrite Plan**
  - verify Today/Week/Calendar reflect imported plan updates
- Export/import:
  - export a plan to CSV and inspect headers / day rows
  - import CSV and confirm canonical plan version increments
- Workout sync:
  - trigger **Sync to DB**
  - verify response source (`garmin` or `intervals`)
  - verify power columns persisted in `intervals_activity_snapshots`

## 5) Backward compatibility checks

- If plan APIs fail, app still uses built-in legacy `WEEKS`.
- Existing nutrition logging endpoints and dashboard loading remain unchanged.
