-- ━─ Driver directory: operators write too, and rows stand on their own ━─
--
-- Two changes, both the owner's decision on 2026-09-10, and they belong
-- in one migration because the first is useless without the second.
--
-- 1. WRITES OPEN TO OPERATORS. 024 restricted INSERT/UPDATE/DELETE to
--    admins, reasoning that an operator session is the one left open all
--    shift on a shared machine and these are 128 employees' phone numbers
--    and home addresses. The owner has weighed that and asked for adding
--    and editing to be available to everyone who can sign in. DELETE
--    stays admin-only: it was not asked for, and removing a staff record
--    is the one write here that destroys something rather than correcting
--    it.
--
-- 2. A DIRECTORY ROW IS NOW A DRIVER IN ITS OWN RIGHT. 018 said a row
--    matching no Wialon driver "is simply never rendered — it is
--    reference data, not a roster of its own", and listDrivers() enforced
--    that by mapping over the Wialon library and joining this table onto
--    it. That is exactly why there was no way to add a driver: the row
--    went in and nothing appeared. The page now unions the two sides, so
--    a row added here shows as a card flagged as not being in Wialon.
--
--    Wialon is still the roster for everything else in the app. A driver
--    added here does NOT get a name on a truck marker, in dispatch or in
--    any report — those resolve names from the Wialon driver library and
--    this app has no write path into it (the whole integration is
--    token/login plus core/search_items). Adding someone here is a
--    contact record, not a fleet assignment.
--
-- No table or column changes: this migration is entirely policy.

-- ── INSERT: any authenticated user ──────────────────────────────────
DROP POLICY IF EXISTS "driver_directory_insert_admin" ON public.driver_directory;
DROP POLICY IF EXISTS "driver_directory_insert" ON public.driver_directory;
CREATE POLICY "driver_directory_insert"
  ON public.driver_directory FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── UPDATE: any authenticated user ──────────────────────────────────
DROP POLICY IF EXISTS "driver_directory_update_admin" ON public.driver_directory;
DROP POLICY IF EXISTS "driver_directory_update" ON public.driver_directory;
CREATE POLICY "driver_directory_update"
  ON public.driver_directory FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── DELETE: unchanged, still admins only ────────────────────────────
-- Recreated rather than left alone so this file states the whole policy
-- set for the table; re-running it is a no-op.
DROP POLICY IF EXISTS "driver_directory_delete_admin" ON public.driver_directory;
CREATE POLICY "driver_directory_delete_admin"
  ON public.driver_directory FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 024's UPDATE policy had a USING clause and no WITH CHECK, which lets a
-- row be edited into a shape the policy would not have admitted. It did
-- not matter while both sides were "is an admin", and it would matter the
-- moment either grows a condition, so the new one carries both.
