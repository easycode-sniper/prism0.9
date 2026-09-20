-- ── 073: Rapport Parc gains the truck's model ─────────────────────────
--
-- The owner asked for a Model column up front in the parc report. The
-- model is NOT stored anywhere: it is derived from the plate by
-- public.truck_model (063/064) — "the model is read from the plate".
-- A view is the one way to apply that per entry without a round trip
-- per truck, and making it this SQL's home moves the staff exclusion
-- INTO the query as well: the old read filtered staff client-side (an
-- `in` list built from fleet_trucks), and reports.ts kept repeating
-- why that had to be in the query rather than the result. Here it is
-- in the query — strictly better, because PostgREST now never sees a
-- staff row at all, so neither the exact count nor the returned rows
-- can include one.
--
-- SECURITY INVOKER so the view respects hq_entries' RLS (authenticated
-- SELECT, verified live) instead of silently reading as its owner.
-- LEFT JOIN + COALESCE keeps an entry for a truck that is not in the
-- roster at all — the current code shows those; the join must not
-- start dropping them. The category guard is 063's spelling verbatim.

CREATE OR REPLACE VIEW public.hq_entries_parc
WITH (security_invoker = true)
AS
  SELECT
    e.id,
    e.truck_id,
    e.driver_name,
    e.entered_at,
    public.truck_model(e.truck_id) AS model
  FROM public.hq_entries e
  LEFT JOIN public.fleet_trucks t ON t.truck_id = e.truck_id
  WHERE COALESCE(t.category, 'truck') IS DISTINCT FROM 'staff';

-- Same lockdown as every app-facing read: anon may not probe the gate
-- log through this window, authenticated may read it.
REVOKE ALL ON public.hq_entries_parc FROM PUBLIC, anon;
GRANT SELECT ON public.hq_entries_parc TO authenticated;

-- Fresh grants are invisible to PostgREST until it reloads its schema
-- cache; 063 taught the repo that skipping this is how the API sits a
-- version behind.
NOTIFY pgrst, 'reload schema';