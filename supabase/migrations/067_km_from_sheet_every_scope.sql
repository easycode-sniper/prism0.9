-- ── 067: km follows the sheet in every scope ──────────────────────────
--
-- Owner's call, 2026-09-17. dashboard_daily_series returned DIFFERENT
-- kilometres for the same day depending on scope: fleet-wide it read
-- fleet_day_metrics (real telemetry distance, staff cars included);
-- scoped it read the fuel sheet's distance between fills. The two
-- disagree by design — telemetry measures every metre driven, the sheet
-- measures fill-to-fill and credits it to the later fill's day — and on
-- 2026-09-17 that disagreement reached the owner as "the chart says
-- 23,419 km and the scorecard says 12,899 km; which one is right?"
--
-- Both were right about what they measured, but a page whose headline
-- figure and its own chart cannot reconcile is worse than either number
-- alone. The scorecard wins: km is now the sheet's paired distance in
-- EVERY scope, so the chart's columns always sum to "Kilometres driven"
-- over the same range. The fleet-only relabelling the page used to do
-- ("Distance per day" vs "Distance between fills") goes with it.
--
-- BASED ON THE LIVE DEFINITION, NOT MIGRATION 060. The function was
-- edited in place after 060 (the per-model by_model CTE and its three
-- l100 columns exist only in the database; no committed migration
-- carries them). This file dumps that live body and changes exactly
-- three things: the km CASE collapses to the sheet's paired_km, the
-- fleet_day_metrics term leaves data_start, and the fleet_day_metrics
-- join is dropped. Everything else is byte-identical to what ran
-- before.
--
-- fleet_day_metrics is still written by pg_cron every five minutes and
-- the daily prune still runs; nothing on this page reads it any more.

DROP FUNCTION IF EXISTS public.dashboard_daily_series(DATE, DATE, INTEGER, TEXT, TEXT);
CREATE FUNCTION public.dashboard_daily_series(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_min_seconds integer DEFAULT 1500, p_driver text DEFAULT NULL::text, p_truck text DEFAULT NULL::text)
 RETURNS TABLE(day date, km numeric, litres numeric, consumption numeric, alerts bigint, amount_da numeric, da_per_km numeric, deliveries bigint, man_l100 numeric, shackman_l100 numeric, renault_l100 numeric, days_clamped boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH scope AS (
    SELECT
      public.norm_driver_name(p_driver) AS driver_key,
      p_truck                            AS truck_id,
      (p_driver IS NOT NULL OR p_truck IS NOT NULL) AS scoped
  ),
  data_start AS (
    SELECT LEAST(
      (SELECT (min(occurred_at) AT TIME ZONE 'Africa/Algiers')::date FROM public.fuel_transactions),
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
        (now() AT TIME ZONE 'Africa/Algiers')::date - 29
      ) AS first_day
  ),
  bounds AS (
    SELECT
      asked.last_day,
      GREATEST(asked.first_day, asked.last_day - 729) AS first_day,
      (asked.first_day < asked.last_day - 729)        AS clamped
    FROM asked
  ),
  days AS (
    SELECT generate_series(first_day, last_day, INTERVAL '1 day')::date AS day FROM bounds
  ),
  fuel AS (
    SELECT (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date AS day,
           sum(f.litres_filled)                                          AS litres,
           sum(f.litres_filled) FILTER (WHERE f.variance_da IS NOT NULL) AS paired_litres,
           sum(f.distance_km)   FILTER (WHERE f.variance_da IS NOT NULL) AS paired_km,
           sum(f.amount_da)                                              AS amount_da,
           sum(f.amount_da)     FILTER (WHERE f.variance_da IS NOT NULL) AS paired_amount_da
    FROM public.fuel_transactions f, bounds, scope
    WHERE (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(f.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR f.truck_id = scope.truck_id)
    GROUP BY 1
  ),
  by_model AS (
    SELECT (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date AS day,
           round(sum(f.litres_filled) FILTER (WHERE public.truck_model(f.truck_id) = 'MAN') * 100
                 / NULLIF(sum(f.distance_km) FILTER (WHERE public.truck_model(f.truck_id) = 'MAN'), 0), 2)      AS man_l100,
           round(sum(f.litres_filled) FILTER (WHERE public.truck_model(f.truck_id) = 'Shackman') * 100
                 / NULLIF(sum(f.distance_km) FILTER (WHERE public.truck_model(f.truck_id) = 'Shackman'), 0), 2) AS shackman_l100,
           round(sum(f.litres_filled) FILTER (WHERE public.truck_model(f.truck_id) = 'Renault') * 100
                 / NULLIF(sum(f.distance_km) FILTER (WHERE public.truck_model(f.truck_id) = 'Renault'), 0), 2)  AS renault_l100
    FROM public.fuel_transactions f, bounds, scope
    WHERE (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND f.variance_da IS NOT NULL
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(f.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR f.truck_id = scope.truck_id)
    GROUP BY 1
  ),
  alert AS (
    SELECT (n.created_at AT TIME ZONE 'Africa/Algiers')::date AS day, count(*) AS alerts
    FROM public.notifications n
    LEFT JOIN public.dispatches d ON d.id = n.dispatch_id
    CROSS JOIN bounds
    CROSS JOIN scope
    WHERE (n.created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(d.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR n.truck_id = scope.truck_id)
    GROUP BY 1
  ),
  site_start AS (
    SELECT MIN((entered_at AT TIME ZONE 'Africa/Algiers')::date) AS first_day
    FROM public.zone_visits WHERE zone_kind = 'site'
  ),
  delivery AS (
    SELECT (z.entered_at AT TIME ZONE 'Africa/Algiers')::date AS day, count(*) AS deliveries
    FROM public.zone_visits z, bounds, scope
    WHERE z.zone_kind = 'site'
      AND (z.entered_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND EXTRACT(EPOCH FROM (COALESCE(z.exited_at, NOW()) - z.entered_at)) >= p_min_seconds
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(z.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR z.truck_id = scope.truck_id)
    GROUP BY 1
  )
  SELECT
    days.day,
    -- The sheet's distance between fills in EVERY scope (067). Null on a
    -- day with no qualifying fill — never recorded is not zero, the rule
    -- 048 established when this column came from telemetry.
    fuel.paired_km                                                             AS km,
    COALESCE(fuel.litres, 0)                                                   AS litres,
    round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2)             AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts,
    COALESCE(fuel.amount_da, 0)                                                AS amount_da,
    round(fuel.paired_amount_da / NULLIF(fuel.paired_km, 0), 2)                AS da_per_km,
    CASE WHEN site_start.first_day IS NOT NULL AND days.day >= site_start.first_day
         THEN COALESCE(delivery.deliveries, 0)
    END                                                                        AS deliveries,
    by_model.man_l100,
    by_model.shackman_l100,
    by_model.renault_l100,
    bounds.clamped                                                             AS days_clamped
  FROM days
  CROSS JOIN site_start
  CROSS JOIN bounds
  CROSS JOIN scope
  LEFT JOIN fuel     ON fuel.day     = days.day
  LEFT JOIN by_model ON by_model.day = days.day
  LEFT JOIN alert    ON alert.day    = days.day
  LEFT JOIN delivery ON delivery.day = days.day
  ORDER BY days.day;
$function$;
