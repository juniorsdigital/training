# Training App

## Environment Variables

- `SUPABASE_URL` - Supabase project URL.
- `SUPABASE_ANON_KEY` - Supabase anon key for client auth bootstrap.
- `SUPABASE_SERVICE_ROLE_KEY` - service role key used by server API routes.
- `ALLOWED_LOGIN_EMAIL` - only this email is allowed to access protected routes.
- `INTERVALS_API_KEY` - Intervals.icu API key for activity sync.
- `INTERVALS_ATHLETE_ID` - Intervals athlete ID.
- `GEMINI_API_KEY` - API key used by training-plan messaging AI proposal endpoint.
- `GEMINI_MODEL` - optional Gemini model override; defaults to `gemini-2.0-flash`.
- `CRON_SECRET` - shared secret for Vercel Cron requests to protected automation routes.

## Gemini API Setup

- Create a Gemini API key in Google AI Studio: [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
- Store `GEMINI_API_KEY` as a server-side environment variable only.
- On Vercel, add it in Project Settings -> Environment Variables (Production/Preview/Development as needed).
- For local development, keep it in `.env.local` (gitignored) and never hardcode it in `index.html` or other client-side files.

## Daily automation

- Vercel Cron runs `GET /api/daily-training-recommendations` daily at `12:00 UTC` (`0 12 * * *`).
- The route analyzes yesterday's readiness + workout context, compares against the canonical plan, and returns recommendation operations when deviations are warranted.
- Set `CRON_SECRET` in Vercel so cron calls are authenticated via `Authorization: Bearer <CRON_SECRET>`.
