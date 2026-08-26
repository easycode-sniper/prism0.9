-- Aggregate the dashboard's figures in Postgres, not in the browser.
--
-- Both of these existed as "select the rows, add them up in JS", which
-- has a hard ceiling nobody sees coming: PostgREST caps a response at
-- 1000 rows and does NOT error when it truncates. The month totals were
-- summing the first 1000 fills of 1147 and calling it the month, and the
-- 30-day series was already past the cap at 1152 rows on the day it
-- shipped. Paging around it only moves the ceiling — at ~46 fills a day
-- a year is 17,000 rows, and dragging those over the wire to add them up
-- is the wrong shape regardless of whether it fits.
--
-- Summed here, the answer is one row and stays one row however many
-- years the sheet holds.
--
-- SECURITY INVOKER (the default): these read tables whose RLS already
-- grants authenticated users select, and a definer function would
-- quietly widen that.

-- ── The whole sheet, summed ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.fuel_period_stats()
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
AS $$
  -- A fill with no variance is one the sheet could not price against a
  -- distance, which means no kilometres were logged for it: a staff
  -- vehicle, or a truck's first ever fill. Those count towards what was
  -- bought and never towards what the fleet burns.
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
    -- Ordered by sheet position, which is chronological because the
    -- sheet is append-only, and unaffected by how the date column is
    -- written.
    (SELECT occurred_raw FROM public.fuel_transactions
      WHERE sheet_row IS NOT NULL ORDER BY sheet_row ASC  LIMIT 1)   AS first_raw,
    (SELECT occurred_raw FROM public.fuel_transactions
      WHERE sheet_row IS NOT NULL ORDER BY sheet_row DESC LIMIT 1)   AS last_raw
  FROM public.fuel_transactions;
$$;

-- ── One row per day, dense ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dashboard_daily_series(p_days INT DEFAULT 30)
RETURNS TABLE (
  day         DATE,
  km          NUMERIC,
  litres      NUMERIC,
  consumption NUMERIC,
  alerts      BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    -- The operations day is Africa/Algiers, which does not observe DST,
    -- so a fill logged at 00:12 local belongs to the day the office
    -- worked it rather than to the previous UTC one.
    SELECT (now() AT TIME ZONE 'Africa/Algiers')::date                        AS last_day,
           (now() AT TIME ZONE 'Africa/Algiers')::date
             - (LEAST(GREATEST(p_days, 1), 90) - 1)                          AS first_day
  ),
  days AS (
    SELECT generate_series(first_day, last_day, INTERVAL '1 day')::date AS day FROM bounds
  ),
  fuel AS (
    SELECT (occurred_at AT TIME ZONE 'Africa/Algiers')::date AS day,
           sum(litres_filled)                                        AS litres,
           sum(litres_filled) FILTER (WHERE variance_da IS NOT NULL) AS paired_litres,
           sum(distance_km)   FILTER (WHERE variance_da IS NOT NULL) AS paired_km
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
    COALESCE(round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2), 0) AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts
  FROM days
  LEFT JOIN public.fleet_day_metrics m ON m.ops_day = days.day
  LEFT JOIN fuel  ON fuel.day  = days.day
  LEFT JOIN alert ON alert.day = days.day
  ORDER BY days.day;
$$;

GRANT EXECUTE ON FUNCTION public.fuel_period_stats()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(INT)     TO authenticated;
