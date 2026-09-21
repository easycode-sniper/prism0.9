-- Approach rings for blacklisted stations, and an approach alert for them.
--
-- The stop alert (035) cannot be made earlier: it fires only once a truck
-- is IDLE inside the 150m watch radius, because presence is not arrival
-- and a driving pass must raise nothing. For a station the owner is
-- SUING, those 150m are a 10-minute warning — the truck is already on the
-- forecourt. This migration adds a second, independent tier: a big ring
-- around the station, NULL by default (feature off), armed per station.
-- A truck ENTERING the ring raises one station_approach alert, giving
-- the office time to phone the driver before anything is handed over.
--
-- ANY truck inside the ring, with no idle requirement and no heading
-- filter: the owner's call, for a station on a corridor few trucks
-- travel. The ring is deliberately large (30km for the one armed so
-- far) and the feature is TEMPORARY — it exists until the legal case
-- ends, then the column is set back to NULL. The per-station column
-- makes that a one-line UPDATE, and the fifty-odd other stations are
-- untouched either way.

-- ── 1. Stations get an approach ring ──
-- 2000–50000m: below 2km is inside the stop check's job, and past 50km
-- the "approach" is the whole region.
ALTER TABLE public.gas_stations
  ADD COLUMN IF NOT EXISTS approach_radius_meters integer;

ALTER TABLE public.gas_stations
  DROP CONSTRAINT IF EXISTS gas_stations_approach_radius_sane;
ALTER TABLE public.gas_stations
  ADD CONSTRAINT gas_stations_approach_radius_sane
  CHECK (approach_radius_meters IS NULL OR approach_radius_meters BETWEEN 2000 AND 50000);

-- ── 2. Where a truck currently inside an approach ring ──
-- Same shape as at_blacklisted_station_id (035): WHICH station, not a
-- boolean per station, so moving between two armed rings is a real
-- transition and alerts again. One uuid column can only point at one
-- ring; a truck approaching A while stopped at B reads as "in B's ring"
-- if B has one, which cannot happen in practice because a stop at B
-- means the truck is on B's forecourt and the stop check (035) owns that
-- flag separately.
ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS approaching_blacklisted_station_id uuid
    REFERENCES public.gas_stations(id) ON DELETE SET NULL;

-- Compare-and-set, returning only the trucks that actually changed —
-- the same contract as mark_trucks_station_state, and load-bearing for
-- the same reasons: it is what stops a re-notify every tick, and the
-- DISTINCT is what stops a duplicated Wialon unit name failing the whole
-- statement with 21000.
CREATE OR REPLACE FUNCTION public.mark_trucks_approaching_state(
  p_truck_ids  text[],
  p_station_id uuid
)
RETURNS TABLE (truck_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.fleet_trucks (truck_id, approaching_blacklisted_station_id)
  SELECT DISTINCT u, p_station_id FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET approaching_blacklisted_station_id = EXCLUDED.approaching_blacklisted_station_id,
        updated_at = NOW()
    WHERE public.fleet_trucks.approaching_blacklisted_station_id
          IS DISTINCT FROM EXCLUDED.approaching_blacklisted_station_id
  RETURNING public.fleet_trucks.truck_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_trucks_approaching_state(text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_trucks_approaching_state(text[], uuid) TO service_role;

-- ── 3. The new alert kind ──
-- The CHECK constraint has to learn the kind BEFORE any code emits it, or
-- the insert returns 23514 and — the migration-026 lesson — the alert
-- dies silently while the paired flag is written anyway.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'off_route', 'speeding', 'site_arrival', 'site_approaching',
    'factory_arrival', 'hq_arrival', 'station_stop', 'station_approach'
  ]));