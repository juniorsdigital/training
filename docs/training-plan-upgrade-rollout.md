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

### 2b) Canonical export file from embedded `WEEKS` (repo artifact)

The checked-in [`data/legacy-weeks.json`](../data/legacy-weeks.json) mirrors the legacy `WEEKS` array from [`index.html`](../index.html). Regenerate it after editing `WEEKS` (same bracket-extraction approach as `scripts/build-canonical-export-from-weeks.js`, or re-run your extraction command).

- **Generate** the same JSON shape the app uses for **Export Canonical Plan**:

  ```bash
  node scripts/build-canonical-export-from-weeks.js --out training-plan-canonical.json
  ```

  Optional: `--start-date YYYY-MM-DD`, `--name "My Plan"`, or a path to a legacy weeks JSON file as the first argument.

- **Import (overwrites canonical plan):** sign in → **Plan Editor** → **Import and Overwrite Plan** → choose the generated file. Export the current canonical plan first if you need a backup.

- **Import via API:** `POST /api/training-plan-import` with the file body as JSON and `Authorization: Bearer <access_token>`.

- **Verify:** reload the app, confirm **Plan Editor** shows the plan and **Today / Week / Full Calendar** match `start_date` (default `2026-05-04`, aligned with `PLAN_START` in `index.html`). Optionally export again from the app and diff against the generated file (IDs and `exported_at` will differ; `plan.days` content should match aside from server-assigned row IDs after import).

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
  - click **Export Canonical Plan** and verify file downloads
  - edit exported JSON offline and import it with **Import and Overwrite Plan**
  - verify Today/Week/Calendar reflect imported plan updates
- Export/import:
  - export a plan and inspect top-level `documentation` section
  - confirm `documentation.import_mode` is `overwrite-canonical`
  - import exported file and confirm canonical plan version increments
- Workout sync:
  - trigger **Sync to DB**
  - verify response source (`garmin` or `intervals`)
  - verify power columns persisted in `intervals_activity_snapshots`

## 5) Backward compatibility checks

- If plan APIs fail, app still uses built-in legacy `WEEKS`.
- Existing nutrition logging endpoints and dashboard loading remain unchanged.
