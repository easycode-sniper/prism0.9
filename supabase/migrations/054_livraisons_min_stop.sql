-- Rapport Livraisons counts a stop only once it passes 25 minutes.
--
-- 053 reported every 'site' visit, and the first week of real data shows
-- why that is the wrong default for THIS report: 192 visits included
-- 61-second and 119-second clips through the edge of a geofence. Those
-- are real visits — the truck genuinely crossed the boundary — but they
-- are not deliveries, and a report headed "Livraisons" that counts them
-- overstates the fleet's work.
--
-- 1500 seconds is not a new number: unloaded_trucks (044) has used the
-- same p_min_seconds DEFAULT 1500 since it shipped, to decide when a
-- truck has actually unloaded rather than merely arrived. Livraisons and
-- Déchargés now answer the same question the same way, which matters
-- because they are read against each other.
--
-- STILL A PARAMETER, and still defaulted, so the threshold is one
-- argument away rather than a migration away.
--
-- AN OPEN VISIT IS JUDGED ON TIME ELAPSED SO FAR, not excluded for
-- having no exit yet: a truck that has been on site three hours and has
-- not left is the clearest delivery in the report, and waiting for the
-- exit to count it would hide exactly the stops someone is watching.
-- One that arrived ten minutes ago is simply not a delivery yet, and
-- appears once it is.

DROP FUNCTION IF EXISTS public.fleet_site_visits(TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.fleet_site_totals(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.fleet_site_visits(
  p_from        TIMESTAMPTZ,
  p_to          TIMESTAMPTZ,
  p_min_seconds INTEGER DEFAULT 1500
)
RETURNS TABLE (
  truck_id        TEXT,
  driver_name     TEXT,
  zone_name       TEXT,
  client_name     TEXT,
  site_id         UUID,
  entered_at      TIMESTAMPTZ,
  exited_at       TIMESTAMPTZ,
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
    AND EXTRACT(EPOCH FROM (COALESCE(v.exited_at, NOW()) - v.entered_at)) >= p_min_seconds
  ORDER BY v.truck_id, v.entered_at;
$function$;

CREATE FUNCTION public.fleet_site_totals(
  p_from        TIMESTAMPTZ,
  p_to          TIMESTAMPTZ,
  p_min_seconds INTEGER DEFAULT 1500
)
RETURNS TABLE (
  truck_id      TEXT,
  deliveries    BIGINT,
  sites         BIGINT,
  closed_visits BIGINT,
  total_seconds BIGINT,
  last_site     TEXT,
  last_entered  TIMESTAMPTZ,
  fleet_sites   BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  -- The SAME predicate as the detail, in one place, because a summary
  -- that counted a different set of visits from the table under it would
  -- be wrong in the way nobody checks.
  WITH v AS (
    SELECT z.truck_id, z.zone_name, z.site_id, z.entered_at, z.exited_at
    FROM public.zone_visits z
    WHERE z.zone_kind = 'site'
      AND z.entered_at < p_to
      AND (z.exited_at IS NULL OR z.exited_at > p_from)
      AND EXTRACT(EPOCH FROM (COALESCE(z.exited_at, NOW()) - z.entered_at)) >= p_min_seconds
  )
  SELECT v.truck_id,
         COUNT(*)::BIGINT,
         COUNT(DISTINCT COALESCE(v.site_id::TEXT, v.zone_name))::BIGINT,
         COUNT(*) FILTER (WHERE v.exited_at IS NOT NULL)::BIGINT,
         COALESCE(SUM(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))
                  FILTER (WHERE v.exited_at IS NOT NULL), 0)::BIGINT,
         (ARRAY_AGG(v.zone_name ORDER BY v.entered_at DESC))[1],
         MAX(v.entered_at),
         (SELECT COUNT(DISTINCT COALESCE(v2.site_id::TEXT, v2.zone_name)) FROM v v2)::BIGINT
  FROM v
  GROUP BY v.truck_id
  ORDER BY v.truck_id;
$function$;

GRANT EXECUTE ON FUNCTION public.fleet_site_visits(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_site_totals(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
