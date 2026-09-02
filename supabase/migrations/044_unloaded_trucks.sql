-- ━─ Who is free: trucks that have finished at the client ━──────
--
-- The dispatcher's question is "who can I count on next". Until now
-- nothing answered it: Active Runs shows a truck as running right up to
-- the moment its dispatch completes, and completion is arrival at the
-- site — not leaving it. The gap between those two, the hours a truck
-- spends unloading, is exactly when it is NOT available, and the moment
-- it drives out is exactly when it is.
--
-- 042 made that moment observable for the first time: a zone_visits row
-- with zone_kind='site' and a non-null exited_at IS "left the client".
-- Nothing new needs recording; this only reads it.
--
-- THE MINIMUM DWELL IS THE WHOLE DESIGN, not a tuning knob. Site visits
-- are logged with STRICT containment and no edge buffer (see
-- fleet/siteZones.ts for why), so a public road clipping a site polygon
-- logs a truck that merely drove past. On the first day of site logging,
-- 2 of 5 closed visits were exactly that:
--
--   real unloading stops   50, 95, 103 minutes
--   drive-throughs          1, 2 minutes
--
-- A list that calls a 60-second pass "finished unloading" is worse than
-- no list, because a dispatcher who is burned once stops believing the
-- rest of it. 25 minutes is the owner's number, chosen 2026-09-01
-- against that spread — comfortably above every drive-through seen and
-- less than half the shortest real stop.
--
-- Two exclusions, both about the list staying true rather than merely
-- correct:
--
--   REACHED THE PLANT SINCE. A truck that already made it back to
--   Amouda is not "heading there", it is queueing — Rapport Geo has it.
--   Two of that first five were in this state within hours.
--
--   TOO OLD. A truck that left a site last night and has not been seen
--   at the plant is a tracker problem, not an availability signal.
--   Ageing out keeps the panel a picture of now.

CREATE OR REPLACE FUNCTION public.unloaded_trucks(
  -- Seconds on site before a visit counts as unloading. The caller
  -- passes it so the threshold lives with the UI that explains it,
  -- rather than being buried where nobody finds it to change.
  p_min_seconds  INT DEFAULT 1500,
  p_max_age_hours INT DEFAULT 12
)
RETURNS TABLE (
  truck_id        TEXT,
  driver_name     TEXT,
  -- The site as it was named on the day, and its id for linking.
  zone_name       TEXT,
  site_id         UUID,
  entered_at      TIMESTAMPTZ,
  exited_at       TIMESTAMPTZ,
  seconds_on_site BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  WITH last_site AS (
    -- The truck's MOST RECENT site visit, open or closed. Taking the
    -- latest rather than the latest closed one is deliberate: a truck
    -- that has since driven into another site is busy again, and the
    -- exited_at test below then correctly drops it.
    SELECT DISTINCT ON (v.truck_id)
           v.truck_id, v.driver_name, v.zone_name, v.site_id,
           v.entered_at, v.exited_at
    FROM public.zone_visits v
    WHERE v.zone_kind = 'site'
    ORDER BY v.truck_id, v.entered_at DESC
  )
  SELECT ls.truck_id, ls.driver_name, ls.zone_name, ls.site_id,
         ls.entered_at, ls.exited_at,
         EXTRACT(EPOCH FROM (ls.exited_at - ls.entered_at))::BIGINT
  FROM last_site ls
  WHERE ls.exited_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (ls.exited_at - ls.entered_at)) >= p_min_seconds
    AND ls.exited_at >= NOW() - MAKE_INTERVAL(hours => p_max_age_hours)
    AND NOT EXISTS (
      SELECT 1 FROM public.zone_visits f
      WHERE f.truck_id = ls.truck_id
        AND f.zone_kind = 'factory'
        AND f.entered_at > ls.exited_at
    )
  -- Most recently freed first: the truck that just became available is
  -- the one a dispatcher is deciding about.
  ORDER BY ls.exited_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.unloaded_trucks(INT, INT) TO authenticated;
