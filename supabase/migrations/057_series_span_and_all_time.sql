-- ━─ "All time" means all time, and a long range keeps the NEWEST days ━─
--
-- TWO BUGS, ONE FUNCTION, both of them silent — which is the only reason
-- they lasted. Neither throws, neither logs, and both leave a chart that
-- looks completely normal.
--
-- ── 1. "All time" was drawing thirty days ─────────────────────
--
-- Selecting "All time" on the dashboard sends { from: null, to: null }.
-- The KPI tiles honour that: fuel_period_stats(NULL, NULL) sums the
-- whole sheet, and the five cards really do describe every fill since
-- 2026-08-01. This function did not. Its default for a missing p_from
-- was `today - 29`, so the charts underneath those cards quietly showed
-- the last thirty days, with nothing on screen saying so.
--
-- The default was right when it was written — it was the "no arguments,
-- give me the usual month" case, from before 047 added a range control
-- at all. It became wrong the moment a UI preset started sending NULL to
-- mean "everything".
--
-- Now a NULL p_from means THE FIRST DAY ANY OF THE SERIES' SOURCES HAS
-- DATA, read from the tables themselves rather than hardcoded, so it
-- stays true as the record grows. Today that is 2026-08-01, from the
-- fuel sheet; fleet_day_metrics only reaches 2026-08-17 and site visits
-- 2026-09-01, which is exactly why the km line and the deliveries bars
-- draw a gap over their own early days. That gap is the honest picture
-- and the panels already explain it.
--
-- The mins are taken on the RAW timestamp and converted after —
-- (min(occurred_at) AT TIME ZONE ...)::date, not min((occurred_at AT
-- TIME ZONE ...)::date). Identical answer, because the conversion is
-- monotonic, but the first can use an index on the column and the
-- second forces a scan of the whole table on every dashboard load.
--
-- ── 2. The span cap dropped the WRONG END ─────────────────────
--
-- 047 capped the span so a mistyped year could not generate 45,000 rows.
-- It did it as LEAST(p_to, p_from + 1095) — which holds the start still
-- and cuts the END off. Ask for 2020-01-01 to today and you got January
-- 2020 to December 2022: three years of ancient history and not one
-- recent day, on a dashboard whose entire job is what is happening now.
--
-- Nobody hit it, because the data does not reach back far enough to try.
-- It would have started mattering the moment "All time" actually meant
-- all time, which is the other half of this migration — so the two fixes
-- ship together or the first one arms the second.
--
-- The cap now moves the START forward instead, keeping the newest days,
-- and says so in a column rather than silently.
--
-- ── Why 730 and not 1095 ──────────────────────────────────────
--
-- Because there is a THIRD cap underneath this one that nothing in the
-- app controls: the API refuses to return more than 1000 rows in a
-- response, and does not error when it truncates — the same behaviour
-- that had the fuel KPIs summing the first 1000 of 1147 fills before
-- migration 028. One row per day means 1095 days was already over that
-- line. Any number under 1000 is safe; 730 is two years, which is more
-- daily history than this chart can usefully draw anyway.
--
-- THE REAL ANSWER, when the record gets that long, is to bucket by week
-- past some span rather than to cap at all — 730 daily bars in a 954px
-- panel is 1.3 pixels each. That is a bigger change than this one (the
-- axis, the tooltip and the period-over-period comparison all assume a
-- day), and it is not needed until roughly August 2028. Until then the
-- cap is honest and the flag says when it bit.

DROP FUNCTION IF EXISTS public.dashboard_daily_series(DATE, DATE, INTEGER);

CREATE FUNCTION public.dashboard_daily_series(
  p_from        DATE DEFAULT NULL,
  p_to          DATE DEFAULT NULL,
  p_min_seconds INTEGER DEFAULT 1500
)
RETURNS TABLE (
  day          DATE,
  km           NUMERIC,
  litres       NUMERIC,
  consumption  NUMERIC,
  alerts       BIGINT,
  amount_da    NUMERIC,
  da_per_km    NUMERIC,
  deliveries   BIGINT,
  -- The same value on every row, like fleet_site_totals.fleet_sites:
  -- true when the span cap moved the start forward, so the page can say
  -- the charts do not cover everything that was asked for. A caller that
  -- reads rows[0] gets it; a caller that ignores it is no worse off than
  -- before.
  days_clamped BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH data_start AS (
    -- The first day the dashboard has anything to say. LEAST ignores
    -- NULLs, so a table that is empty simply does not vote.
    SELECT LEAST(
      (SELECT (min(occurred_at) AT TIME ZONE 'Africa/Algiers')::date FROM public.fuel_transactions),
      (SELECT min(ops_day)                                          FROM public.fleet_day_metrics),
      (SELECT (min(created_at)  AT TIME ZONE 'Africa/Algiers')::date FROM public.notifications),
      (SELECT (min(entered_at)  AT TIME ZONE 'Africa/Algiers')::date FROM public.zone_visits)
    ) AS day
  ),
  asked AS (
    SELECT
      COALESCE(p_to, (now() AT TIME ZONE 'Africa/Algiers')::date) AS last_day,
      COALESCE(
        p_from,
        (SELECT day FROM data_start),
        -- Nothing recorded anywhere yet: fall back to the old month, so
        -- an empty database still renders a chart rather than nothing.
        (now() AT TIME ZONE 'Africa/Algiers')::date - 29
      ) AS first_day
  ),
  bounds AS (
    SELECT
      asked.last_day,
      -- Keep the NEWEST 730 days, not the oldest. This is the half that
      -- 047 had backwards.
      GREATEST(asked.first_day, asked.last_day - 729) AS first_day,
      (asked.first_day < asked.last_day - 729)        AS clamped
    FROM asked
  ),
  days AS (
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
  ),
  -- 056's rule, unchanged: null before site logging existed, zero after.
  site_start AS (
    SELECT MIN((entered_at AT TIME ZONE 'Africa/Algiers')::date) AS first_day
    FROM public.zone_visits WHERE zone_kind = 'site'
  ),
  delivery AS (
    SELECT (z.entered_at AT TIME ZONE 'Africa/Algiers')::date AS day, count(*) AS deliveries
    FROM public.zone_visits z, bounds
    WHERE z.zone_kind = 'site'
      AND (z.entered_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN first_day AND last_day
      AND EXTRACT(EPOCH FROM (COALESCE(z.exited_at, NOW()) - z.entered_at)) >= p_min_seconds
    GROUP BY 1
  )
  SELECT
    days.day,
    -- NOT COALESCEd. See 048: a missing fleet_day_metrics row means the
    -- telemetry was never recorded, which is not zero.
    m.km                                                                       AS km,
    COALESCE(fuel.litres, 0)                                                   AS litres,
    round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2)             AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts,
    COALESCE(fuel.amount_da, 0)                                                AS amount_da,
    round(fuel.paired_amount_da / NULLIF(fuel.paired_km, 0), 2)                AS da_per_km,
    CASE WHEN site_start.first_day IS NOT NULL AND days.day >= site_start.first_day
         THEN COALESCE(delivery.deliveries, 0)
    END                                                                        AS deliveries,
    bounds.clamped                                                             AS days_clamped
  FROM days
  CROSS JOIN site_start
  CROSS JOIN bounds
  LEFT JOIN public.fleet_day_metrics m ON m.ops_day = days.day
  LEFT JOIN fuel     ON fuel.day     = days.day
  LEFT JOIN alert    ON alert.day    = days.day
  LEFT JOIN delivery ON delivery.day = days.day
  ORDER BY days.day;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(DATE, DATE, INTEGER) TO authenticated;

-- The RETURNS TABLE gained a column, so PostgREST's cached schema is
-- stale until it is told. 047 was applied without this and the dashboard
-- served PGRST202 all evening against a database that was correct.
NOTIFY pgrst, 'reload schema';
