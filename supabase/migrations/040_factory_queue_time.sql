-- ━─ Queue time: how long a truck waits before it starts loading ━──
--
-- 039 measured each zone on its own. That leaves a gap, and it is the
-- number the owner actually acts on.
--
-- The bay is INSIDE the waiting area, so a truck at the pump is in both
-- zones at once and its waiting-area visit spans the whole stay. The
-- "Attente" duration 039 reports is therefore TOTAL TIME AT THE PLANT,
-- loading included -- not waiting. For 00018-523-35 on 2026-08-31 that
-- is 4:03:28 at the plant, of which 0:35:30 was loading. The real wait
-- is neither figure: it is 09:50:11 - 06:32:44 = 3:17:27, the gap
-- between arriving and starting to load.
--
-- So queue time is a property of a LOADING visit, computed against the
-- waiting visit that encloses it:
--
--   queue = loading.entered_at - waiting.entered_at
--
-- The enclosing visit is looked up over the WHOLE table, never the
-- reported range: a truck that arrives at 23:50 and loads at 00:30 has
-- its waiting visit outside a range that contains its loading visit,
-- and restricting the lookup would silently report that stay as
-- unpaired. Latest-enclosing wins, so a truck that leaves and returns
-- pairs against the stay it was actually on.
--
-- NULL when nothing encloses it, and the report renders that as "—"
-- rather than zero. Real causes: the cutover on 2026-08-31, when
-- at_loading was new and at_factory was already true for trucks on
-- site, and any future case where the bay is entered without the
-- waiting area registering. Validated by replaying that day's
-- snapshots: 16 of 16 loading visits paired, median queue 0:54:30,
-- max 4:41:59, minimum 18 minutes.

-- The pairing lookup is (truck_id, zone_kind, entered_at DESC LIMIT 1).
-- The existing indexes are a partial one on open visits and one on
-- entered_at alone; neither serves this.
CREATE INDEX IF NOT EXISTS idx_zone_visits_truck_zone_entered
  ON public.zone_visits (truck_id, zone_kind, entered_at DESC);

-- DROP before CREATE, both of them: CREATE OR REPLACE cannot widen a
-- RETURNS TABLE, and it fails with a type error rather than doing
-- something surprising. The GRANT does not survive the drop either, so
-- it is reissued at the bottom.
DROP FUNCTION IF EXISTS public.factory_zone_visits(TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.factory_zone_summary(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.factory_zone_visits(
  p_from     TIMESTAMPTZ,
  p_to       TIMESTAMPTZ,
  p_truck_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  truck_id        TEXT,
  driver_name     TEXT,
  zone_kind       TEXT,
  zone_name       TEXT,
  entered_at      TIMESTAMPTZ,
  exited_at       TIMESTAMPTZ,
  seconds_in_zone BIGINT,
  -- Loading visits only; NULL on a waiting row, where it would be
  -- meaningless, and NULL on a loading visit nothing encloses.
  queue_seconds   BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.truck_id, v.driver_name, v.zone_kind, v.zone_name,
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
  WHERE v.entered_at >= p_from
    AND v.entered_at <  p_to
    AND (p_truck_id IS NULL OR v.truck_id = p_truck_id)
  ORDER BY v.truck_id, v.entered_at;
$function$;

CREATE FUNCTION public.factory_zone_summary(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  truck_id            TEXT,
  driver_name         TEXT,
  zone_kind           TEXT,
  visits              BIGINT,
  closed_visits       BIGINT,
  total_seconds       BIGINT,
  median_seconds      BIGINT,
  max_seconds         BIGINT,
  -- On the factory_loading row only, for the same reason as above.
  median_queue_seconds BIGINT,
  max_queue_seconds    BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  WITH v AS (
    SELECT z.*,
           CASE WHEN z.zone_kind <> 'factory_loading' THEN NULL ELSE (
             SELECT EXTRACT(EPOCH FROM (z.entered_at - w.entered_at))
             FROM public.zone_visits w
             WHERE w.truck_id = z.truck_id
               AND w.zone_kind = 'factory'
               AND w.entered_at <= z.entered_at
               AND (w.exited_at IS NULL OR w.exited_at >= z.entered_at)
             ORDER BY w.entered_at DESC
             LIMIT 1
           ) END AS queue
    FROM public.zone_visits z
    WHERE z.entered_at >= p_from AND z.entered_at < p_to
  )
  SELECT v.truck_id,
         (ARRAY_AGG(v.driver_name ORDER BY v.entered_at DESC)
            FILTER (WHERE v.driver_name IS NOT NULL))[1],
         v.zone_kind,
         COUNT(*),
         COUNT(*) FILTER (WHERE v.exited_at IS NOT NULL),
         COALESCE(SUM(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))::BIGINT, 0),
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))
         )::BIGINT,
         MAX(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))::BIGINT,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v.queue)::BIGINT,
         MAX(v.queue)::BIGINT
  FROM v
  GROUP BY v.truck_id, v.zone_kind
  ORDER BY v.truck_id, v.zone_kind;
$function$;

GRANT EXECUTE ON FUNCTION public.factory_zone_visits(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.factory_zone_summary(TIMESTAMPTZ, TIMESTAMPTZ)      TO authenticated;
