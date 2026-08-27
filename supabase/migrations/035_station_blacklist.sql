-- Blacklisted stations, and a stop alert for them.
--
-- Some stations take money from drivers. The operator wants to mark one,
-- see it in red on the map, and be told when a truck STOPS there — early
-- enough to phone the driver before anything is handed over.

-- ── 1. Stations get a radius, and a blacklist ──
--
-- 50m is the forecourt. Verified against 24h of snapshots before
-- choosing it: at 50m, 29 trucks were caught stopped at 13 stations, so
-- it is not so tight that GPS noise loses real stops.
ALTER TABLE public.gas_stations
  ADD COLUMN IF NOT EXISTS radius_meters   integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS blacklisted     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS blacklisted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS blacklisted_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blacklist_note  text;

ALTER TABLE public.gas_stations
  DROP CONSTRAINT IF EXISTS gas_stations_radius_sane;
ALTER TABLE public.gas_stations
  ADD CONSTRAINT gas_stations_radius_sane CHECK (radius_meters BETWEEN 20 AND 2000);

-- The radius a blacklisted station is watched at. WIDER ON PURPOSE: the
-- point of the alert is to reach the driver before money changes hands,
-- and 50m only catches him once he is on the forecourt. 150m picks him
-- up on the approach apron and in the queue.
--
-- DERIVED, never written back into radius_meters. Storing it would mean
-- un-blacklisting a station left it stuck at 150m, and an admin who had
-- deliberately set a wider radius would have it clobbered. GREATEST also
-- means a hand-set radius above 150 is respected rather than shrunk.
CREATE OR REPLACE FUNCTION public.station_watch_radius(
  p_radius_meters integer,
  p_blacklisted   boolean
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_blacklisted THEN GREATEST(COALESCE(p_radius_meters, 50), 150)
              ELSE COALESCE(p_radius_meters, 50) END;
$$;

GRANT EXECUTE ON FUNCTION public.station_watch_radius(integer, boolean) TO authenticated;

-- ── 2. Where a truck is currently stopped ──
--
-- at_hq and at_factory are one boolean per zone, which does not scale to
-- 51 stations. This is one column holding WHICH blacklisted station a
-- truck is stopped at, so the alert fires on the transition into one.
--
-- Only blacklisted stations are tracked. A stop at an ordinary station
-- raises nothing, so recording it would be writes for no reader — the
-- column name says so.
ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS at_blacklisted_station_id uuid
    REFERENCES public.gas_stations(id) ON DELETE SET NULL;

-- Compare-and-set, returning only the trucks that actually changed —
-- the same contract as mark_trucks_hq_state, and load-bearing for the
-- same reasons: it is what stops a re-notify every tick, and the
-- DISTINCT is what stops a duplicated Wialon unit name failing the whole
-- statement with 21000.
--
-- IS DISTINCT FROM rather than <> so that NULL (not at a blacklisted
-- station) compares correctly in both directions.
CREATE OR REPLACE FUNCTION public.mark_trucks_station_state(
  p_truck_ids  text[],
  p_station_id uuid
)
RETURNS TABLE (truck_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.fleet_trucks (truck_id, at_blacklisted_station_id)
  SELECT DISTINCT u, p_station_id FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET at_blacklisted_station_id = EXCLUDED.at_blacklisted_station_id,
        updated_at = NOW()
    WHERE public.fleet_trucks.at_blacklisted_station_id
          IS DISTINCT FROM EXCLUDED.at_blacklisted_station_id
  RETURNING public.fleet_trucks.truck_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_trucks_station_state(text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_trucks_station_state(text[], uuid) TO service_role;

-- ── 3. The new alert kind ──
--
-- The CHECK constraint has to learn the kind BEFORE any code emits it.
-- A rejected insert here returns 23514, and the precedent in this
-- codebase is that such a rejection was swallowed while the paired flag
-- was written anyway — killing the alert silently for good. Migration
-- 026 exists because of exactly that.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'off_route', 'speeding', 'site_arrival', 'site_approaching',
    'factory_arrival', 'hq_arrival', 'station_stop'
  ]));
