-- ━─ Déchargés: name the site AND the client ━─────────────────────────
--
-- The panel's third column was headed "Dernier client" but rendered
-- zone_name, which is the SITE — "KOUBA", "TISEMSILET - ELBAYREK". So a
-- dispatcher reading it saw a place where the header promised a company,
-- and reasonably reported the site name as missing: it was there, under
-- the wrong label, with no way to tell which of the two it was.
--
-- Both are wanted, and both were already reachable: the function has
-- returned site_id since 044. This adds client_name beside zone_name so
-- the column can show the site with the company under it.
--
-- COALESCE order is deliberate. public.clients (051) is the maintained
-- directory and wins; construction_sites.client is the older free-text
-- field kept as the fallback for the sites that have no client row yet.
-- The LATERAL takes one row because a site can carry more than one
-- client entry, and this column has space for one name.
--
-- Dropped and recreated rather than CREATE OR REPLACE: Postgres refuses
-- to change a function's OUT parameters in place. Both statements run in
-- one migration, so there is no window where the live monitoring page
-- calls a function that does not exist.

DROP FUNCTION IF EXISTS public.unloaded_trucks(integer, integer, integer);

CREATE FUNCTION public.unloaded_trucks(p_min_seconds integer DEFAULT 1500, p_max_age_hours integer DEFAULT 12, p_settle_seconds integer DEFAULT 1500)
 RETURNS TABLE(truck_id text, driver_name text, zone_name text, client_name text, site_id uuid, entered_at timestamp with time zone, exited_at timestamp with time zone, seconds_on_site bigint, free_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  WITH qualifying AS (
    SELECT DISTINCT ON (v.truck_id)
           v.truck_id, v.driver_name, v.zone_name, v.site_id,
           v.entered_at, v.exited_at
    FROM public.zone_visits v
    WHERE v.zone_kind = 'site'
      AND v.exited_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)) >= p_min_seconds
    ORDER BY v.truck_id, v.entered_at DESC
  )
  SELECT q.truck_id, q.driver_name, q.zone_name,
         COALESCE(cl.name, s.client) AS client_name,
         q.site_id,
         q.entered_at, q.exited_at,
         EXTRACT(EPOCH FROM (q.exited_at - q.entered_at))::BIGINT,
         q.exited_at + MAKE_INTERVAL(secs => p_settle_seconds)
  FROM qualifying q
  LEFT JOIN public.construction_sites s ON s.id = q.site_id
  LEFT JOIN LATERAL (
    SELECT c.name FROM public.clients c
     WHERE c.site_id = q.site_id
     ORDER BY c.name
     LIMIT 1
  ) cl ON true
  WHERE NOW() >= q.exited_at + MAKE_INTERVAL(secs => p_settle_seconds)
    AND q.exited_at >= NOW() - MAKE_INTERVAL(hours => p_max_age_hours)
    AND NOT EXISTS (
      SELECT 1 FROM public.zone_visits f
      WHERE f.truck_id = q.truck_id AND f.zone_kind = 'factory'
        AND f.entered_at > q.exited_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.hq_entries h
      WHERE h.truck_id = q.truck_id AND h.entered_at > q.exited_at
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.zone_visits s2
      WHERE s2.truck_id = q.truck_id AND s2.zone_kind = 'site'
        AND s2.entered_at > q.exited_at AND s2.exited_at IS NULL
    )
  ORDER BY q.exited_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.unloaded_trucks(integer, integer, integer) TO authenticated;
