-- Rapport Livraisons: where the WHOLE FLEET delivered, plant excluded.
--
-- Geo answers "where did THIS truck spend its time" and interleaves the
-- plant's two zones with the client sites, because for one truck the
-- waiting and the loading are part of the same day. Asked across the
-- fleet those rows are noise: every truck passes through Amouda between
-- every pair of deliveries, so a fleet-wide Geo would be two thirds
-- plant. This is the same log read the other way — one truck per many
-- rows becomes many trucks, sites only.
--
-- NO NEW LOGGING. Both functions read public.zone_visits, which
-- runSiteZoneCheck has been writing since 042. Nothing about the tick
-- changes.
--
-- Staff cars need no filter here: runSiteZoneCheck takes cargoTrucks, so
-- a staff vehicle has never had a 'site' row to exclude.

-- ── The detail ────────────────────────────────────────────────
--
-- OVERLAP, not entry time — 042's rule, kept so this and Geo cannot
-- disagree about which day a delivery belongs to. A stay that began at
-- 23:50 and ended at 02:00 appears in both days' reports rather than in
-- neither, and the duration reported is the whole visit, not the slice
-- inside the window.
CREATE OR REPLACE FUNCTION public.fleet_site_visits(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  truck_id        TEXT,
  -- Stamped per visit, not resolved now: a truck that changed hands
  -- mid-period shows both names, on the rows they actually drove.
  driver_name     TEXT,
  zone_name       TEXT,
  -- COALESCE order matches unloaded_trucks (052): public.clients is the
  -- maintained directory, construction_sites.client the older import.
  client_name     TEXT,
  site_id         UUID,
  entered_at      TIMESTAMPTZ,
  -- NULL while the truck is still on site.
  exited_at       TIMESTAMPTZ,
  -- NULL for the same reason: an open visit has no duration yet, and a
  -- zero would read as a delivery that took no time.
  seconds_on_site BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.truck_id, v.driver_name, v.zone_name,
         COALESCE(cl.name, s.client) AS client_name,
         v.site_id, v.entered_at, v.exited_at,
         CASE WHEN v.exited_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))::BIGINT END
  FROM public.zone_visits v
  LEFT JOIN public.construction_sites s ON s.id = v.site_id
  LEFT JOIN LATERAL (
    SELECT c.name FROM public.clients c
     WHERE c.site_id = v.site_id
     ORDER BY c.name
     LIMIT 1
  ) cl ON true
  WHERE v.zone_kind = 'site'
    AND v.entered_at < p_to
    AND (v.exited_at IS NULL OR v.exited_at > p_from)
  -- By truck first, because the question is "where did each truck
  -- deliver" — a purely chronological fleet list interleaves 46 trucks
  -- and answers it only by being read twice.
  ORDER BY v.truck_id, v.entered_at;
$function$;

-- ── The summary strip ─────────────────────────────────────────
--
-- Aggregated in Postgres rather than summed from the list above, for the
-- reason 041 exists: the detail is capped at the read, and a total
-- derived from a truncated list is wrong without saying so.
CREATE OR REPLACE FUNCTION public.fleet_site_totals(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  truck_id      TEXT,
  deliveries    BIGINT,
  -- Distinct SITE_ID, not distinct name: the Wialon export carries typos
  -- on both sides, so two spellings of one site would count twice. Falls
  -- back to the name only where a visit has no site_id at all.
  sites         BIGINT,
  -- The total below is over these, so an open visit cannot read as zero
  -- time on site.
  closed_visits BIGINT,
  total_seconds BIGINT,
  last_site     TEXT,
  last_entered  TIMESTAMPTZ,
  -- The same number on every row: distinct sites across the WHOLE fleet
  -- in the range. Not the sum of the per-truck `sites` column, which
  -- counts a site once per truck that went there, and not countable from
  -- the detail list either — that one is capped, and 041 exists because
  -- a total taken from a truncated list is wrong without saying so.
  fleet_sites   BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  WITH v AS (
    SELECT z.truck_id, z.zone_name, z.site_id, z.entered_at, z.exited_at
    FROM public.zone_visits z
    WHERE z.zone_kind = 'site'
      AND z.entered_at < p_to
      AND (z.exited_at IS NULL OR z.exited_at > p_from)
  )
  SELECT v.truck_id,
         COUNT(*)::BIGINT,
         COUNT(DISTINCT COALESCE(v.site_id::TEXT, v.zone_name))::BIGINT,
         COUNT(*) FILTER (WHERE v.exited_at IS NOT NULL)::BIGINT,
         COALESCE(SUM(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))
                  FILTER (WHERE v.exited_at IS NOT NULL), 0)::BIGINT,
         (ARRAY_AGG(v.zone_name ORDER BY v.entered_at DESC))[1],
         MAX(v.entered_at),
         (SELECT COUNT(DISTINCT COALESCE(v2.site_id::TEXT, v2.zone_name))
            FROM v v2)::BIGINT
  FROM v
  GROUP BY v.truck_id
  ORDER BY v.truck_id;
$function$;

-- Read-only reports for any signed-in operator, matching every other
-- report RPC. zone_visits itself is already SELECTable by authenticated.
GRANT EXECUTE ON FUNCTION public.fleet_site_visits(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_site_totals(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
