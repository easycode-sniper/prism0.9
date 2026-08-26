-- Speeding, fleet-wide.
--
-- Until now a truck was only checked against the limit while it was on a
-- dispatched run, because runPositionCheck walks active dispatches and
-- nothing else looked at speed. That makes the alert a delivery-quality
-- signal when it was always meant to be a safety one: a driver doing
-- 110km/h back from the parc with no run open was invisible.
--
-- The tick already fetches every unit's speed every minute for the
-- snapshot, so the data was there the whole time — only the check was
-- scoped too narrowly. This migration adds the per-truck transition flag
-- that a fleet-wide check needs, on exactly the footing the parc and
-- factory arrivals already use (fleet_trucks.at_hq / .at_factory).

-- 1. The flag. Same shape as at_hq/at_factory: NOT NULL DEFAULT false, so
--    a truck seen for the first time is "not speeding" and its first
--    crossing is a real transition rather than an unknown.
ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS is_speeding boolean NOT NULL DEFAULT false;

-- 2. Compare-and-set, returning only the trucks that actually changed.
--
-- Modelled on mark_trucks_hq_state, including the DISTINCT, which is
-- load-bearing for the same reason: Wialon can hold two units under one
-- name, the caller then passes that id twice, and Postgres rejects the
-- WHOLE statement with 21000 ("ON CONFLICT DO UPDATE command cannot
-- affect row a second time"). That failure is total, not partial — one
-- duplicated id would stop speeding detection for the entire fleet, and
-- the equivalent bug on at_hq ran unnoticed for 28 hours.
--
-- SECURITY DEFINER because fleet_trucks carries only an admin FOR ALL
-- write policy; the tick runs as service_role, but an operator's session
-- must not be able to write this table directly.
CREATE OR REPLACE FUNCTION public.mark_trucks_speeding_state(
  p_truck_ids  text[],
  p_is_speeding boolean
)
RETURNS TABLE (truck_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.fleet_trucks (truck_id, is_speeding)
  SELECT DISTINCT u, p_is_speeding FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET is_speeding = EXCLUDED.is_speeding, updated_at = NOW()
    WHERE public.fleet_trucks.is_speeding IS DISTINCT FROM EXCLUDED.is_speeding
  RETURNING public.fleet_trucks.truck_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_trucks_speeding_state(text[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_trucks_speeding_state(text[], boolean) TO service_role;

-- 3. The driver's name, stamped on the notification.
--
-- A fleet-wide alert has no dispatch, so notifications.dispatch_id is
-- NULL and the driver can no longer be reached by joining dispatches —
-- which is where driver_speeding_leaders was getting the name. Wialon
-- reports a driver per unit, so it is stamped here at the moment the
-- alert fires, exactly as hq_entries does, and for the same reason:
-- drivers change, and a log that rewrites its own history is worse than
-- no log. Nullable, because older rows do not have it and Wialon does
-- not always name a driver.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS driver_name text;

-- 4. Count from the stamped name first, then the dispatch, then the
--    truck. The dispatch fallback keeps every speeding alert raised
--    before this migration counting under the right driver.
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
    COALESCE(n.driver_name, d.driver_name, '(' || n.truck_id || ')')  AS driver_name,
    count(DISTINCT n.truck_id)                                        AS truck_count,
    string_agg(DISTINCT n.truck_id, ', ' ORDER BY n.truck_id)         AS trucks,
    count(*)                                                          AS times,
    max(n.created_at)                                                 AS last_at
  FROM public.notifications n
  LEFT JOIN public.dispatches d ON d.id = n.dispatch_id
  WHERE n.kind = 'speeding'
    AND (n.created_at AT TIME ZONE 'Africa/Algiers')
        >= date_trunc('month', (now() AT TIME ZONE 'Africa/Algiers'))
  GROUP BY COALESCE(n.driver_name, d.driver_name, '(' || n.truck_id || ')')
  ORDER BY count(*) DESC, max(n.created_at) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

GRANT EXECUTE ON FUNCTION public.driver_speeding_leaders(integer) TO authenticated;
