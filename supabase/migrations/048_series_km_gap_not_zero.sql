-- ━─ A day with no telemetry is a GAP, not a zero ━──────────────
--
-- Selecting August on the new range control drew "Distance per day" as a
-- flat zero from the 1st to the 16th, then a normal 20-30,000 km/day
-- from the 17th on. The owner read it as the mixed date-format bug from
-- the fuel sheet — 08/15/2026 parsed as 15 August — and that was a fair
-- guess, but it is not what this is.
--
-- Distance per day does NOT come from the fuel sheet. It comes from
-- public.fleet_day_metrics, which pg_cron writes from the fleet
-- snapshots. That table holds 17 rows and its earliest is 2026-08-17:
-- the job simply did not exist before then. There is nothing wrong with
-- any date.
--
-- AND IT CANNOT BE BACKFILLED. fleet_day_metrics is derived from
-- fleet_snapshots, which is pruned after seven days — the oldest
-- snapshot today is 2026-08-26. The raw fixes for the first half of
-- August are gone, so telemetry distance for those days does not exist
-- and cannot be reconstructed.
--
-- What WAS wrong is this function claiming otherwise. COALESCE(m.km, 0)
-- turned "no row for this day" into "0 km driven", which is a different
-- and much stronger statement — and a false one, since the fuel sheet
-- shows 18,000-26,000 km of distance on those very days from its own
-- odometer readings. The chart was not missing data; it was asserting
-- data it did not have.
--
-- dashboard.ts has said the rule the whole time, on DayPoint:
--
--   "Null where the day has no value to report, which is not the same
--    as zero. Consumption on a day with no fill yet is unknown; litres
--    bought on that day really is zero. Charts draw a gap for null."
--
-- consumption and da_per_km already followed it. km did not. Now it
-- does, so a day with no telemetry draws as a break in the line rather
-- than a dive to the floor.
--
-- The distinction survives: fleet_day_metrics with km = 0 is a real,
-- recorded zero and still plots as zero. Only a MISSING row is null.
--
-- Deliberately NOT falling back to the sheet's distance_km for those
-- days. It measures a different thing — kilometres between two fills of
-- one truck, from its odometer — and this panel is fleet telemetry
-- including staff cars. Splicing the two would make the line continuous
-- and quietly wrong, which is the failure this migration exists to end.

CREATE OR REPLACE FUNCTION public.dashboard_daily_series(
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
  )
  SELECT
    days.day,
    -- NOT COALESCEd. See the header: a missing fleet_day_metrics row
    -- means the telemetry was never recorded, which is not zero.
    m.km                                                                       AS km,
    -- Litres and amount KEEP their zero: these come from the fuel sheet,
    -- and a day the sheet covers with no fill on it really did see zero
    -- litres bought. Absence of a fill is evidence; absence of a
    -- telemetry row is not.
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

GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(DATE, DATE) TO authenticated;

-- The signature is unchanged so PostgREST's cache is not stale here, but
-- issued anyway: 047 was applied without it and the dashboard spent an
-- evening serving PGRST202 while every function in the database was
-- correct. Cheap, idempotent, and it removes a way to be wrong.
NOTIFY pgrst, 'reload schema';
