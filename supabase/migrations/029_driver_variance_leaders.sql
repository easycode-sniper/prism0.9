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
-- carry a variance today and that grows every day, while this returns
-- six rows forever.

CREATE OR REPLACE FUNCTION public.driver_variance_leaders(p_limit INT DEFAULT 6)
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
  -- Overspend only. A driver who came in under the assumed rate belongs
  -- on a different list, not at the bottom of this one.
  HAVING sum(f.variance_da) > 0
  ORDER BY sum(f.variance_da) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.driver_variance_leaders(INT) TO authenticated;
