-- Two views of the same écart, so neither can be read as a verdict on
-- its own.
--
-- The driver list answers "who cost us the most". It cannot answer "and
-- was it them or the truck they were handed", because most drivers in
-- this data drive exactly one truck — BOUKEMICHE only ever 00043-523-35,
-- MENZER only 00038-523-35 — so for them the driver's number and the
-- truck's number are the same number.
--
-- Two things follow. The driver rows now carry the truck they came from,
-- so the confound is visible on the row rather than something a reader
-- has to already know. And the same aggregate exists per truck, so a
-- vehicle that is thirsty under everyone who drives it shows up as a
-- vehicle rather than as a run of unlucky drivers.
--
-- The driver effect is real and large where it can be isolated: on
-- 000065-525-35 the same truck returns 29.54 L/100km under one driver
-- and 49.08 under another. That is why the driver list stays. It is also
-- why it needs its companion.
--
-- driver_variance_leaders is DROPped rather than replaced: Postgres will
-- not change the return type of an existing function in place.

DROP FUNCTION IF EXISTS public.driver_variance_leaders(INT);

CREATE FUNCTION public.driver_variance_leaders(p_limit INT DEFAULT 500)
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
AS $$
  SELECT
    f.driver_name,
    count(*)                                                             AS fills,
    sum(f.distance_km)                                                   AS km,
    sum(f.litres_filled)                                                 AS litres,
    round(sum(f.litres_filled) * 100 / NULLIF(sum(f.distance_km), 0), 2) AS litres_per_100km,
    round(sum(f.variance_da))                                            AS variance_da,
    round(sum(f.variance_da) * 100 / NULLIF(sum(f.distance_km), 0))      AS variance_per_100km,
    -- Which truck this driver's figure actually came from.
    count(DISTINCT f.truck_id)                                           AS truck_count,
    string_agg(DISTINCT f.truck_id, ', ' ORDER BY f.truck_id)            AS trucks
  FROM public.fuel_transactions f
  WHERE f.variance_da IS NOT NULL
    AND f.driver_name IS NOT NULL
  GROUP BY f.driver_name
  ORDER BY sum(f.variance_da) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

CREATE OR REPLACE FUNCTION public.truck_variance_leaders(p_limit INT DEFAULT 500)
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
AS $$
  SELECT
    f.truck_id,
    -- How many hands the figure covers. One driver means the truck's
    -- number and that driver's number are the same evidence counted
    -- twice; several means the truck is the constant.
    count(DISTINCT f.driver_name)                                        AS drivers,
    count(*)                                                             AS fills,
    sum(f.distance_km)                                                   AS km,
    round(sum(f.litres_filled) * 100 / NULLIF(sum(f.distance_km), 0), 2) AS litres_per_100km,
    round(sum(f.variance_da))                                            AS variance_da,
    round(sum(f.variance_da) * 100 / NULLIF(sum(f.distance_km), 0))      AS variance_per_100km
  FROM public.fuel_transactions f
  WHERE f.variance_da IS NOT NULL
    AND f.truck_id IS NOT NULL
  GROUP BY f.truck_id
  ORDER BY sum(f.variance_da) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

GRANT EXECUTE ON FUNCTION public.driver_variance_leaders(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.truck_variance_leaders(INT)  TO authenticated;
