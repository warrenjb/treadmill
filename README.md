# treadmill

Workout dashboard for the homemade Sole F80 treadmill tracker (ESP32 + TCRT5000 belt sensor).

**How data flows:** ESP32 → Google Apps Script web app → *Treadmill Log* Google Sheet (one tab per person) → Supabase `treadmill_sessions` table → this dashboard.

- `index.html` — the dashboard. Sign in with the same Supabase account used by the sit-up and foot pod pages. Filter by person and date range.
- `apps-script/SupabaseSync.gs` — the Apps Script file that copies each logged workout from the sheet into Supabase. The secret key lives only in the script's properties, never in this repo.

Only the publishable Supabase key appears in this repo; row-level security limits reads to the signed-in owner.
