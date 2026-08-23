-- ━─ Driver directory: admin writes ━─────────────────────────
-- 018 gave this table a SELECT policy and nothing else on purpose: it
-- holds staff phone numbers and home addresses, and the reasoning was
-- that corrections should go through the service role so a compromised
-- browser session could not rewrite personal records.
--
-- That has a cost the operator is now feeling: most drivers arrived with
-- no phone and no address, and the only way to fill them in is the SQL
-- editor. The compromise is to allow writes from the app but restrict
-- them to admins, so an operator session — the common case, and the one
-- left open all shift on a shared machine — still cannot touch them.
--
-- Reading stays open to any authenticated user: dispatch needs to ring a
-- driver, it just does not need to edit them.

CREATE POLICY "driver_directory_insert_admin"
  ON public.driver_directory FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "driver_directory_update_admin"
  ON public.driver_directory FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "driver_directory_delete_admin"
  ON public.driver_directory FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- The app upserts on full_name, so it needs to be unique. Names are
-- matched fuzzily when joining to Wialon, but the stored row is keyed on
-- the exact string, and two rows for one name would make "which phone is
-- current" unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS driver_directory_full_name_key
  ON public.driver_directory (full_name);

-- Keep updated_at honest; nothing was maintaining it.
CREATE OR REPLACE FUNCTION public.touch_driver_directory()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_directory_touch ON public.driver_directory;
CREATE TRIGGER driver_directory_touch
  BEFORE UPDATE ON public.driver_directory
  FOR EACH ROW EXECUTE FUNCTION public.touch_driver_directory();
