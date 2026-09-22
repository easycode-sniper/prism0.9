-- 075: per-fill fuel history for one truck (Prism Intelligence detail).
--
-- The intelligence column needs only aggregates (truck_variance_leaders
-- over the current + previous windows), but the truck detail behind it
-- needs the actual fills: per-fill date, litres, distance, variance and
-- driver, so the trend chart plots real observations and the driver
-- timeline is built from exact dates rather than invented ones.
--
-- One truck over two months is dozens of rows, not thousands, so no
-- pagination — the caller asks for one truck and gets all of it.
-- Ordered by occurred_at (tie-break sheet position): the sheet's date
-- column was normalised on 2026-09-09 and occurred_at is what every
-- dashboard series already buckets by.

CREATE OR REPLACE FUNCTION public.truck_fuel_fills(
  p_truck TEXT,
  p_from  DATE DEFAULT NULL,
  p_to    DATE DEFAULT NULL
)
RETURNS TABLE (
  occurred_at   TIMESTAMPTZ,
  litres_filled NUMERIC,
  distance_km   NUMERIC,
  variance_da   NUMERIC,
  driver_name   TEXT,
  station       TEXT,
  odometer_km   NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    f.occurred_at,
    f.litres_filled,
    f.distance_km,
    f.variance_da,
    f.driver_name,
    f.station,
    f.odometer_km
  FROM public.fuel_transactions f
  WHERE f.truck_id = p_truck
    AND (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
  ORDER BY f.occurred_at ASC NULLS LAST, f.sheet_row ASC NULLS LAST
  LIMIT 2000;
$function$;

-- Same lockdown as 061/068: new functions ship with EXECUTE granted to
-- PUBLIC by default; take that away before granting to the app's users,
-- in that order — the revoke alone would lock the app out too.
REVOKE ALL ON FUNCTION public.truck_fuel_fills(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.truck_fuel_fills(text, date, date) TO authenticated;
