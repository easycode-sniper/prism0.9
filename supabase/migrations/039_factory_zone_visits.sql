-- ━─ The plant's second zone, and a durable log of both ━───────────
--
-- The Amouda plant has two zones drawn in Wialon and they measure two
-- different things:
--
--   Zone d'attente   4.2 km²  — the waiting area. A truck enters when it
--                               reaches the plant and joins the queue.
--   Zone chargement  inside it — the loading bay, where cement actually
--                               goes on.
--
-- The report the owner needs is per truck, per zone: heure d'entrée,
-- heure de sortie, temps passé dans la zone. Queue time is the gap
-- between the two entries; loading time is the bay visit on its own.
--
-- Nothing existing can serve that. hq_entries records an entry and no
-- exit. notifications is a feed the UI truncates to 300. fleet_snapshots
-- is pruned after 7 days and reconstructing crossings from raw positions
-- is lossy. So visits get their own table, and — this is the part that
-- cannot be deferred — the logging has to start before the report is
-- written, because none of it can be backfilled.
--
-- ONE CAVEAT, stated here so the report is not read as more precise than
-- it is: the tick samples every 60s, so an entry or exit time is
-- accurate to about a minute. Wialon's own report reads the raw message
-- stream and is exact to the second. Against a four-hour wait and a
-- thirty-minute load that is immaterial, but it is not the same number.
--
-- Validated against the owner's Wialon report for 00018-523-35 on
-- 2026-08-31 by replaying that day's real fixes:
--
--                 Wialon              this
--   waiting       4:03:28             4:03:00
--   loading       0:35:30             0:34:00
--
-- The loading figure only lands there because the bay is tested with
-- STRICT containment and no edge buffer — the queue lane runs ten
-- metres outside it, so a 50m buffer reported 2:38:00. See
-- runFactoryLoadingCheck; scripts/check-factory-zones.mts pins it.

-- ── 1. A kind for the loading bay ─────────────────────────────
--
-- A separate kind rather than a second kind='factory' row. 'factory'
-- means "arrived at the plant" and is what the arrival alert tests;
-- adding the bay to it would have made that test pick whichever row the
-- RPC returned first (see selectFactoryGeofence). The bay is a different
-- event with its own flag, and it raises no alert at all.
ALTER TABLE public.geofences DROP CONSTRAINT IF EXISTS geofences_kind_check;
ALTER TABLE public.geofences ADD CONSTRAINT geofences_kind_check
  CHECK (kind IN ('factory', 'factory_loading', 'site'));

-- ── 2. The per-truck transition flag ──────────────────────────
--
-- Its own column beside at_hq and at_factory, not a shared "current
-- zone". The two factory zones are NESTED — a truck at the pump is
-- inside the waiting area as well — so they are true at the same time by
-- design, and collapsing them would make one zone's state clear the
-- other's.
ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS at_loading BOOLEAN NOT NULL DEFAULT false;

-- Deliberately a near-copy of mark_trucks_factory_state, which is itself
-- a near-copy of mark_trucks_hq_state, for the reason 025 gives:
-- generalising over a column name means dynamic SQL or a CASE in both
-- the SET and the WHERE, and this is the function a 28-hour outage ran
-- through. DISTINCT because Wialon can hold two units under one name,
-- and a repeated id makes Postgres reject the whole statement (21000).
CREATE OR REPLACE FUNCTION public.mark_trucks_loading_state(p_truck_ids TEXT[], p_at_loading BOOLEAN)
RETURNS TABLE (truck_id TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  INSERT INTO public.fleet_trucks (truck_id, at_loading)
  SELECT DISTINCT u, p_at_loading FROM unnest(p_truck_ids) AS u
  ON CONFLICT (truck_id) DO UPDATE
    SET at_loading = EXCLUDED.at_loading, updated_at = NOW()
    WHERE public.fleet_trucks.at_loading IS DISTINCT FROM EXCLUDED.at_loading
  RETURNING public.fleet_trucks.truck_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_trucks_loading_state(TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_trucks_loading_state(TEXT[], BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_trucks_loading_state(TEXT[], BOOLEAN) TO authenticated;

-- ── 3. The visit log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zone_visits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id    TEXT        NOT NULL,
  -- Stamped at the moment of entry rather than resolved at read time.
  -- Drivers change, and a log that silently rewrites its own history is
  -- worse than no log — the same reasoning as hq_entries.
  driver_name TEXT,
  zone_kind   TEXT        NOT NULL CHECK (zone_kind IN ('factory', 'factory_loading')),
  -- The zone's name as it read on the day, for the same reason.
  zone_name   TEXT        NOT NULL,
  entered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL means the truck is still inside. The report has to render that
  -- as an open visit rather than a zero-length one.
  exited_at   TIMESTAMPTZ,
  CONSTRAINT zone_visits_exit_after_entry CHECK (exited_at IS NULL OR exited_at >= entered_at)
);

-- Closing a visit looks up exactly this: the open one for a truck in a
-- zone. Partial, so it stays small however long the log grows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_visits_open
  ON public.zone_visits (truck_id, zone_kind) WHERE exited_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_zone_visits_entered_at
  ON public.zone_visits (entered_at DESC);

ALTER TABLE public.zone_visits ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in operator; written only by the scheduled
-- tick, which uses the service role and bypasses RLS. No insert or
-- update policy on purpose — nothing else should be able to forge or
-- reopen a visit.
DROP POLICY IF EXISTS "Zone visits viewable by authenticated users" ON public.zone_visits;
CREATE POLICY "Zone visits viewable by authenticated users"
  ON public.zone_visits FOR SELECT TO authenticated USING (true);

-- ── 4. What the report reads ──────────────────────────────────
--
-- SECURITY INVOKER (the default): both read zone_visits, whose SELECT
-- policy already allows any authenticated user, so there is nothing for
-- DEFINER to grant and it would only widen the blast radius.
--
-- Aggregated in Postgres, never in JS: PostgREST caps a response at 1000
-- rows and does NOT error when it truncates.

-- Detail — one row per visit, which is the owner's table verbatim.
--
-- SCOPED BY RANGE ON PURPOSE. At ~40 trucks making a couple of visits a
-- day to each of two zones this is roughly 150 rows a day, so a range
-- past about a week approaches that 1000-row cap. Use
-- factory_zone_summary for anything longer.
CREATE OR REPLACE FUNCTION public.factory_zone_visits(
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
  -- NULL while the truck is still inside, so the caller can tell an
  -- open visit from one that lasted no time at all.
  seconds_in_zone BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.truck_id, v.driver_name, v.zone_kind, v.zone_name,
         v.entered_at, v.exited_at,
         CASE WHEN v.exited_at IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))::BIGINT END
  FROM public.zone_visits v
  WHERE v.entered_at >= p_from
    AND v.entered_at <  p_to
    AND (p_truck_id IS NULL OR v.truck_id = p_truck_id)
  ORDER BY v.truck_id, v.entered_at;
$function$;

-- Summary — one row per truck per zone, so the result is bounded by the
-- size of the fleet rather than by the length of the range.
CREATE OR REPLACE FUNCTION public.factory_zone_summary(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS TABLE (
  truck_id       TEXT,
  driver_name    TEXT,
  zone_kind      TEXT,
  visits         BIGINT,
  -- Closed visits only. An open one has no duration yet, and counting it
  -- as zero would drag every average down.
  closed_visits  BIGINT,
  total_seconds  BIGINT,
  median_seconds BIGINT,
  max_seconds    BIGINT
)
LANGUAGE sql
STABLE
AS $function$
  SELECT v.truck_id,
         -- The most recent name seen for that truck in the range, since
         -- the per-visit stamps can legitimately differ across a period.
         (ARRAY_AGG(v.driver_name ORDER BY v.entered_at DESC)
            FILTER (WHERE v.driver_name IS NOT NULL))[1],
         v.zone_kind,
         COUNT(*),
         COUNT(*) FILTER (WHERE v.exited_at IS NOT NULL),
         COALESCE(SUM(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))::BIGINT, 0),
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (v.exited_at - v.entered_at))
         )::BIGINT,
         MAX(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))::BIGINT
  FROM public.zone_visits v
  WHERE v.entered_at >= p_from
    AND v.entered_at <  p_to
  GROUP BY v.truck_id, v.zone_kind
  ORDER BY v.truck_id, v.zone_kind;
$function$;

GRANT EXECUTE ON FUNCTION public.factory_zone_visits(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.factory_zone_summary(TIMESTAMPTZ, TIMESTAMPTZ)      TO authenticated;
