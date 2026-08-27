-- Two money series per day, for the dashboard's cost panel:
--
--   amount_da   what was paid at the pump that day, every fill
--   da_per_km   the montant kilométrique — dinars per kilometre
--
-- Added to dashboard_daily_series rather than given their own RPC. The
-- page draws one panel per series but reads them in ONE round trip, and
-- these share the day spine, the Africa/Algiers bucketing and the same
-- fuel scan the litres series already does. A second function would
-- duplicate all three and give the two charts two chances to disagree
-- about what a day is.
--
-- CREATE OR REPLACE cannot widen a RETURNS TABLE, so this drops first.
-- Safe: the function is STABLE and read-only, nothing holds a reference
-- to it across the swap, and getDashboardSeries names its columns rather
-- than taking them positionally.

DROP FUNCTION IF EXISTS public.dashboard_daily_series(INT);

CREATE FUNCTION public.dashboard_daily_series(p_days INT DEFAULT 30)
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
           sum(distance_km)   FILTER (WHERE variance_da IS NOT NULL) AS paired_km,
           -- Every fill, matching the "Amount filled" headline tile.
           sum(amount_da)                                            AS amount_da,
           -- Only fills the sheet could price against a distance. A
           -- fill with no distance has money but no kilometres, so
           -- putting it in the numerator of a per-km rate would inflate
           -- the rate by money that bought no measured distance. Same
           -- subset the consumption series uses, and for the same
           -- reason — the two rates are then directly comparable.
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
    -- NOT coalesced to zero, unlike the two above. Zero litres bought on
    -- a day is a fact; zero litres per 100km is not — it is a day with no
    -- fill to measure against, which is unknown, and a chart that plots
    -- unknown as zero draws a cliff to the origin every midnight before
    -- the first fill lands. Null leaves a gap in the line instead.
    round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2) AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts,
    -- Zero is honest here: nothing was bought that day.
    COALESCE(fuel.amount_da, 0)                                                AS amount_da,
    -- Null on the same rule as consumption: a day with no priced fill
    -- has no rate, and drawing that as 0 DA/km reads as a free day.
    round(fuel.paired_amount_da / NULLIF(fuel.paired_km, 0), 2)                AS da_per_km
  FROM days
  LEFT JOIN public.fleet_day_metrics m ON m.ops_day = days.day
  LEFT JOIN fuel  ON fuel.day  = days.day
  LEFT JOIN alert ON alert.day = days.day
  ORDER BY days.day;
$$;

-- The grant does not survive the DROP.
GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(INT) TO authenticated;
