-- ━─ HQ (PARC OMD) arrival notifications ━──────────────────
-- Site/factory arrival is tracked per-dispatch (dispatches.*_notified
-- flags), but HQ arrival isn't tied to any delivery run — trucks
-- return to base whether or not they're currently dispatched. Needs
-- its own per-truck transition flag instead.

ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS at_hq BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('off_route', 'speeding', 'site_arrival', 'factory_arrival', 'hq_arrival'));
