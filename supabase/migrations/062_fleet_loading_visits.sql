-- Rapport Chargements: who actually loaded at Amouda, across the fleet.
--
-- The mirror of Livraisons, and asked for as exactly that: Livraisons is
-- every truck at the CLIENT end of a trip, this is every truck at the
-- PLANT end of it. Same zone_visits log, same shape, same range
-- controls; the only thing that changes is which zone_kind is read.
--
-- NO NEW LOGGING. runFactoryLoadingCheck has been writing
-- zone_kind = 'factory_loading' rows since 039. Nothing about the tick
-- changes.
--
-- NOT A REVIVAL OF RAPPORT USINE, which the owner dropped on 2026-09-01.
-- That report showed both plant zones at once — the waiting area and the
-- bay inside it — and the pair is what made it unreadable: the two rows
-- overlap, so every stay appeared twice with durations that must not be
-- added. This reads the BAY ONLY, one row per load, and folds the wait
-- into a column of that same row instead of a second row beside it.
-- Rapport Usine's three RPCs stay revoked and unread (061).

-- ── Why there is no 25-minute floor here ──────────────────────
--
-- Livraisons imposes one (054) because a client-site polygon sits beside
-- a public road: a truck that merely drove past logs a real visit that
-- is not a delivery, and on the first week 43 of 193 site visits were
-- that. The loading bay is not in that position — it is drawn INSIDE the
-- waiting area, off the road, and a truck reaches it only by being sent
-- there. It cannot be clipped in passing.
--
-- The data agrees. Of 326 loadings to 2026-09-14 exactly ONE is under a
-- minute and 14 are under 25 minutes, against a median of 57:31; the
-- Livraisons threshold would silently drop fourteen real loads. So the
-- default is 0 — every entry counts, which is what was asked for — and
-- the parameter exists anyway so a floor is one argument away rather
-- than a migration away, the same way 054 left it.

-- ── The detail ────────────────────────────────────────────────
--
-- OVERLAP, not entry time — 042's rule, kept so this, Livraisons and Geo
-- cannot disagree about which day a visit belongs to. A load that began
-- at 23:50 and ended at 00:40 appears in both days' reports rather than
-- in neither, and the duration reported is the whole visit, not the
-- slice inside the window.
CREATE OR REPLACE FUNCTION public.fleet_loading_visits(
  p_from        TIMESTAMPTZ,
  p_to          TIMESTAMPTZ,
  p_min_seconds INTEGER DEFAULT 0
)
RETURNS TABLE (
  truck_id        TEXT,
  -- Stamped per visit, not resolved now: a truck that changed hands
  -- mid-period shows both names, on the rows they actually drove.
  driver_name     TEXT,
  -- One value in practice — there is a single bay — but returned rather
  -- than assumed, so a second loading zone would appear here instead of
  -- silently merging into the first.
  zone_name       TEXT,
  entered_at      TIMESTAMPTZ,
  -- NULL while the truck is still under the spout.
  exited_at       TIMESTAMPTZ,
  -- NULL for the same reason: an open visit has no duration yet, and a
  -- zero would read as a load that took no time.
  seconds_loading BIGINT,
  -- How long the truck was at the plant BEFORE loading started: this
  -- entry minus the enclosing waiting-zone entry. 040's figure, and the
  -- one that makes this report actionable rather than a count — 322 of
  -- 326 loadings carry it, median 25 minutes, worst 9h47m.
  --
  -- THE ENCLOSING LOOKUP SPANS THE WHOLE TABLE, NEVER p_from/p_to. A
  -- truck that queued at 23:40 and loaded at 00:10 has its waiting row
  -- outside a single-day window, and restricting the subquery to the
  -- range would report exactly those stays as unpaired — the long ones,
  -- which are the ones being looked for. 040 and 043 both say this.
  queue_seconds   BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
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
    -- An OPEN visit is judged on time elapsed so far rather than
    -- excluded for having no exit yet — 054's rule. Moot at the default
    -- of 0, and correct the moment a floor is passed.
    AND EXTRACT(EPOCH FROM (COALESCE(v.exited_at, NOW()) - v.entered_at)) >= p_min_seconds
  -- By truck first, because the question is "what did each truck load"
  -- — a purely chronological fleet list interleaves 48 trucks and
  -- answers it only by being read twice. Same order as Livraisons.
  ORDER BY v.truck_id, v.entered_at;
$function$;

-- ── The summary strip ─────────────────────────────────────────
--
-- Aggregated in Postgres rather than summed from the list above, for the
-- reason 041 exists: the detail is capped at the read, and a total
-- derived from a truncated list is wrong without saying so. One row per
-- truck is ~48 rows and cannot itself be truncated, so the page may
-- safely add THESE up.
CREATE OR REPLACE FUNCTION public.fleet_loading_totals(
  p_from        TIMESTAMPTZ,
  p_to          TIMESTAMPTZ,
  p_min_seconds INTEGER DEFAULT 0
)
RETURNS TABLE (
  truck_id            TEXT,
  loadings            BIGINT,
  -- The totals below are over these, so an open visit cannot read as
  -- zero time under the spout.
  closed_visits       BIGINT,
  total_seconds       BIGINT,
  -- Counted separately from closed_visits because the two sets are not
  -- the same: a load can have ended and still have no enclosing waiting
  -- row (4 of 326 today, all from before the waiting zone was logged).
  -- An average over the wrong denominator is the quiet kind of wrong.
  queued_visits       BIGINT,
  total_queue_seconds BIGINT,
  last_entered        TIMESTAMPTZ,
  -- The same number on every row: trucks that loaded at all across the
  -- WHOLE fleet in the range. Not countable from the detail list, which
  -- is capped; Livraisons carries fleet_sites for the same reason.
  fleet_trucks        BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH v AS (
    SELECT z.truck_id, z.entered_at, z.exited_at,
           (SELECT EXTRACT(EPOCH FROM (z.entered_at - w.entered_at))::BIGINT
              FROM public.zone_visits w
             WHERE w.truck_id = z.truck_id
               AND w.zone_kind = 'factory'
               AND w.entered_at <= z.entered_at
               AND (w.exited_at IS NULL OR w.exited_at >= z.entered_at)
             ORDER BY w.entered_at DESC
             LIMIT 1) AS queue_seconds
    FROM public.zone_visits z
    WHERE z.zone_kind = 'factory_loading'
      AND z.entered_at < p_to
      AND (z.exited_at IS NULL OR z.exited_at > p_from)
      AND EXTRACT(EPOCH FROM (COALESCE(z.exited_at, NOW()) - z.entered_at)) >= p_min_seconds
  )
  SELECT v.truck_id,
         COUNT(*)::BIGINT,
         COUNT(*) FILTER (WHERE v.exited_at IS NOT NULL)::BIGINT,
         COALESCE(SUM(EXTRACT(EPOCH FROM (v.exited_at - v.entered_at)))
                  FILTER (WHERE v.exited_at IS NOT NULL), 0)::BIGINT,
         COUNT(v.queue_seconds)::BIGINT,
         COALESCE(SUM(v.queue_seconds), 0)::BIGINT,
         MAX(v.entered_at),
         (SELECT COUNT(DISTINCT v2.truck_id) FROM v v2)::BIGINT
  FROM v
  GROUP BY v.truck_id
  ORDER BY v.truck_id;
$function$;

-- ── Grants ────────────────────────────────────────────────────
--
-- REVOKE BEFORE GRANT, and it is not ceremony: Postgres grants EXECUTE
-- on a new function to PUBLIC by default, and Supabase's `anon` role
-- inherits PUBLIC. That default is what 061 spent a migration undoing
-- across seventeen functions, so a new one that skips these two lines
-- reopens the hole it closed. Every future function in this schema gets
-- the same pair.
REVOKE ALL ON FUNCTION public.fleet_loading_visits(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fleet_loading_totals(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_loading_visits(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_loading_totals(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated;

-- PostgREST caches RPC signatures by ARGUMENT NAME, so a new function is
-- invisible to the API until it is told to look again.
NOTIFY pgrst, 'reload schema';
