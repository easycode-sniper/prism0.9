-- ━─ Rapport Geo: the client zone, and a per-truck view of all three ━──
--
-- 039 gave the plant's two zones a durable visit log. It stopped there
-- on purpose — the factory report only ever needed Amouda. The owner's
-- Wialon export for 00045-523-35 shows what is actually wanted:
--
--   zone                                          entrée    sortie    temps
--   Zone d'attente – Usine AMOUDA Ciment          13:31:16  16:20:20  2:49:04
--   Zone chargement – Usine AMOUDA Ciment         15:06:44  16:14:40  1:07:56
--   CIMENTRIE AMOUDA - CLIENT SARL EMESA…, oran   08:33:58  09:40:20  1:06:22
--
-- Three rows, one truck, one chronological table. Two of them we log
-- today; the third we do not log at all. zone_visits.zone_kind is
-- CHECKed to ('factory','factory_loading'), so a client-site visit
-- cannot even be inserted.
--
-- THE SAME WARNING 039 CARRIED APPLIES AND IS WORTH REPEATING: none of
-- this can be backfilled. fleet_snapshots is pruned after seven days
-- and reconstructing polygon crossings from raw positions is lossy, so
-- the client column of this report starts filling from the moment the
-- tick carrying runSiteZoneCheck is deployed and is empty before it.
-- The plant columns go back to 2026-08-31, when 039 shipped.

-- ── 1. A third kind of visit ──────────────────────────────────
ALTER TABLE public.zone_visits DROP CONSTRAINT IF EXISTS zone_visits_zone_kind_check;
ALTER TABLE public.zone_visits ADD CONSTRAINT zone_visits_zone_kind_check
  CHECK (zone_kind IN ('factory', 'factory_loading', 'site'));

-- WHICH site, alongside the name that 039 stamps at entry. The name is
-- the historical record — it is what the zone was called on the day and
-- must not move when someone renames a site — but a name cannot be
-- grouped on reliably (the Wialon export carries typos on both sides,
-- which is why the import matches by distance, not by name). So: the id
-- for grouping, the name for reading. NULL on the two plant kinds,
-- which have no construction_sites row.
--
-- ON DELETE SET NULL rather than CASCADE: deleting a site must not
-- silently erase a truck's history of having been there.
ALTER TABLE public.zone_visits
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.construction_sites(id) ON DELETE SET NULL;

-- The report reads one truck over a range. Without this it is a seq
-- scan over the whole log, which grows by ~150 rows a day and now gains
-- the site visits on top.
CREATE INDEX IF NOT EXISTS idx_zone_visits_truck_entered
  ON public.zone_visits (truck_id, entered_at DESC);

-- ── 2. The per-truck transition flag ──────────────────────────
--
-- WHICH site, not a boolean — exactly the shape 035 settled on for
-- at_blacklisted_station_id, and for the same reason: at_hq/at_factory's
-- one-column-per-zone shape does not survive 51 stations, and it
-- survives 112 site polygons even less. Moving from one site to another
-- is a real transition and closes one visit as it opens the next.
ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS current_site_id UUID REFERENCES public.construction_sites(id) ON DELETE SET NULL;

-- A near-copy of mark_trucks_station_state, for the reason 025 and 039
-- both give: generalising over a column name means dynamic SQL or a
-- CASE in both the SET and the WHERE, and these are the functions a
-- 28-hour outage ran through. DISTINCT because Wialon can hold two
-- units under one name, and a repeated id makes Postgres reject the
-- whole statement (21000) — which would stop site tracking for EVERY
-- truck, not just the duplicated one.
CREATE OR REPLACE FUNCTION public.mark_trucks_site_state(
  p_truck_ids TEXT[],
  p_site_id   UUID
)
RETURNS TABLE (truck_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.fleet_trucks (truck_id, current_site_id)
  SELECT DISTINCT u, p_site_id FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET current_site_id = EXCLUDED.current_site_id, updated_at = NOW()
    WHERE public.fleet_trucks.current_site_id IS DISTINCT FROM EXCLUDED.current_site_id
  RETURNING public.fleet_trucks.truck_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_trucks_site_state(TEXT[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_trucks_site_state(TEXT[], UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_trucks_site_state(TEXT[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_trucks_site_state(TEXT[], UUID) TO service_role;

-- ── 3. What Rapport Geo reads ─────────────────────────────────
--
-- OVERLAP, NOT ENTRY TIME, and this is the one place it deliberately
-- differs from factory_zone_visits. That function filters on entered_at
-- because it is fed a range and asked "what started here". This one is
-- asked "what was this truck doing between these two instants", and a
-- stay that began at 23:50 and ended at 02:00 belongs in BOTH days'
-- reports, not in neither. Filtering by entry time would silently drop
-- the longest waits, which are exactly the ones the owner is looking
-- for.
--
-- The durations reported are the WHOLE visit, not the part inside the
-- range. Clipping them to the window would make a 4-hour wait read as
-- 10 minutes on the day it ended, which is worse than the row appearing
-- in two days' reports with its true length. entered_at and exited_at
-- are both returned so the reader can see it straddles.
--
-- SECURITY INVOKER (the default): zone_visits' SELECT policy already
-- allows any authenticated user, so DEFINER would only widen the blast
-- radius for nothing.
CREATE OR REPLACE FUNCTION public.geo_zone_visits(
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
  -- NULL while the truck is still inside, so the caller can tell an
  -- open visit from one that lasted no time at all. 039's lesson.
  seconds_in_zone BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.truck_id, v.driver_name, v.zone_kind, v.zone_name, v.site_id,
         v.entered_at, v.exited_at,
         CASE WHEN v.exited_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))::BIGINT END
  FROM public.zone_visits v
  WHERE v.truck_id = p_truck_id
    AND v.entered_at < p_to
    AND (v.exited_at IS NULL OR v.exited_at > p_from)
  ORDER BY v.entered_at;
$function$;

-- The strip above the table: one row per zone actually visited, so the
-- owner sees "2h49 waiting across 1 visit" without adding the column up
-- by eye. Aggregated in Postgres, never in JS — PostgREST caps a
-- response at 1000 rows and does NOT error when it truncates, and 041
-- exists because six strip figures were being computed in the browser
-- as medians of per-truck medians.
CREATE OR REPLACE FUNCTION public.geo_zone_totals(
  p_truck_id TEXT,
  p_from     TIMESTAMPTZ,
  p_to       TIMESTAMPTZ
)
RETURNS TABLE (
  zone_kind     TEXT,
  zone_name     TEXT,
  site_id       UUID,
  visits        BIGINT,
  -- Closed visits only. An open one has no duration yet, and counting
  -- it as zero would drag the total down and read as a bug.
  closed_visits BIGINT,
  total_seconds BIGINT,
  max_seconds   BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.zone_kind,
         -- The most recent name seen for that zone in the range: a zone
         -- renamed mid-period should read as its current name in the
         -- summary while each row keeps the name it had.
         (ARRAY_AGG(v.zone_name ORDER BY v.entered_at DESC))[1],
         v.site_id,
         COUNT(*),
         COUNT(*) FILTER (WHERE v.exited_at IS NOT NULL),
         COALESCE(SUM(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))::BIGINT, 0),
         MAX(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))::BIGINT
  FROM public.zone_visits v
  WHERE v.truck_id = p_truck_id
    AND v.entered_at < p_to
    AND (v.exited_at IS NULL OR v.exited_at > p_from)
  -- By zone_kind AND site_id: two different client sites are two rows,
  -- but the two plant zones have a NULL site_id and must not collapse
  -- into one another, which is why zone_kind leads.
  GROUP BY v.zone_kind, v.site_id
  ORDER BY MIN(v.entered_at);
$function$;

GRANT EXECUTE ON FUNCTION public.geo_zone_visits(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.geo_zone_totals(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
