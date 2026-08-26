-- Who the écart is actually coming from.
--
-- The dashboard's headline variance is one number for the whole fleet;
-- this is the same number split by driver, which is the form somebody
-- can act on. Ranked by total dinars, because that is the money — but
-- the rate travels with it, because a total on its own rewards whoever
-- drove least and makes the highest-mileage driver look like the worst
-- offender for doing the most work. The fleet's worst RATE and its worst
-- TOTAL are two different people in the current data.
--
-- Aggregated in Postgres for the reason migration 028 exists: 1077 fills
-- carry a variance today and that number grows every day, while this
-- returns one row per driver — 92 of them — which grows with headcount
-- instead. That is small enough to hand over whole and sort in the
-- browser, so changing the sort costs no round trip.

CREATE OR REPLACE FUNCTION public.driver_variance_leaders(p_limit INT DEFAULT 500)
RETURNS TABLE (
  driver_name        TEXT,
  fills              BIGINT,
  km                 NUMERIC,
  litres             NUMERIC,
  litres_per_100km   NUMERIC,
  variance_da        NUMERIC,
  variance_per_100km NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- Only fills carrying a variance, the same rule the headline figures
  -- use: a fill without one had no distance logged against it, so it can
  -- be charged to nobody's driving.
  SELECT
    f.driver_name,
    count(*)                                                   AS fills,
    sum(f.distance_km)                                         AS km,
    sum(f.litres_filled)                                       AS litres,
    round(sum(f.litres_filled) * 100 / NULLIF(sum(f.distance_km), 0), 2) AS litres_per_100km,
    round(sum(f.variance_da))                                  AS variance_da,
    round(sum(f.variance_da) * 100 / NULLIF(sum(f.distance_km), 0))      AS variance_per_100km
  FROM public.fuel_transactions f
  WHERE f.variance_da IS NOT NULL
    AND f.driver_name IS NOT NULL
  GROUP BY f.driver_name
  -- Every driver, not just the ones over the rate. The table is sorted
  -- in the browser and can be read from either end, and the good end is
  -- the more useful half: 21 of the 92 drivers come in at or under the
  -- assumed rate, the best of them 13,351 DA to the good. Filtering them
  -- out would have left "best first" with nothing to show.
  ORDER BY sum(f.variance_da) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

GRANT EXECUTE ON FUNCTION public.driver_variance_leaders(INT) TO authenticated;
