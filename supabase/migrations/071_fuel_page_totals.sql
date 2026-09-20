-- ── 071: the Carburant page's total pills ────────────────────────
--
-- The owner asked for the month's five totals as little pills above
-- the transactions: amount, litres, distance, average L/100km and
-- variance. The page already carries three of them (total_rows/
-- total_litres/total_amount_da) on the pagination call — the header
-- costs one round trip on purpose. Distance, consumption and variance
-- join them on the same call, computed with the SAME rules
-- fuel_period_stats uses (047), so the pill row and the dashboard's
-- KPI strip can never disagree about a figure:
--
--   km                  fills that priced a distance (variance_da not
--                       null), like the KPI strip's "Kilometres driven".
--   litres/100km        consumption on those same priced fills; a fill
--                       with no distance is bought and never counted as
--                       burned.
--   variance            the sum of every fill's variance_da, signed.
--
-- The signature is unchanged, so CREATE OR REPLACE replaces the 068
-- function in place — no second overload, and the grants below are
-- re-asserted for a fresh apply.

CREATE OR REPLACE FUNCTION public.fuel_page_transactions(
  p_from      DATE DEFAULT NULL,
  p_to        DATE DEFAULT NULL,
  p_driver    TEXT DEFAULT NULL,
  p_truck     TEXT DEFAULT NULL,
  p_model     TEXT DEFAULT NULL,
  p_page      INTEGER DEFAULT 0,
  p_page_size INTEGER DEFAULT 200
)
RETURNS TABLE (
  sheet_row            INTEGER,
  occurred_raw         TEXT,
  occurred_at          TIMESTAMPTZ,
  model                TEXT,
  truck_id             TEXT,
  category             TEXT,
  driver_name          TEXT,
  card_no              TEXT,
  station              TEXT,
  fuel_type            TEXT,
  amount_da            NUMERIC,
  odometer_km          NUMERIC,
  distance_km          NUMERIC,
  litres_filled        NUMERIC,
  variance_da          NUMERIC,
  total_rows           BIGINT,
  total_km             NUMERIC,
  total_litres         NUMERIC,
  total_amount_da      NUMERIC,
  total_litres_per_100km NUMERIC,
  total_variance_da    NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    f.sheet_row,
    f.occurred_raw,
    f.occurred_at,
    f.model,
    f.truck_id,
    f.category,
    f.driver_name,
    f.card_no,
    f.station,
    f.fuel_type,
    f.amount_da,
    f.odometer_km,
    f.distance_km,
    f.litres_filled,
    f.variance_da,
    count(*)           OVER () AS total_rows,
    -- distance only counts on fills that priced one: see 047.
    COALESCE(sum(f.distance_km) FILTER (WHERE f.variance_da IS NOT NULL) OVER (), 0) AS total_km,
    sum(f.litres_filled) OVER () AS total_litres,
    sum(f.amount_da)     OVER () AS total_amount_da,
    -- Consumption is litres bought / distance driven on the priced
    -- fills, per 100 km — the sheet's own assumed 45 sits on the same
    -- subset, so these two figures are comparable.
    round(
      COALESCE(sum(f.litres_filled) FILTER (WHERE f.variance_da IS NOT NULL) OVER (), 0) * 100
      / NULLIF(sum(f.distance_km) FILTER (WHERE f.variance_da IS NOT NULL) OVER (), 0), 2
    )                                                                 AS total_litres_per_100km,
    COALESCE(sum(f.variance_da) OVER (), 0)                           AS total_variance_da
  FROM public.fuel_transactions f
  WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
    AND (p_driver IS NULL
         OR public.norm_driver_name(f.driver_name) = public.norm_driver_name(p_driver))
    AND (p_truck IS NULL OR f.truck_id = p_truck)
    AND (p_model IS NULL OR f.model = p_model)
  -- By position in the sheet, newest last-written first — the same
  -- ordering the page always used. occurred_at is NOT trusted for
  -- ordering: the sheet's date column was mixed-format for half its
  -- life and the raw position is the one truth that never moved.
  ORDER BY f.sheet_row DESC NULLS LAST
  LIMIT LEAST(p_page_size, 500)
  OFFSET p_page * LEAST(p_page_size, 500)
$function$;

-- Same lockdown as 068: revoke from PUBLIC and anon before granting to
-- the app's users, in that order — the revoke alone locks the app out
-- too. OR REPLACE keeps existing grants, but re-asserting keeps a fresh
-- apply intact.
REVOKE ALL ON FUNCTION public.fuel_page_transactions(date, date, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuel_page_transactions(date, date, text, text, text, integer, integer) TO authenticated;