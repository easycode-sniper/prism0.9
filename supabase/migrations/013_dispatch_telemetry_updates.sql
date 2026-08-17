-- ━─ Let any signed-in session record dispatch telemetry ━──
-- The previous UPDATE policy allowed only the dispatcher who created a
-- run, or an admin. But runPositionCheck writes with the *caller's*
-- session, and FleetProvider polls in every operator's browser — so an
-- operator's poll updating a dispatch someone else created matched zero
-- rows and silently wrote nothing.
--
-- The columns that poll writes are the run's live state: last position,
-- deviation, ETA, and the is_off_route / is_speeding transition flags.
-- Those flags are exactly what suppresses repeat notifications, so a
-- rejected write meant the same violation could re-notify on the next
-- poll — the same failure mode that produced the HQ-arrival storm
-- (see 012), on a different table.
--
-- Dispatch state is shared operational data, not per-user data: every
-- signed-in operator already sees every run (the SELECT policy is
-- USING (true)) and monitors the whole fleet. So the write rule now
-- matches the read rule.
--
-- NOTE: this also means any operator can stop any run, not just their
-- own. For a shared ops desk where colleagues cover for each other
-- that's usually wanted; if it isn't, the narrower fix is to keep this
-- policy for telemetry and route stopDispatch through its own check.

DROP POLICY IF EXISTS "Users can update own dispatches, admins can update all"
  ON public.dispatches;

DROP POLICY IF EXISTS "Authenticated users can update dispatches"
  ON public.dispatches;

CREATE POLICY "Authenticated users can update dispatches"
  ON public.dispatches FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
