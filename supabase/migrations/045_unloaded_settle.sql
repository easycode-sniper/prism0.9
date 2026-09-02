-- ━─ Déchargés, by the owner's rules ━──────────────────────────
--
-- 044 shipped on a partial reading. The owner stated the rules in full
-- on 2026-09-01:
--
--   1. The truck must stay at the client at least 25 MINUTES for the
--      stop to count as unloading.
--   2. Once it LEAVES, wait another 25 MINUTES. Then it is free and
--      goes on the list.
--   3. The list shows the last client.
--
-- Rule 1 and rule 3 were already right. Rule 2 is new, and fixing a
-- second thing at the same time is the point of this migration.
--
-- ── The settle timer (rule 2) ─────────────────────────────────
--
-- It is a confirmation delay, not a countdown to freedom. Site visits
-- use STRICT containment with no edge buffer, so a truck manoeuvring
-- near the boundary can log an exit it did not really make. Real
-- example from the first day: 000054-525-35 left EQUIPE2 BOUDOUAOU at
-- 19:11 and was back inside at 19:17. Announcing that truck as free at
-- 19:11 would have been wrong six minutes later.
--
-- WORTH KNOWING, because it is close: 000100-525-35 left GREAT WALL HMD
-- after 51 minutes and re-entered EXACTLY 25 minutes later. A 25-minute
-- settle clears that case by seconds. It is the right shape of rule;
-- the margin is thinner than it looks.
--
-- The delay does NOT hide trucks behind their own arrival at the plant:
-- measured on real runs, site exit to plant entry was 79 and 199
-- minutes, both far longer than the settle.
--
-- ── The bug 044 had, which real data exposed ──────────────────
--
-- 044 looked at each truck's LATEST site visit. That is wrong when a
-- truck clips another site's polygon on the way home:
--
--   00033-523-35 unloaded at DJELFA ZCIGC for 114 minutes, left, and
--   51 minutes later passed through BENZAMIA DJELFA for 2 minutes.
--
-- Its latest visit was the 2-minute pass, which fails the dwell test —
-- so a truck that had genuinely finished and was genuinely free
-- DISAPPEARED from the list. The fix is to anchor on the latest
-- QUALIFYING visit (dwell >= threshold) rather than the latest visit of
-- any kind, and to exclude "busy again" separately and explicitly.
--
-- Rule 3 then reads correctly too: the last client is the last one it
-- actually served, not the last polygon it drove through.

CREATE OR REPLACE FUNCTION public.unloaded_trucks(
  p_min_seconds    INT DEFAULT 1500,
  p_max_age_hours  INT DEFAULT 12,
  -- Seconds to wait after the truck leaves before calling it free.
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
  -- So the panel can say "free since", which is not the same instant as
  -- "left the site" now that a settle timer sits between them.
  free_at         TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $function$
  WITH qualifying AS (
    -- The latest visit that COUNTS AS UNLOADING, not merely the latest
    -- visit. See the header: anchoring on the latest visit of any kind
    -- let a 2-minute drive-through on the way home erase a 114-minute
    -- unload that had already happened.
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
    -- Still recent enough to be about now rather than about last night.
    AND q.exited_at >= NOW() - MAKE_INTERVAL(hours => p_max_age_hours)
    -- Back at the plant: it is queueing, not heading. Rapport Geo has it.
    AND NOT EXISTS (
      SELECT 1 FROM public.zone_visits f
      WHERE f.truck_id = q.truck_id
        AND f.zone_kind = 'factory'
        AND f.entered_at > q.exited_at
    )
    -- Busy again. Checked explicitly rather than implied by "latest
    -- visit", which is what let the drive-through case go wrong: a truck
    -- INSIDE a site now is not free, whatever it did earlier, and one
    -- that has since completed another qualifying stop is represented by
    -- that later row instead of this one.
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

-- 044's three-argument signature would otherwise linger and be picked by
-- an older caller, silently skipping the settle timer.
DROP FUNCTION IF EXISTS public.unloaded_trucks(INT, INT);
