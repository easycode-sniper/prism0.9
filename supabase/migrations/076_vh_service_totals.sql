-- 076: the Staff & service spend, as its own aggregate.
--
-- Every fuel surface on the dashboard — fuel_period_stats (the five
-- scorecards), the variance leaders, the model treemap, the station
-- donut, the daily series — reads the CARGO fleet. The staff cars,
-- workshop, generator and pool vehicles are logged in the sheet under
-- "VH SERVICE" rather than by plate (zero fills name a staff plate —
-- checked 2026-09-24), so `category = 'vh_service'` IS the non-cargo
-- fleet. Those fills carry no odometer and no distance (the parser
-- buckets them separately for exactly that reason), so they have no km,
-- no L/100km and no variance to put in those tables. What they do
-- carry is money, and that money is currently invisible everywhere:
-- 871 fills and ~1.17M DA over Jan-Sep 2026, about 1% of the fuel bill,
-- shown as nothing at all.
--
-- This aggregate gives the page ONE number for that pot — the money —
-- with no km, no consumption rate and no comparison, because the data
-- carries none. Scoped exactly like fuel_period_stats (same range, same
-- driver/truck filters) so the sixth scorecard and the five beside it
-- always describe the same window.

CREATE OR REPLACE FUNCTION public.vh_service_fuel_totals(
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_driver TEXT DEFAULT NULL,
  p_truck  TEXT DEFAULT NULL
)
RETURNS TABLE (
  fills     BIGINT,
  amount_da NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    count(*)                            AS fills,
    COALESCE(sum(f.amount_da), 0)       AS amount_da
  FROM public.fuel_transactions f
  WHERE f.category = 'vh_service'
    AND (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
    AND (p_driver IS NULL
         OR public.norm_driver_name(f.driver_name) = public.norm_driver_name(p_driver))
    AND (p_truck IS NULL OR f.truck_id = p_truck);
$function$;

COMMENT ON FUNCTION public.vh_service_fuel_totals(DATE, DATE, TEXT, TEXT) IS
  'Fills and amount for the non-cargo fleet — staff cars, workshop, generator and pool vehicles, logged as VH SERVICE. Backs the "Staff & service" dashboard scorecard. No km, no L/100km, no variance: these fills carry no odometer or distance.';

-- Same lockdown as 061/063: revoke from PUBLIC and anon first, then
-- grant to the app's users — the revoke alone would lock the app out.
REVOKE ALL ON FUNCTION public.vh_service_fuel_totals(DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vh_service_fuel_totals(DATE, DATE, TEXT, TEXT) TO authenticated;

-- PostgREST caches grants too (063): without the reload the API sits a
-- version behind and the dashboard says it cannot find the function.
NOTIFY pgrst, 'reload schema';
