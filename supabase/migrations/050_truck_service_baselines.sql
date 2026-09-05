-- ━─ Service baselines: the one thing telemetry cannot know ━──────────
--
-- Prism already measures how far every truck goes: fleet_day_metrics
-- carries distance per truck per day from the snapshots, and every fuel
-- fill carries a real odometer reading. What it cannot know is where to
-- start counting from — when each truck last had its oil changed, and
-- when its current tyres went on. Nobody has that written down, which is
-- why /maintenance ships with both sections marked coming soon.
--
-- This table is that starting point, and nothing more. It is deliberately
-- one row per truck rather than a service history: the history is the
-- next feature and will reference these rows, but capturing 90 baselines
-- has to be possible before any of it works, and a history table would
-- ask the operator to model a past they do not have.
--
-- Keyed on truck_id text, not a foreign key to fleet_trucks: truck ids
-- come from Wialon and the fuel sheet keys on the same string, so a
-- baseline should survive a vehicle row being rebuilt from the feed.
--
-- WRITES ARE OPEN TO ANY AUTHENTICATED USER, which is a deliberate
-- departure from driver_directory (018/024), where writes are admin-only
-- because the rows hold staff phone numbers and home addresses. A service
-- baseline is operational, non-personal and correctable, and the whole
-- point is to capture it opportunistically as a date surfaces from a
-- driver or a mechanic — restricting it to admins would put the one
-- person who does not have the information in charge of entering it.
-- Tightening this to admin-only later is a single policy change.

CREATE TABLE IF NOT EXISTS public.truck_service_baselines (
  truck_id        text PRIMARY KEY,
  oil_changed_on  date,
  oil_changed_km  numeric,
  tyres_fitted_on date,
  tyres_fitted_km numeric,
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.truck_service_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_baselines_select"
  ON public.truck_service_baselines FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "service_baselines_insert"
  ON public.truck_service_baselines FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "service_baselines_update"
  ON public.truck_service_baselines FOR UPDATE TO authenticated
  USING (true);

-- Same reasoning as driver_directory: nothing else maintains updated_at,
-- and "when was this last touched" is the only audit this table gets.
CREATE OR REPLACE FUNCTION public.touch_truck_service_baselines()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS truck_service_baselines_touch ON public.truck_service_baselines;
CREATE TRIGGER truck_service_baselines_touch
  BEFORE UPDATE ON public.truck_service_baselines
  FOR EACH ROW EXECUTE FUNCTION public.touch_truck_service_baselines();
