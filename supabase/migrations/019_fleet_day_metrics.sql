-- Daily fleet metrics: distance driven, and the vehicles that moved.
--
-- Distance is reconstructed from fleet_snapshots rather than read from an
-- odometer, because the snapshots are already there and an odometer would
-- be one more Wialon field to trust. The reconstruction has two wrinkles
-- worth knowing about:
--
--   1. A stale position REPEATS across snapshots — Wialon keeps returning
--      the last known fix with a growing age_minutes. Differencing raw
--      snapshot rows therefore sees a truck "teleport" the moment it comes
--      back online, inside a single 60s snapshot gap. Subtracting
--      age_minutes recovers the real fix time, and DISTINCT collapses the
--      repeats. Measured on a real day this is the difference between
--      discarding 14% of the fleet's distance as bogus and discarding 1.8%.
--
--   2. GPS jitters while parked. Segments under 25 m are dropped (38 km
--      of noise across the fleet on the day tested), and anything implying
--      over ~140 km/h is dropped as a bad fix (391 km, 1.9k segments).
--
-- The whole-day query costs ~1s and spills to disk, which is fine every
-- few minutes and far too slow for a dashboard that polls. So it is
-- computed on a schedule into this table and the page reads one row.
-- Keeping the results also outlives fleet_snapshots' 7-day pruning, so
-- daily history survives even though the positions behind it do not.

CREATE TABLE IF NOT EXISTS public.fleet_day_metrics (
  ops_day DATE PRIMARY KEY,
  km NUMERIC NOT NULL DEFAULT 0,
  vehicles_moved INT NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fleet_day_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_day_metrics_select" ON public.fleet_day_metrics;
CREATE POLICY "fleet_day_metrics_select" ON public.fleet_day_metrics
  FOR SELECT TO authenticated USING (true);

-- Recompute one operations day. Defaults to today in Africa/Algiers,
-- which is the timezone the rest of the app reports in (see lib/format.ts).
CREATE OR REPLACE FUNCTION public.refresh_fleet_day_metrics(p_day DATE DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_day      DATE;
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ;
  v_km       NUMERIC;
  v_vehicles INT;
BEGIN
  v_day   := COALESCE(p_day, (NOW() AT TIME ZONE 'Africa/Algiers')::date);
  v_start := (v_day::timestamp) AT TIME ZONE 'Africa/Algiers';
  v_end   := ((v_day + 1)::timestamp) AT TIME ZONE 'Africa/Algiers';

  WITH fixes AS (
    -- One hour of lookback so the first fix inside the day has a
    -- predecessor to measure from; segments before v_start are discarded
    -- further down rather than counted against this day.
    SELECT DISTINCT
      (t->>'truck_id') AS truck_id,
      s.captured_at - make_interval(mins => (t->>'age_minutes')::int) AS fixed_at,
      (t->>'lat')::float8 AS lat,
      (t->>'lng')::float8 AS lng
    FROM public.fleet_snapshots s,
         LATERAL jsonb_array_elements(s.snapshot_data) t
    WHERE s.captured_at >= v_start - interval '1 hour'
      AND s.captured_at <  v_end
      AND t->>'lat' IS NOT NULL
      AND t->>'lng' IS NOT NULL
      AND t->>'age_minutes' IS NOT NULL
  ),
  seg AS (
    SELECT
      truck_id,
      fixed_at,
      ST_Distance(
        ST_MakePoint(lng, lat)::geography,
        ST_MakePoint(lag(lng) OVER w, lag(lat) OVER w)::geography
      ) AS m,
      EXTRACT(epoch FROM fixed_at - lag(fixed_at) OVER w) AS secs
    FROM fixes
    WINDOW w AS (PARTITION BY truck_id ORDER BY fixed_at)
  ),
  kept AS (
    SELECT truck_id, m
    FROM seg
    WHERE fixed_at >= v_start
      AND m >= 25             -- parked GPS jitter
      AND secs > 0
      AND m / secs <= 39      -- ~140 km/h: a bad fix, not a truck
  )
  -- ST_Distance returns double precision, and round(double, int) has no
  -- overload in Postgres — only round(numeric, int).
  SELECT COALESCE(ROUND((SUM(m) / 1000.0)::numeric, 1), 0), COUNT(DISTINCT truck_id)
    INTO v_km, v_vehicles
  FROM kept;

  INSERT INTO public.fleet_day_metrics (ops_day, km, vehicles_moved, computed_at)
  VALUES (v_day, v_km, v_vehicles, NOW())
  ON CONFLICT (ops_day) DO UPDATE
    SET km = EXCLUDED.km,
        vehicles_moved = EXCLUDED.vehicles_moved,
        computed_at = EXCLUDED.computed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_fleet_day_metrics(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_fleet_day_metrics(DATE) FROM anon;

-- Every five minutes. The figure is a running total for a day in
-- progress, so it does not need to be fresher than the coffee.
SELECT cron.unschedule('fleet-day-metrics')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-day-metrics');

SELECT cron.schedule(
  'fleet-day-metrics',
  '*/5 * * * *',
  $cron$SELECT public.refresh_fleet_day_metrics();$cron$
);
