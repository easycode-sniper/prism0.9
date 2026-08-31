-- ━─ The six fleet figures the Rapport Usine strip shows ━─────────
--
-- These were being derived in the browser, as a median OF the per-truck
-- medians factory_zone_summary returns. That is not the fleet median and
-- the difference is real: over 2026-08-31 it reads 0:55:01 against a
-- true 0:54:30, because a truck with one visit counts as much as one
-- with twenty. Small here, and wrong in a way that grows with how
-- unevenly the fleet is used.
--
-- It also broke this project's rule the moment the range got wide.
-- factory_zone_visits is capped at 5000 rows and PostgREST truncates at
-- 1000 without erroring, so any fleet figure computed from a fetched
-- list is computed from whatever survived the cap. Aggregate in
-- Postgres, over every row, and return the six numbers themselves.
--
-- One row out, so it cannot be truncated at all.
CREATE OR REPLACE FUNCTION public.factory_zone_totals(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  trucks           BIGINT,
  plant_visits     BIGINT,
  -- Time in the WAITING zone, which contains the bay — so this is the
  -- whole stay at the plant, loading included, not the wait. See 040.
  median_presence  BIGINT,
  max_presence     BIGINT,
  -- Arrival to the start of loading: the wait on its own.
  median_queue     BIGINT,
  median_load      BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  WITH v AS (
    SELECT z.truck_id, z.zone_kind,
           EXTRACT(EPOCH FROM (z.exited_at - z.entered_at)) AS secs,
           CASE WHEN z.zone_kind <> 'factory_loading' THEN NULL ELSE (
             SELECT EXTRACT(EPOCH FROM (z.entered_at - w.entered_at))
             FROM public.zone_visits w
             WHERE w.truck_id = z.truck_id
               AND w.zone_kind = 'factory'
               AND w.entered_at <= z.entered_at
               AND (w.exited_at IS NULL OR w.exited_at >= z.entered_at)
             ORDER BY w.entered_at DESC
             LIMIT 1
           ) END AS queue
    FROM public.zone_visits z
    WHERE z.entered_at >= p_from AND z.entered_at < p_to
  )
  SELECT COUNT(DISTINCT v.truck_id),
         COUNT(*) FILTER (WHERE v.zone_kind = 'factory'),
         -- PERCENTILE_CONT ignores NULLs, so open visits drop out on
         -- their own rather than counting as zero-length ones.
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.secs)
           FILTER (WHERE v.zone_kind = 'factory')::BIGINT,
         MAX(v.secs) FILTER (WHERE v.zone_kind = 'factory')::BIGINT,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.queue)::BIGINT,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.secs)
           FILTER (WHERE v.zone_kind = 'factory_loading')::BIGINT
  FROM v;
$function$;

GRANT EXECUTE ON FUNCTION public.factory_zone_totals(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
