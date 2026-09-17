-- ── 069: Livraisons and Chargements read in time order ───────────────
--
-- Owner's call, 2026-09-17. Rapport Parc and Rapport Geo list their rows
-- chronologically; Livraisons and Chargements ordered by truck first, so
-- the fleet's day was chopped into per-truck blocks and reading it in
-- time order meant jumping around the table. Both now order by entry
-- time — oldest first, the direction the other two reports already read
-- — with truck_id kept as a tiebreak so two trucks entering the same
-- second cannot swap places between runs.
--
-- Built from the LIVE function bodies, not from migrations 053/054/062:
-- the WHERE clauses and the lateral client-name join are byte-identical
-- to what runs today, and only the final ORDER BY changes. The return
-- types are unchanged, so CREATE OR REPLACE keeps the grants 061 put on.

CREATE OR REPLACE FUNCTION public.fleet_site_visits(p_from timestamp with time zone, p_to timestamp with time zone, p_min_seconds integer DEFAULT 1500)
 RETURNS TABLE(truck_id text, driver_name text, zone_name text, client_name text, site_id uuid, entered_at timestamp with time zone, exited_at timestamp with time zone, seconds_on_site bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
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
  ORDER BY v.entered_at, v.truck_id;
$function$;

CREATE OR REPLACE FUNCTION public.fleet_loading_visits(p_from timestamp with time zone, p_to timestamp with time zone, p_min_seconds integer DEFAULT 0)
 RETURNS TABLE(truck_id text, driver_name text, zone_name text, entered_at timestamp with time zone, exited_at timestamp with time zone, seconds_loading bigint, queue_seconds bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT v.truck_id, v.driver_name, v.zone_name, v.entered_at, v.exited_at,
         CASE WHEN v.exited_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))::BIGINT END,
         (SELECT EXTRACT(EPOCH FROM (v.entered_at - w.entered_at))::BIGINT
            FROM public.zone_visits w
           WHERE w.truck_id = v.truck_id
             AND w.zone_kind = 'factory'
             AND w.entered_at <= v.entered_at
             AND (w.exited_at IS NULL OR w.exited_at >= v.entered_at)
           ORDER BY w.entered_at DESC
           LIMIT 1)
  FROM public.zone_visits v
  WHERE v.zone_kind = 'factory_loading'
    AND v.entered_at < p_to
    AND (v.exited_at IS NULL OR v.exited_at > p_from)
    AND EXTRACT(EPOCH FROM (COALESCE(v.exited_at, NOW()) - v.entered_at)) >= p_min_seconds
  ORDER BY v.entered_at, v.truck_id;
$function$;
