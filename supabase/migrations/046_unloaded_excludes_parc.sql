-- ━─ Déchargés: reaching the parc takes a truck off the list ━───
--
-- The owner's fourth rule, 2026-09-02: a truck that reaches PARC OMD is
-- no longer available. 045 already dropped a truck once it reached the
-- PLANT — it is queueing there, not heading — and the parc is the same
-- kind of fact for a different reason: a truck back at headquarters has
-- parked, not been freed.
--
-- READ FROM hq_entries, NOT fleet_trucks.at_hq. at_hq is current state:
-- it goes false again the moment the truck leaves, so a truck that
-- reached the parc and pulled out would silently reappear on the list
-- with a client visit hours stale behind it. hq_entries is the durable
-- log — entry only, no exit, by design since 025 — so "did it reach the
-- parc AFTER it left the client" is a question it can answer and at_hq
-- cannot. Exactly the shape of the plant exclusion above it, which
-- reads zone_visits rather than fleet_trucks.at_factory for the same
-- reason.
--
-- The effect is that a truck leaves the list permanently once it parks,
-- and only a NEW qualifying client stop can put it back. That is the
-- intent: the list answers "who can I send to the factory now", and a
-- truck at the parc is not that, whatever it does next.

CREATE OR REPLACE FUNCTION public.unloaded_trucks(
  p_min_seconds    INT DEFAULT 1500,
  p_max_age_hours  INT DEFAULT 12,
  p_settle_seconds INT DEFAULT 1500
)
RETURNS TABLE (
  truck_id        TEXT,
  driver_name     TEXT,
  zone_name       TEXT,
  site_id         UUID,
  entered_at      TIMESTAMPTZ,
  exited_at       TIMESTAMPTZ,
  seconds_on_site BIGINT,
  free_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $function$
  WITH qualifying AS (
    -- The latest visit that COUNTS AS UNLOADING, not merely the latest
    -- visit: 044 anchored on the latter and a 2-minute drive-through on
    -- the way home erased a 114-minute unload that had already happened.
    SELECT DISTINCT ON (v.truck_id)
           v.truck_id, v.driver_name, v.zone_name, v.site_id,
           v.entered_at, v.exited_at
    FROM public.zone_visits v
    WHERE v.zone_kind = 'site'
      AND v.exited_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)) >= p_min_seconds
    ORDER BY v.truck_id, v.entered_at DESC
  )
  SELECT q.truck_id, q.driver_name, q.zone_name, q.site_id,
         q.entered_at, q.exited_at,
         EXTRACT(EPOCH FROM (q.exited_at - q.entered_at))::BIGINT,
         q.exited_at + MAKE_INTERVAL(secs => p_settle_seconds)
  FROM qualifying q
  WHERE
    -- Rule 2: the settle timer has run out.
    NOW() >= q.exited_at + MAKE_INTERVAL(secs => p_settle_seconds)
    AND q.exited_at >= NOW() - MAKE_INTERVAL(hours => p_max_age_hours)
    -- Back at the plant: queueing, not heading.
    AND NOT EXISTS (
      SELECT 1 FROM public.zone_visits f
      WHERE f.truck_id = q.truck_id
        AND f.zone_kind = 'factory'
        AND f.entered_at > q.exited_at
    )
    -- Back at the parc: parked, not free. The owner's rule, 2026-09-02.
    AND NOT EXISTS (
      SELECT 1 FROM public.hq_entries h
      WHERE h.truck_id = q.truck_id
        AND h.entered_at > q.exited_at
    )
    -- Busy again: inside a site right now.
    AND NOT EXISTS (
      SELECT 1 FROM public.zone_visits s
      WHERE s.truck_id = q.truck_id
        AND s.zone_kind = 'site'
        AND s.entered_at > q.exited_at
        AND s.exited_at IS NULL
    )
  ORDER BY q.exited_at DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.unloaded_trucks(INT, INT, INT) TO authenticated;

-- The lookup this adds is (truck_id, entered_at) on hq_entries, which
-- the parc report does not need and so did not have.
CREATE INDEX IF NOT EXISTS idx_hq_entries_truck_entered
  ON public.hq_entries (truck_id, entered_at DESC);
