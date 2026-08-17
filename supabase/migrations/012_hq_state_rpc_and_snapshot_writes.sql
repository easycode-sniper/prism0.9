-- ━─ Let non-admins record HQ state and fleet snapshots ━───
-- Both writes FleetProvider makes on every poll were rejected by RLS
-- for anyone who isn't an admin:
--
--   * fleet_trucks.at_hq — only "Admins can manage fleet trucks"
--     (FOR ALL) existed, so the upsert in checkHqArrivals silently did
--     nothing. at_hq stayed false forever, so every 60s poll re-detected
--     the same arrival and inserted another notification. Production had
--     7,436 duplicate hq_arrival rows across 41 trucks in ~3 hours before
--     this fix, against 11 dispatches ever created.
--
--   * fleet_snapshots — same admin-only FOR ALL policy.
--
-- Rather than opening fleet_trucks up for writes wholesale, the at_hq
-- flag gets a SECURITY DEFINER RPC that can touch nothing else — the
-- same approach 008 already uses for geofences.

-- ── HQ state transition, atomically ──
-- Returns only the trucks whose flag actually changed, so the caller
-- notifies on real transitions and nothing else. That also makes the
-- check race-free: FleetProvider runs in every open tab, and two tabs
-- polling at once would otherwise both read at_hq = false and both
-- insert an arrival notification. Here the second one's ON CONFLICT
-- finds the flag already set, updates nothing, and returns no row.
CREATE OR REPLACE FUNCTION public.mark_trucks_hq_state(
  p_truck_ids TEXT[],
  p_at_hq     BOOLEAN
)
RETURNS TABLE (truck_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.fleet_trucks (truck_id, at_hq)
  SELECT u, p_at_hq FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET at_hq = EXCLUDED.at_hq, updated_at = NOW()
    WHERE public.fleet_trucks.at_hq IS DISTINCT FROM EXCLUDED.at_hq
  RETURNING public.fleet_trucks.truck_id;
$$;

-- anon needs revoking by name, not just via PUBLIC: Supabase grants
-- EXECUTE to anon and authenticated directly through default privileges,
-- so REVOKE ... FROM PUBLIC alone leaves the function callable without
-- signing in (the database linter flags this as
-- anon_security_definer_function_executable).
REVOKE ALL ON FUNCTION public.mark_trucks_hq_state(TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_trucks_hq_state(TEXT[], BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_trucks_hq_state(TEXT[], BOOLEAN) TO authenticated;

-- ── Fleet snapshots are append-only telemetry ──
-- Any signed-in session may add one; the admin FOR ALL policy from 005
-- still governs update/delete.
DROP POLICY IF EXISTS "Authenticated users can insert fleet snapshots" ON public.fleet_snapshots;

CREATE POLICY "Authenticated users can insert fleet snapshots"
  ON public.fleet_snapshots FOR INSERT TO authenticated WITH CHECK (true);
