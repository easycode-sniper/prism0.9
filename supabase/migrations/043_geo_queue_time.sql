-- ━─ Rapport Geo: the wait, and who was driving ━────────────────
--
-- 042 gave Geo the three zones. Reading it back, the owner described
-- what he expected from it as "when he entered the factory, how much he
-- spent waiting, how much he spent loading" — and the middle one was
-- not there.
--
-- It is the same trap 040 was written for, and dropping Rapport Usine
-- on 2026-09-01 walked back into it: the bay is INSIDE the waiting
-- area, so an Attente row spans the whole stay and its duration is
-- PRÉSENCE — time at the plant, loading included — not waiting. On
-- 00018-523-35's 2026-08-31 run that was 4:03:28 présence against a
-- 3:17:27 actual wait. Not a rounding difference; a different number.
--
-- The wait already existed as queue_seconds in factory_zone_visits.
-- Usine displayed it, Geo did not, and deleting Usine took the only
-- view of it off the screen. This puts it back on the report that
-- survived.
--
-- The pairing rule is 040's, verbatim, including the part that is easy
-- to get wrong: the enclosing waiting visit is looked up over the WHOLE
-- zone_visits table, NEVER the reported range. A truck that arrives at
-- 23:50 and loads at 00:30 has its waiting visit outside a range that
-- contains its loading visit, and restricting the lookup would silently
-- report that stay as unpaired. Latest-enclosing wins, so a truck that
-- leaves and returns pairs against the stay it was actually on.
--
-- driver_name needs no schema change — 039 has stamped it on every
-- visit since the beginning, and geo_zone_visits already returns it.
-- Only the table was not showing it. The index this lookup wants,
-- (truck_id, zone_kind, entered_at DESC), was added by 040.

-- CREATE OR REPLACE cannot widen a RETURNS TABLE — it fails with a type
-- error rather than doing something surprising — so the function is
-- dropped first. The GRANT does not survive the drop and is reissued.
DROP FUNCTION IF EXISTS public.geo_zone_visits(TEXT, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.geo_zone_visits(
  p_truck_id TEXT,
  p_from     TIMESTAMPTZ,
  p_to       TIMESTAMPTZ
)
RETURNS TABLE (
  truck_id        TEXT,
  driver_name     TEXT,
  zone_kind       TEXT,
  zone_name       TEXT,
  site_id         UUID,
  entered_at      TIMESTAMPTZ,
  exited_at       TIMESTAMPTZ,
  seconds_in_zone BIGINT,
  -- Loading visits only. NULL on an Attente row, where it would be
  -- meaningless; NULL on a client row for the same reason — a site has
  -- no inner zone to wait for; and NULL on a loading visit that nothing
  -- encloses, which the report renders blank rather than zero.
  queue_seconds   BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.truck_id, v.driver_name, v.zone_kind, v.zone_name, v.site_id,
         v.entered_at, v.exited_at,
         CASE WHEN v.exited_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))::BIGINT END,
         CASE WHEN v.zone_kind <> 'factory_loading' THEN NULL ELSE (
           SELECT EXTRACT(EPOCH FROM (v.entered_at - w.entered_at))::BIGINT
           FROM public.zone_visits w
           WHERE w.truck_id = v.truck_id
             AND w.zone_kind = 'factory'
             AND w.entered_at <= v.entered_at
             AND (w.exited_at IS NULL OR w.exited_at >= v.entered_at)
           ORDER BY w.entered_at DESC
           LIMIT 1
         ) END
  FROM public.zone_visits v
  WHERE v.truck_id = p_truck_id
    -- OVERLAP, not entry time — 042's rule. A stay that began at 23:50
    -- and ended at 02:00 belongs in both days' reports rather than
    -- neither, and the long waits are exactly the ones that straddle.
    AND v.entered_at < p_to
    AND (v.exited_at IS NULL OR v.exited_at > p_from)
  ORDER BY v.entered_at;
$function$;

GRANT EXECUTE ON FUNCTION public.geo_zone_visits(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
