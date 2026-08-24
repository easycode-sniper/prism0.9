-- Two new alerts: reaching the factory, and nearing a client.
--
-- FACTORY. Arrival at the factory was already implemented, but only
-- inside runPositionCheck — which runs per active dispatch. With no
-- dispatches open it never ran: one factory_arrival notification exists
-- in the whole history, against 85 for the parc. Loading at the factory
-- happens on every run whether or not anyone opened a dispatch for it,
-- so it belongs on the same fleet-wide footing as the parc: a per-truck
-- transition flag, checked for every cargo truck every tick.
--
-- at_factory is a separate column rather than a shared "current zone",
-- because the two zones are not mutually exclusive in the data — a bad
-- fix can put a truck inside both — and collapsing them would make one
-- zone's noise silently clear the other's state.

ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS at_factory BOOLEAN NOT NULL DEFAULT false;

-- Deliberately a near-copy of mark_trucks_hq_state rather than one
-- function generalised over a column name. Generalising means either
-- dynamic SQL or a CASE over every column in both the SET and the WHERE,
-- and this function is the one that a 28-hour outage ran through. A
-- second, independently readable twenty lines is worth more here than
-- removing the duplication.
--
-- DISTINCT for the same reason 022 added it: Wialon can hold two units
-- under one name, and a repeated id makes Postgres reject the entire
-- statement (21000), which would stop factory tracking for every truck.
CREATE OR REPLACE FUNCTION public.mark_trucks_factory_state(p_truck_ids TEXT[], p_at_factory BOOLEAN)
RETURNS TABLE (truck_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.fleet_trucks (truck_id, at_factory)
  SELECT DISTINCT u, p_at_factory FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET at_factory = EXCLUDED.at_factory, updated_at = NOW()
    WHERE public.fleet_trucks.at_factory IS DISTINCT FROM EXCLUDED.at_factory
  RETURNING public.fleet_trucks.truck_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_trucks_factory_state(TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_trucks_factory_state(TEXT[], BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_trucks_factory_state(TEXT[], BOOLEAN) TO authenticated;

-- CLIENT APPROACH. Fired once when the road-route ETA to the dispatch's
-- destination first falls to five minutes or less, so the site can be
-- ready before the truck is at the gate.
--
-- This one stays dispatch-scoped, unlike the factory: predicting arrival
-- at "the client" requires knowing which client, and only a dispatch
-- carries that. A flag on the dispatch, matching site_arrival_notified
-- beside it, is therefore the natural home — it also means the alert
-- resets naturally for the next run rather than needing to be cleared.
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS site_approach_notified BOOLEAN NOT NULL DEFAULT false;
