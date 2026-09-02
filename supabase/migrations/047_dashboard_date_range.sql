-- ━─ One date range for the whole dashboard ━────────────────────
--
-- The owner asked for a date filter over the fuel panels: pick August,
-- see August; pick today, see 00:00 to 23:59. Reading the five RPCs
-- behind those panels turned up something worth stating plainly — the
-- page was already showing FOUR DIFFERENT TIME WINDOWS at once, and
-- nothing on screen said so:
--
--   fuel_period_stats        no date filter at all — ALL TIME
--   dashboard_daily_series   trailing p_days, ending today, capped at 90
--   truck_variance_leaders   no date filter at all — ALL TIME
--   driver_variance_leaders  no date filter at all — ALL TIME
--   driver_speeding_leaders  hardcoded to the CURRENT MONTH
--
-- So the scorecards, the charts and the two variance tables were each
-- answering a different question, and the speeding table a fifth. The
-- range control is the fix for that as much as it is a new feature.
--
-- ── The contract ──────────────────────────────────────────────
--
-- p_from and p_to are INCLUSIVE OPERATIONS DAYS in Africa/Algiers, not
-- instants. That is the axis the data already lives on: 028 defined the
-- ops day as (occurred_at AT TIME ZONE 'Africa/Algiers')::date because
-- a fill logged at 00:12 local belongs to the day the office worked it,
-- not to the previous UTC one. Algiers does not observe DST, so the day
-- is a clean 24 hours all year.
--
-- This is exactly what "today, midnight to 23:59" means, without the
-- caller having to build timestamps or worry about the UTC offset —
-- p_from = p_to = today is one whole operations day.
--
-- NULL means unbounded on that side, so an all-time answer is still
-- expressible and the tables' old behaviour is one call away.
--
-- ── Why DROP and not just CREATE OR REPLACE ───────────────────
--
-- CREATE OR REPLACE cannot change a function's argument list: adding
-- p_from/p_to would define a SECOND function beside the old one rather
-- than replacing it. Two overloads is worse than either alone — a call
-- with only p_limit becomes ambiguous, and PostgREST resolves overloads
-- by the argument names in the request body, so the old signature would
-- keep being picked silently. Dropped first, deliberately.

DROP FUNCTION IF EXISTS public.fuel_period_stats();
DROP FUNCTION IF EXISTS public.dashboard_daily_series(INT);
DROP FUNCTION IF EXISTS public.truck_variance_leaders(INT);
DROP FUNCTION IF EXISTS public.driver_variance_leaders(INT);
DROP FUNCTION IF EXISTS public.driver_speeding_leaders(INT);

-- ── 1. The scorecards ─────────────────────────────────────────
CREATE FUNCTION public.fuel_period_stats(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  fills              BIGINT,
  km                 NUMERIC,
  litres             NUMERIC,
  amount_da          NUMERIC,
  litres_per_100km   NUMERIC,
  variance_da        NUMERIC,
  unpaired_fills     BIGINT,
  unpaired_litres    NUMERIC,
  unpaired_amount_da NUMERIC,
  first_raw          TEXT,
  last_raw           TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  -- A fill with no variance is one the sheet could not price against a
  -- distance, which means no kilometres were logged for it: a staff
  -- vehicle, or a truck's first ever fill. Those count towards what was
  -- bought and never towards what the fleet burns.
  WITH scoped AS (
    SELECT * FROM public.fuel_transactions f
    WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
      AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
  )
  SELECT
    count(*)                                                        AS fills,
    COALESCE(sum(distance_km)  FILTER (WHERE variance_da IS NOT NULL), 0) AS km,
    COALESCE(sum(litres_filled), 0)                                 AS litres,
    COALESCE(sum(amount_da), 0)                                     AS amount_da,
    round(
      COALESCE(sum(litres_filled) FILTER (WHERE variance_da IS NOT NULL), 0) * 100
      / NULLIF(sum(distance_km)   FILTER (WHERE variance_da IS NOT NULL), 0), 2
    )                                                               AS litres_per_100km,
    COALESCE(sum(variance_da), 0)                                   AS variance_da,
    count(*)                    FILTER (WHERE variance_da IS NULL)  AS unpaired_fills,
    COALESCE(sum(litres_filled) FILTER (WHERE variance_da IS NULL), 0) AS unpaired_litres,
    COALESCE(sum(amount_da)     FILTER (WHERE variance_da IS NULL), 0) AS unpaired_amount_da,
    -- Scoped to the range too. These are "the first and last fill as the
    -- sheet wrote them", and inside a range that has to mean the first
    -- and last OF THE RANGE — an all-time pair under a filtered figure
    -- would read as the range's own bounds and be wrong. Still taken in
    -- sheet-row order rather than by date: the source was mixed
    -- month/day and day/month until it was normalised, and row order is
    -- correct regardless of how the column is formatted.
    (SELECT occurred_raw FROM scoped
      WHERE sheet_row IS NOT NULL ORDER BY sheet_row ASC  LIMIT 1)   AS first_raw,
    (SELECT occurred_raw FROM scoped
      WHERE sheet_row IS NOT NULL ORDER BY sheet_row DESC LIMIT 1)   AS last_raw
  FROM scoped;
$function$;

-- ── 2. The daily series ───────────────────────────────────────
--
-- p_days is gone. It could only ever express "the last N days ending
-- today", which cannot say "August" — a window that ends in the past —
-- and cannot say "one specific day". The 90-day cap goes with it.
CREATE FUNCTION public.dashboard_daily_series(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  day         DATE,
  km          NUMERIC,
  litres      NUMERIC,
  consumption NUMERIC,
  alerts      BIGINT,
  amount_da   NUMERIC,
  da_per_km   NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH bounds AS (
    SELECT
      COALESCE(p_from, (now() AT TIME ZONE 'Africa/Algiers')::date - 29) AS first_day,
      -- The span is capped at ~3 years, not to be tidy but because this
      -- generates one row per day: an accidental p_from of 1900 would
      -- build 45,000 rows before any data was even joined. The cap is on
      -- the END, so a request always gets the START it asked for and the
      -- truncation is visible as a short series rather than a wrong one.
      LEAST(
        COALESCE(p_to, (now() AT TIME ZONE 'Africa/Algiers')::date),
        COALESCE(p_from, (now() AT TIME ZONE 'Africa/Algiers')::date - 29) + 1095
      ) AS last_day
  ),
  days AS (
    -- generate_series with first_day > last_day yields nothing, which is
    -- the right answer for an inverted range: no days, so no rows.
    SELECT generate_series(first_day, last_day, INTERVAL '1 day')::date AS day FROM bounds
  ),
  fuel AS (
    SELECT (occurred_at AT TIME ZONE 'Africa/Algiers')::date AS day,
           sum(litres_filled)                                        AS litres,
           sum(litres_filled) FILTER (WHERE variance_da IS NOT NULL) AS paired_litres,
           sum(distance_km)   FILTER (WHERE variance_da IS NOT NULL) AS paired_km,
           sum(amount_da)                                            AS amount_da,
           sum(amount_da)     FILTER (WHERE variance_da IS NOT NULL) AS paired_amount_da
    FROM public.fuel_transactions, bounds
    WHERE (occurred_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN first_day AND last_day
    GROUP BY 1
  ),
  alert AS (
    SELECT (created_at AT TIME ZONE 'Africa/Algiers')::date AS day, count(*) AS alerts
    FROM public.notifications, bounds
    WHERE (created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN first_day AND last_day
    GROUP BY 1
  )
  SELECT
    days.day,
    COALESCE(m.km, 0)                                                          AS km,
    COALESCE(fuel.litres, 0)                                                   AS litres,
    round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2)             AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts,
    COALESCE(fuel.amount_da, 0)                                                AS amount_da,
    round(fuel.paired_amount_da / NULLIF(fuel.paired_km, 0), 2)                AS da_per_km
  FROM days
  LEFT JOIN public.fleet_day_metrics m ON m.ops_day = days.day
  LEFT JOIN fuel  ON fuel.day  = days.day
  LEFT JOIN alert ON alert.day = days.day
  ORDER BY days.day;
$function$;

-- ── 3. Variance by truck ──────────────────────────────────────
CREATE FUNCTION public.truck_variance_leaders(
  p_limit INT  DEFAULT 500,
  p_from  DATE DEFAULT NULL,
  p_to    DATE DEFAULT NULL
)
RETURNS TABLE (
  truck_id           TEXT,
  drivers            BIGINT,
  fills              BIGINT,
  km                 NUMERIC,
  litres_per_100km   NUMERIC,
  variance_da        NUMERIC,
  variance_per_100km NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    f.truck_id,
    count(DISTINCT f.driver_name)                                        AS drivers,
    count(*)                                                             AS fills,
    sum(f.distance_km)                                                   AS km,
    round(sum(f.litres_filled) * 100 / NULLIF(sum(f.distance_km), 0), 2) AS litres_per_100km,
    round(sum(f.variance_da))                                            AS variance_da,
    round(sum(f.variance_da) * 100 / NULLIF(sum(f.distance_km), 0))      AS variance_per_100km
  FROM public.fuel_transactions f
  WHERE f.variance_da IS NOT NULL
    AND f.truck_id IS NOT NULL
    AND (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
  GROUP BY f.truck_id
  ORDER BY sum(f.variance_da) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$function$;

-- ── 4. Variance by driver ─────────────────────────────────────
CREATE FUNCTION public.driver_variance_leaders(
  p_limit INT  DEFAULT 500,
  p_from  DATE DEFAULT NULL,
  p_to    DATE DEFAULT NULL
)
RETURNS TABLE (
  driver_name        TEXT,
  fills              BIGINT,
  km                 NUMERIC,
  litres             NUMERIC,
  litres_per_100km   NUMERIC,
  variance_da        NUMERIC,
  variance_per_100km NUMERIC,
  truck_count        BIGINT,
  trucks             TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    f.driver_name,
    count(*)                                                             AS fills,
    sum(f.distance_km)                                                   AS km,
    sum(f.litres_filled)                                                 AS litres,
    round(sum(f.litres_filled) * 100 / NULLIF(sum(f.distance_km), 0), 2) AS litres_per_100km,
    round(sum(f.variance_da))                                            AS variance_da,
    round(sum(f.variance_da) * 100 / NULLIF(sum(f.distance_km), 0))      AS variance_per_100km,
    count(DISTINCT f.truck_id)                                           AS truck_count,
    string_agg(DISTINCT f.truck_id, ', ' ORDER BY f.truck_id)            AS trucks
  FROM public.fuel_transactions f
  WHERE f.variance_da IS NOT NULL
    AND f.driver_name IS NOT NULL
    AND (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
  GROUP BY f.driver_name
  ORDER BY sum(f.variance_da) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$function$;

-- ── 5. Speeding leaders ───────────────────────────────────────
--
-- This one was NOT all-time: it carried a hardcoded
-- date_trunc('month', now()), so it silently showed month-to-date while
-- the tables beside it showed everything. That is now the caller's
-- range like everything else — which also means picking August finally
-- gives August here instead of the current month.
--
-- Staff still excluded (038): 7 staff vehicles raised 65 of 171 alerts,
-- and the alert the owner acts on is a laden cement truck over the limit.
CREATE FUNCTION public.driver_speeding_leaders(
  p_limit INT  DEFAULT 100,
  p_from  DATE DEFAULT NULL,
  p_to    DATE DEFAULT NULL
)
RETURNS TABLE (
  driver_name TEXT,
  truck_count BIGINT,
  trucks      TEXT,
  times       BIGINT,
  last_at     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    COALESCE(d.driver_name, '(' || n.truck_id || ')')          AS driver_name,
    count(DISTINCT n.truck_id)                                 AS truck_count,
    string_agg(DISTINCT n.truck_id, ', ' ORDER BY n.truck_id)  AS trucks,
    count(*)                                                   AS times,
    max(n.created_at)                                          AS last_at
  FROM public.notifications n
  LEFT JOIN public.dispatches d    ON d.id = n.dispatch_id
  LEFT JOIN public.fleet_trucks ft ON ft.truck_id = n.truck_id
  WHERE n.kind = 'speeding'
    AND COALESCE(ft.category, 'truck') IS DISTINCT FROM 'staff'
    AND (p_from IS NULL OR (n.created_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (n.created_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
  GROUP BY COALESCE(d.driver_name, '(' || n.truck_id || ')')
  ORDER BY count(*) DESC, max(n.created_at) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$function$;

GRANT EXECUTE ON FUNCTION public.fuel_period_stats(DATE, DATE)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(DATE, DATE)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.truck_variance_leaders(INT, DATE, DATE)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_variance_leaders(INT, DATE, DATE)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_speeding_leaders(INT, DATE, DATE)         TO authenticated;

-- NO INDEX ON THE OPS-DAY EXPRESSION, and it is worth writing down why
-- so the next person does not try. `timestamptz AT TIME ZONE 'zone'` is
-- STABLE, not IMMUTABLE — the timezone database can change underneath a
-- stored value — so Postgres refuses it in an index expression. A plain
-- index on occurred_at does not help either, since the filter is on the
-- derived date rather than the column.
--
-- It does not matter at this size: fuel_transactions is ~1,100 rows and
-- notifications a few thousand, so these are millisecond sequential
-- scans. If the sheet ever grows past a few hundred thousand fills, the
-- fix is a stored ops_day DATE column maintained on write — not an
-- expression index, which cannot be made to work.
