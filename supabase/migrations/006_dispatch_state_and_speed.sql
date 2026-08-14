-- ━─ Dispatch state: current off-route / speeding flags ━──
-- Distinct from ever_off_route / ever_speeding (lifetime,
-- never reset). These reset per check so a notification
-- fires once per violation (on the under→over transition),
-- not on every single position poll while it stays violated.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS is_off_route BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_speeding  BOOLEAN NOT NULL DEFAULT FALSE;

-- ━─ End of migration ━───────────────────────────────────
