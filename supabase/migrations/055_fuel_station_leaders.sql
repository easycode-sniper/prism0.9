-- Which stations the fleet actually fills at, for the dashboard donut.
--
-- The sheet has carried a station name on every fill since 021 — 1,922
-- of them, not one blank — and nothing has ever read it. This is the
-- first thing that does.
--
-- AGGREGATED IN POSTGRES, not selected and reduced in the page, for the
-- reason 028 exists: PostgREST caps a response at 1000 rows and does NOT
-- error when it truncates, so a client-side count over 1,922 fills would
-- have been quietly counting the first thousand. One row per station is
-- one row at any size.
--
-- A TOP N AND A REMAINDER, because the tail is the shape of this data:
-- 318 distinct stations, and the top six cover only 34% of fills. A
-- donut of 318 slices is not a chart, and a donut of six that omits the
-- other 65% is a lie. The caller gets both halves and can draw the
-- remainder as one arc.
--
-- NAMES ARE TAKEN AS WRITTEN. Trimming and upper-casing them collapses
-- nothing at all — 318 distinct either way — so there is no cleaning to
-- do here, and inventing some would merge two stations that really are
-- different. If the sheet ever starts carrying variants, that is a
-- normalisation to do deliberately and visibly, not a LOWER() hidden in
-- a chart query.

CREATE OR REPLACE FUNCTION public.fuel_station_leaders(
  p_from  DATE DEFAULT NULL,
  p_to    DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 6
)
RETURNS TABLE (
  station        TEXT,
  fills          BIGINT,
  amount_da      NUMERIC,
  litres         NUMERIC,
  rank           BIGINT,
  -- The same on every row: the whole window, so the caller can size the
  -- remainder without a second query and without summing a list that
  -- might have been capped.
  total_fills    BIGINT,
  total_amount   NUMERIC,
  total_stations BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  WITH inwindow AS (
    SELECT f.station, f.amount_da, f.litres_filled
    FROM public.fuel_transactions f
    -- The dashboard's ops-day range, same convention as 028: a fill is
    -- bucketed by its Algiers calendar day, so a fill logged at 00:12
    -- local belongs to the day the office worked it.
    WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
      AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
      AND f.station IS NOT NULL
      AND btrim(f.station) <> ''
  ),
  per_station AS (
    SELECT i.station,
           COUNT(*)::BIGINT              AS fills,
           COALESCE(SUM(i.amount_da), 0) AS amount_da,
           COALESCE(SUM(i.litres_filled), 0) AS litres
    FROM inwindow i
    GROUP BY i.station
  ),
  totals AS (
    SELECT COALESCE(SUM(fills), 0)::BIGINT AS total_fills,
           COALESCE(SUM(amount_da), 0)     AS total_amount,
           COUNT(*)::BIGINT                AS total_stations
    FROM per_station
  )
  SELECT p.station, p.fills, p.amount_da, p.litres,
         -- Ties broken by name so the order is stable between two calls
         -- with the same data: GD BECHLOUL NORD and GD SIDI EL KEBIR SUD
         -- both sat on 34 fills, and a donut whose slices swap places on
         -- a refresh looks broken.
         ROW_NUMBER() OVER (ORDER BY p.fills DESC, p.station)::BIGINT AS rank,
         t.total_fills, t.total_amount, t.total_stations
  FROM per_station p, totals t
  ORDER BY p.fills DESC, p.station
  LIMIT GREATEST(p_limit, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.fuel_station_leaders(DATE, DATE, INTEGER) TO authenticated;
