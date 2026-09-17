-- ── 068: the Carburant page, month-sized and filterable ──────────────
--
-- The page showed the last 100 rows and that was that. The owner asked
-- for the whole current month with driver/truck/model filters. The data
-- was never the problem — fuel_transactions already mirrors the whole
-- sheet — so this is a read-shape change, not a storage one.
--
-- It is an RPC rather than PostgREST filters for two reasons the
-- codebase has already paid for:
--
-- 1. THE 1000-ROW CAP. PostgREST truncates every response at 1000 rows
--    without error; a month at current volume (~1500 fills) would
--    silently become "the first thousand". Pagination happens here, in
--    SQL, with the total carried alongside.
-- 2. DRIVER MATCHING. The sheet spells some drivers' names more than
--    one way; every other fuel surface matches through
--    norm_driver_name, which only exists in SQL. The driver filter
--    behaves like the dashboard's, not like string equality.
--
-- The totals ride the same call as window aggregates — identical on
-- every returned row — so the header needs one round trip, not two.

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
  sheet_row       INTEGER,
  occurred_raw    TEXT,
  occurred_at     TIMESTAMPTZ,
  model           TEXT,
  truck_id        TEXT,
  category        TEXT,
  driver_name     TEXT,
  card_no         TEXT,
  station         TEXT,
  fuel_type       TEXT,
  amount_da       NUMERIC,
  odometer_km     NUMERIC,
  distance_km     NUMERIC,
  litres_filled   NUMERIC,
  variance_da     NUMERIC,
  total_rows      BIGINT,
  total_litres    NUMERIC,
  total_amount_da NUMERIC
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
    sum(f.litres_filled) OVER () AS total_litres,
    sum(f.amount_da)     OVER () AS total_amount_da
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

-- The filter pickers, scoped to the month on screen: a driver who only
-- filled in August does not belong in a September dropdown. One JSON
-- object, one call.
CREATE OR REPLACE FUNCTION public.fuel_page_options(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH scoped AS (
    SELECT f.driver_name, f.truck_id, f.model
    FROM public.fuel_transactions f
    WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
      AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
  )
  SELECT jsonb_build_object(
    'drivers', (
      SELECT COALESCE(jsonb_agg(DISTINCT public.norm_driver_name(driver_name)
                                ORDER BY public.norm_driver_name(driver_name)), '[]'::jsonb)
      FROM scoped WHERE driver_name IS NOT NULL
    ),
    'trucks', (
      SELECT COALESCE(jsonb_agg(DISTINCT truck_id ORDER BY truck_id), '[]'::jsonb)
      FROM scoped WHERE truck_id IS NOT NULL
    ),
    'models', (
      SELECT COALESCE(jsonb_agg(DISTINCT model ORDER BY model), '[]'::jsonb)
      FROM scoped WHERE model IS NOT NULL
    )
  )
$function$;

-- Same lockdown as 061: new functions ship with EXECUTE granted to
-- PUBLIC by default; take that away before granting to the app's users,
-- in that order — the revoke alone would lock the app out too.
REVOKE ALL ON FUNCTION public.fuel_page_transactions(date, date, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fuel_page_options(date, date)                                           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuel_page_transactions(date, date, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_page_options(date, date)                                          TO authenticated;
