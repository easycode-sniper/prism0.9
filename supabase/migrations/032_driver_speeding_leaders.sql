-- Who crossed the speed limit most often, this calendar month.
--
-- The count is of NOTIFICATIONS of kind 'speeding', and that is the
-- honest unit: runFleetTick raises one only on a false->true transition
-- of dispatches.is_speeding (positionCheck.ts writes `is_speeding:
-- nowSpeeding` every tick, so the flag falls again when the truck slows).
-- One row is therefore one crossing of 90km/h on a run, not one tick
-- spent above it and not one whole run — a driver who speeds, slows and
-- speeds again counts twice, which is what "exceeded 9 times" should
-- mean.
--
-- Two limits worth stating rather than discovering later:
--   * speeding is only detected while a truck is on a dispatched run,
--     because runPositionCheck walks active dispatches. Nothing is
--     counted for a truck driving without a run open.
--   * the limit itself lives in TypeScript (SPEED_LIMIT_KMH = 90 in
--     src/lib/fleet/positionCheck.ts), so this function must not restate
--     it; it counts the alerts that code already decided to raise.
--
-- Aggregated here rather than in JS on purpose: PostgREST caps a response
-- at 1000 rows and does not error when it truncates, and notifications
-- grow without bound. See migration 028.
--
-- SECURITY INVOKER (the default) is deliberate — both notifications and
-- dispatches already grant SELECT to authenticated with qual TRUE, so a
-- definer function would widen access for no reason.
CREATE OR REPLACE FUNCTION public.driver_speeding_leaders(p_limit integer DEFAULT 100)
RETURNS TABLE (
  driver_name text,
  truck_count bigint,
  trucks      text,
  times       bigint,
  last_at     timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    -- Same fallback driver_ratings() uses, so a truck with no named
    -- driver reads identically on both panels.
    COALESCE(d.driver_name, '(' || n.truck_id || ')')          AS driver_name,
    count(DISTINCT n.truck_id)                                 AS truck_count,
    string_agg(DISTINCT n.truck_id, ', ' ORDER BY n.truck_id)  AS trucks,
    count(*)                                                   AS times,
    max(n.created_at)                                          AS last_at
  FROM public.notifications n
  LEFT JOIN public.dispatches d ON d.id = n.dispatch_id
  WHERE n.kind = 'speeding'
    -- The operations month, in Africa/Algiers. created_at is timestamptz
    -- and ::date renders in UTC, so an alert at 00:40 local would
    -- otherwise fall into the previous day — and on the 1st, the
    -- previous MONTH. See the note on dashboard_daily_series.
    AND (n.created_at AT TIME ZONE 'Africa/Algiers')
        >= date_trunc('month', (now() AT TIME ZONE 'Africa/Algiers'))
  GROUP BY COALESCE(d.driver_name, '(' || n.truck_id || ')')
  ORDER BY count(*) DESC, max(n.created_at) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

GRANT EXECUTE ON FUNCTION public.driver_speeding_leaders(integer) TO authenticated;
