-- De-duplicate truck ids inside mark_trucks_hq_state.
--
-- Wialon can hold two units under the SAME name: a replacement tracker
-- fitted without retiring the old record. On 2026-08-19 that happened to
-- 00038-522-35 and 00039-522-35 — each appeared twice in the fleet feed,
-- at different coordinates, one of the pair tagged PANNE.
--
-- Both duplicates were parked inside the HQ radius, so the caller passed
-- each id twice and Postgres rejected the statement outright:
--
--   21000: ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- The blast radius is what makes this worth a migration of its own. One
-- duplicated id kills the single INSERT that covers the WHOLE fleet;
-- runHqArrivalCheck then correctly declines to notify on a write it
-- could not persist; so no truck's arrival is recorded, no at_hq flag
-- moves, and — because a truck that never "leaves" can never be seen to
-- arrive — the state machine stays frozen even after the duplicate goes
-- away. It ran that way for 28 hours, reporting ok with no warnings,
-- because the error was logged rather than raised.
--
-- The application de-duplicates too (and picks the freshest of the two
-- fixes, which only it can judge), but this belongs here as well: the
-- function should not be breakable by any caller handing it a repeated
-- id.
CREATE OR REPLACE FUNCTION public.mark_trucks_hq_state(p_truck_ids TEXT[], p_at_hq BOOLEAN)
RETURNS TABLE (truck_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.fleet_trucks (truck_id, at_hq)
  SELECT DISTINCT u, p_at_hq FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET at_hq = EXCLUDED.at_hq, updated_at = NOW()
    WHERE public.fleet_trucks.at_hq IS DISTINCT FROM EXCLUDED.at_hq
  RETURNING public.fleet_trucks.truck_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_trucks_hq_state(TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_trucks_hq_state(TEXT[], BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_trucks_hq_state(TEXT[], BOOLEAN) TO authenticated;
