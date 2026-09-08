-- ━─ Deliveries per operations day ━────────────────────────────
--
-- The dashboard measured only what the fleet SPENDS. Distance, litres,
-- consumption, dinars at the pump, variance by truck, variance by
-- driver, alerts — every panel on the page is a cost or a live status,
-- and nothing on it says what the fleet actually DELIVERED. That makes
-- every figure on the page a numerator with no denominator: 40,000 DA of
-- variance reads differently over a 60-delivery week than over a
-- 200-delivery one, and the page gave no way to tell which it was.
--
-- The data has been there since 2026-09-01. public.zone_visits logs a
-- row per client-site stay (migration 042, written by runSiteZoneCheck),
-- and Rapport Livraisons (053/054) already turns it into the fleet's
-- deliveries. This adds the same count, per day, to the series the
-- dashboard already fetches.
--
-- EXTENDS dashboard_daily_series RATHER THAN ADDING AN RPC, for the
-- reason 037 gave: one round trip, and the day spine and the
-- Africa/Algiers bucketing are already written here. A separate function
-- would have to repeat both and could drift from them.
--
-- THE SAME 25-MINUTE RULE, and the same parameter shape as
-- fleet_site_visits: p_min_seconds DEFAULT 1500. Site visits are logged
-- with strict containment and no edge buffer, so a public road clipping
-- a site polygon logs a truck that merely drove past — 67 of 264 rows
-- today are under the threshold, several of them 61 and 119 seconds. The
-- app passes UNLOADED_MIN_SECONDS explicitly rather than leaning on this
-- default, so the number is greppable from the code and cannot drift
-- from the sentence the panel prints under its heading.
--
-- AN OPEN VISIT IS JUDGED ON TIME ELAPSED SO FAR, exactly as 054 has it:
-- COALESCE(exited_at, NOW()). A truck three hours on site and still
-- there is the clearest delivery of the day.
--
-- BUCKETED BY entered_at, ONE DAY PER VISIT — deliberately NOT the
-- overlap rule Rapport Livraisons uses. Livraisons reports a stay
-- straddling midnight in both days with its true full duration, which is
-- right for a list of visits and wrong for a per-day count: the days of
-- a series have to SUM to the range's total, and an overlap rule counts
-- an overnight stay twice. A delivery belongs to the day the truck
-- arrived. The cost is that this series and Livraisons can differ by a
-- visit or two at a range edge; the alternative is a chart whose columns
-- do not add up to their own total.
--
-- NULL BEFORE SITE LOGGING EXISTED, not zero — the 048 rule. zone_visits
-- has no 'site' row before 2026-09-01 because runSiteZoneCheck did not
-- exist, and it cannot be backfilled (fleet_snapshots is pruned after
-- seven days). COALESCE(..., 0) over those days would assert the fleet
-- delivered nothing in August, which is false. The first day carrying a
-- site row is read from the WHOLE table, never the reported range, so
-- the boundary does not move with the range control.
--
-- Staff cars need no filter: runSiteZoneCheck takes cargoTrucks, so they
-- have never had a 'site' row. The plant is excluded for free — it is
-- zone_kind 'factory', not 'site'.

-- CREATE OR REPLACE cannot widen a RETURNS TABLE, and the GRANT does not
-- survive the drop. Both learned on 037.
DROP FUNCTION IF EXISTS public.dashboard_daily_series(DATE, DATE);

CREATE FUNCTION public.dashboard_daily_series(
  p_from        DATE DEFAULT NULL,
  p_to          DATE DEFAULT NULL,
  p_min_seconds INTEGER DEFAULT 1500
)
RETURNS TABLE (
  day         DATE,
  km          NUMERIC,
  litres      NUMERIC,
  consumption NUMERIC,
  alerts      BIGINT,
  amount_da   NUMERIC,
  da_per_km   NUMERIC,
  deliveries  BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH bounds AS (
    SELECT
      COALESCE(p_from, (now() AT TIME ZONE 'Africa/Algiers')::date - 29) AS first_day,
      LEAST(
        COALESCE(p_to, (now() AT TIME ZONE 'Africa/Algiers')::date),
        COALESCE(p_from, (now() AT TIME ZONE 'Africa/Algiers')::date - 29) + 1095
      ) AS last_day
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
  -- The day site logging began, over the whole table. Null until the
  -- first site row exists, which makes every day null below — correct:
  -- with no logging at all there is nothing to report on any day.
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
    -- Litres and amount KEEP their zero: these come from the fuel sheet,
    -- and a day the sheet covers with no fill on it really did see zero
    -- litres bought. Absence of a fill is evidence; absence of a
    -- telemetry row is not.
    COALESCE(fuel.litres, 0)                                                   AS litres,
    round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2)             AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts,
    COALESCE(fuel.amount_da, 0)                                                AS amount_da,
    round(fuel.paired_amount_da / NULLIF(fuel.paired_km, 0), 2)                AS da_per_km,
    -- Zero is evidence once the logging exists — a day the fleet made no
    -- qualifying stop really was a day with no delivery — but before it
    -- there is nothing to say, so the day is a gap.
    CASE WHEN site_start.first_day IS NOT NULL AND days.day >= site_start.first_day
         THEN COALESCE(delivery.deliveries, 0)
    END                                                                        AS deliveries
  FROM days
  CROSS JOIN site_start
  LEFT JOIN public.fleet_day_metrics m ON m.ops_day = days.day
  LEFT JOIN fuel     ON fuel.day     = days.day
  LEFT JOIN alert    ON alert.day    = days.day
  LEFT JOIN delivery ON delivery.day = days.day
  ORDER BY days.day;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(DATE, DATE, INTEGER) TO authenticated;

-- The signature changed, so this one is load-bearing rather than
-- precautionary: without it PostgREST keeps advertising the 2-argument
-- function and the dashboard serves PGRST202 against a database that is
-- entirely correct.
NOTIFY pgrst, 'reload schema';
