-- ── 072: a truck's distance over a trailing window, for Rapport Parc ──
--
-- The parc log records an ENTRY every time a truck crosses the HQ
-- geofence — including when it left for a nearby errand (oil change,
-- a tyre shop) and came back an hour later. The owner told no real
-- way to tell a truck that just returned from a 600 km trip apart from
-- one that slipped out and back. His fix: next to each entry, show how
-- far that truck drove in the last 24 hours. 600 km next to an entry
-- from an hour ago means "got here"; 1.4 km means "stayed local".
--
-- The source is fleet_snapshots, which the tick already writes every
-- minute with every truck's lat/lng. That history is pruned after seven
-- days, so the windows the owner asked for (2h, 12h, 24h) all sit well
-- inside retention. Distance is the sum of haversine hops between
-- consecutive ticks for that truck over the window.
--
-- The hop floor is what makes the number readable: raw GPS wanders
-- metres even when parked, and summing it would report a parked truck
-- as having driven. Any hop under 150 m is treated as no movement. On
-- real data that reads 620-875 km for trucks back from a long run,
-- 0-2 km for trucks parked in the parc, and ~1 km for a quick errand —
-- exactly the discrimination the column exists for.
--
-- Computed ON READ, deliberately, not precomputed: the report is opened
-- a few times a day, a 24 h window touches 1440 snapshot rows, and an
-- on-demand RPC costs a couple of hundred milliseconds on Supabase.
-- Precomputing hourly would scan those same rows every hour whether the
-- report is asked for or not — and a partial hour would need handling
-- anyway. Nothing runs on Vercel either way: the heavy lifting is this
-- query, the route only shuttles the result.

-- Haver's formula, metres. The app has haversineMeters in JS, but the
-- report needs it in SQL and the two places cannot share a function;
-- keeping it in Postgres alongside the query that uses it.
CREATE OR REPLACE FUNCTION public.haversine_m(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT 2 * 6371000 * asin(sqrt(
    sin(radians((p_lat1 - p_lat2) / 2)) ^ 2
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * sin(radians((p_lng1 - p_lng2) / 2)) ^ 2
  ))
$function$;

-- One row per truck that had at least one usable tick in the window.
-- A truck that was tracked but did not move comes back with km = 0, so
-- the UI can tell "tracked, stationary" from "no data at all" (a truck
-- offline the whole window never appears). Trucks with no ticks are
-- absent on purpose: 0 would say it drove nothing, and the report has
-- no right to that claim about a truck Wialon never heard from.
CREATE OR REPLACE FUNCTION public.truck_distance_window(
  p_hours     integer DEFAULT 24,
  p_min_hop_m numeric DEFAULT 150
)
RETURNS TABLE (truck_id text, km numeric)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH fixes AS (
    SELECT
      s.captured_at,
      e ->> 'truck_id' AS truck_id,
      (e ->> 'lat')::double precision AS lat,
      (e ->> 'lng')::double precision AS lng
    FROM public.fleet_snapshots s
    CROSS JOIN LATERAL jsonb_array_elements(s.snapshot_data) AS e
    WHERE s.captured_at >= now() - (p_hours || ' hours')::interval
      AND e ->> 'lat' IS NOT NULL
      AND e ->> 'lng' IS NOT NULL
  ),
  hops AS (
    SELECT
      truck_id,
      public.haversine_m(lat, lng, lag(lat) OVER w, lag(lng) OVER w) AS metres
    FROM fixes
    WINDOW w AS (PARTITION BY truck_id ORDER BY captured_at)
  )
  SELECT truck_id, round(sum(metres) FILTER (WHERE metres >= p_min_hop_m)::numeric / 1000, 1) AS km
  FROM hops
  GROUP BY truck_id
  ORDER BY truck_id
$function$;

-- Same lockdown as 071: revoke from PUBLIC and anon before granting to
-- authenticated, in that order. haversine_m is called INSIDE the RPC by
-- an invoker (language sql, no SECURITY DEFINER), so the caller needs
-- execute on it too or the RPC dies with permission denied.
REVOKE ALL ON FUNCTION public.haversine_m(double precision, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.truck_distance_window(integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.haversine_m(double precision, double precision, double precision, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.truck_distance_window(integer, numeric) TO authenticated;