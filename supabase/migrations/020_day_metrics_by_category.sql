-- Split the daily distance by vehicle category.
--
-- Fuel on this fleet is not metered — Wialon derives it from a per-unit
-- consumption rate the office configured, and this app derives it the
-- same way so the two figures agree. That only holds if the rates are
-- applied at the same granularity: a semi is configured around
-- 35-45 L/100km and a staff car around 7-9, so one blended rate over the
-- whole fleet is the wrong shape regardless of which number you pick.
--
-- Measured on a full day: staff cars are 8 vehicles and 592 km (2.5% of
-- distance) against 77 trucks and 22,619 km. Blending overstates fuel by
-- roughly 2% — small, but free to get right, and it means the number can
-- be reconciled against Wialon instead of merely resembling it.
--
-- Total km stays in `km` rather than becoming the sum of the two columns:
-- a snapshot written before categories existed has no category, and those
-- rows should still count toward distance even when they cannot be
-- attributed to a rate.

ALTER TABLE public.fleet_day_metrics
  ADD COLUMN IF NOT EXISTS km_truck NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS km_staff NUMERIC NOT NULL DEFAULT 0;

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
  v_km_truck NUMERIC;
  v_km_staff NUMERIC;
  v_vehicles INT;
BEGIN
  v_day   := COALESCE(p_day, (NOW() AT TIME ZONE 'Africa/Algiers')::date);
  v_start := (v_day::timestamp) AT TIME ZONE 'Africa/Algiers';
  v_end   := ((v_day + 1)::timestamp) AT TIME ZONE 'Africa/Algiers';

  WITH fixes AS (
    SELECT DISTINCT
      (t->>'truck_id') AS truck_id,
      COALESCE(t->>'category', 'truck') AS category,
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
      category,
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
    SELECT truck_id, category, m
    FROM seg
    WHERE fixed_at >= v_start
      AND m >= 25             -- parked GPS jitter
      AND secs > 0
      AND m / secs <= 39      -- ~140 km/h: a bad fix, not a truck
  )
  SELECT
    COALESCE(ROUND((SUM(m) / 1000.0)::numeric, 1), 0),
    COALESCE(ROUND((SUM(m) FILTER (WHERE category = 'truck') / 1000.0)::numeric, 1), 0),
    COALESCE(ROUND((SUM(m) FILTER (WHERE category = 'staff') / 1000.0)::numeric, 1), 0),
    COUNT(DISTINCT truck_id)
  INTO v_km, v_km_truck, v_km_staff, v_vehicles
  FROM kept;

  INSERT INTO public.fleet_day_metrics
    (ops_day, km, km_truck, km_staff, vehicles_moved, computed_at)
  VALUES (v_day, v_km, v_km_truck, v_km_staff, v_vehicles, NOW())
  ON CONFLICT (ops_day) DO UPDATE
    SET km = EXCLUDED.km,
        km_truck = EXCLUDED.km_truck,
        km_staff = EXCLUDED.km_staff,
        vehicles_moved = EXCLUDED.vehicles_moved,
        computed_at = EXCLUDED.computed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_fleet_day_metrics(DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_fleet_day_metrics(DATE) FROM anon;
