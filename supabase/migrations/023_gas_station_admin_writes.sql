-- ━─ Gas stations: admin writes ━─────────────────────────
-- 009 created the table with a SELECT policy and nothing else, so with
-- RLS enabled every insert, update and delete was refused — including
-- an admin's. The station list could only ever be what 009 seeded.
--
-- These three policies let an admin maintain the list from the app.
-- Reading stays open to any authenticated user: dispatchers need the
-- pumps on their map, they just cannot edit them.

CREATE POLICY "Gas stations insertable by admins"
  ON public.gas_stations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Gas stations updatable by admins"
  ON public.gas_stations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Gas stations deletable by admins"
  ON public.gas_stations FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Two pumps at the same forecourt are a real thing (north and south
-- carriageway), so the guard is on an exact duplicate of name AND
-- position, not on either alone.
CREATE UNIQUE INDEX IF NOT EXISTS gas_stations_name_position_key
  ON public.gas_stations (name, lat, lng);
