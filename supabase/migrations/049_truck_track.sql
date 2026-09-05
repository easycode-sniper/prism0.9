-- Quick Track: where a truck has actually been.
--
-- No new table and nothing new to write. The tick already stores one
-- fleet_snapshots row a minute whose snapshot_data is a jsonb array of
-- every truck with lat/lng/speed/status, so the whole trail is already in
-- the database — the same property that let the speeding work replay 48h
-- of history before shipping. This only reads it back for one truck.
--
-- Invoker rights, not SECURITY DEFINER: "Fleet snapshots viewable by
-- authenticated users" is USING (true), so every row this touches is
-- already readable by the caller and a definer function would widen the
-- surface for nothing.
--
-- ── Offline fixes are dropped ──
-- A unit that stops reporting keeps emitting its last known position, and
-- over a measured 24h that was 40.4% of ALL readings (58,701 of 145,238)
-- — the single largest status, ahead of idle and moving. Kept, they
-- collapse into one enormous "stop" wherever the tracker died and the
-- trail asserts the truck sat there. The same stale-fix trap cost the
-- speeding check 34 false readings. Dropped, a silent tracker becomes a
-- hole in the timestamps, and the client breaks the line rather than
-- drawing a straight edge across country the truck may never have
-- crossed. A break says "not known", which is the truth.
--
-- ── Why anchor distance and not a rounded grid ──
-- A parked truck emits the same place every minute, so stays have to
-- collapse to one vertex carrying a duration or "he sat here 93 minutes"
-- cannot be drawn at all. The first version grouped consecutive fixes
-- that shared a 4-decimal (~11m) coordinate. THAT WAS WRONG, and only
-- looking at the actual points showed it: GPS wander while parked at the
-- factory kept nudging the truck across cell boundaries, so a single
-- ~3-hour stay shattered into ~50 "places" of near-zero dwell — a
-- scribble on the map that registered as no stop at all. Two fixes one
-- metre apart can land in different cells; a grid cannot express
-- "nearby".
--
-- So an island is now every consecutive fix within p_radius_m of the
-- island's ANCHOR (its first fix), which has no boundaries to fall
-- across. 75m was chosen against real data: it folds yard jitter into
-- single stays while never merging a moving truck, since even 20 km/h
-- covers 333m between one-minute fixes. An island can never span more
-- than 2*radius, so a creeping vehicle cannot drag one indefinitely.
-- Equirectangular metres rather than PostGIS: at these distances the
-- error is far below the GPS noise being smoothed out.
--
-- Cost is ~250ms over 24h, scaling with the window because the lateral
-- unnest expands every truck in each row and discards the ~100 that are
-- not the one asked for. 7 days — all prune_fleet_snapshots keeps — is
-- around 1.8s. If that ever has to be instant, the fix is an expression
-- index into snapshot_data, not a new table.

CREATE OR REPLACE FUNCTION public.truck_track(
  p_truck_id text,
  p_from     timestamptz,
  p_to       timestamptz,
  p_radius_m double precision DEFAULT 75
)
RETURNS TABLE (
  started_at    timestamptz,
  ended_at      timestamptz,
  lat           double precision,
  lng           double precision,
  top_speed     double precision,
  dwell_seconds integer
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r       record;
  a_lat   double precision;
  a_lng   double precision;
  sum_lat double precision := 0;
  sum_lng double precision := 0;
  n       integer := 0;
  t_start timestamptz;
  t_end   timestamptz;
  v_top   double precision;
  d_m     double precision;
BEGIN
  FOR r IN
    SELECT s.captured_at AS ts,
           (t->>'lat')::float8 AS lat,
           (t->>'lng')::float8 AS lng,
           NULLIF(t->>'speed', '')::float8 AS speed
    FROM public.fleet_snapshots s,
         LATERAL jsonb_array_elements(s.snapshot_data) t
    WHERE s.captured_at >= p_from
      AND s.captured_at <= p_to
      AND t->>'truck_id' = p_truck_id
      AND t->>'status' IS DISTINCT FROM 'offline'
      AND t->>'lat' IS NOT NULL
      AND t->>'lng' IS NOT NULL
    ORDER BY s.captured_at
  LOOP
    IF n > 0 THEN
      d_m := sqrt(
        power((r.lat - a_lat) * 111320.0, 2) +
        power((r.lng - a_lng) * 111320.0 * cos(radians(a_lat)), 2)
      );
    END IF;

    -- Far enough from the anchor to be somewhere else: close the island
    -- and start a new one here.
    IF n = 0 OR d_m > p_radius_m THEN
      IF n > 0 THEN
        started_at := t_start; ended_at := t_end;
        lat := sum_lat / n; lng := sum_lng / n;
        top_speed := v_top;
        dwell_seconds := EXTRACT(epoch FROM (t_end - t_start))::int;
        RETURN NEXT;
      END IF;
      a_lat := r.lat; a_lng := r.lng;
      sum_lat := 0; sum_lng := 0; n := 0; v_top := NULL;
      t_start := r.ts;
    END IF;

    -- The emitted point is the island's MEAN, not its anchor, so a stay
    -- plots at the middle of where the truck actually sat.
    sum_lat := sum_lat + r.lat;
    sum_lng := sum_lng + r.lng;
    n := n + 1;
    t_end := r.ts;
    v_top := GREATEST(COALESCE(v_top, 0), COALESCE(r.speed, 0));
  END LOOP;

  IF n > 0 THEN
    started_at := t_start; ended_at := t_end;
    lat := sum_lat / n; lng := sum_lng / n;
    top_speed := v_top;
    dwell_seconds := EXTRACT(epoch FROM (t_end - t_start))::int;
    RETURN NEXT;
  END IF;
END;
$$;

-- The three-argument first cut is gone, not merely superseded: leaving it
-- would let a caller reach the grid version whose jitter bug is the whole
-- reason for this file's shape.
DROP FUNCTION IF EXISTS public.truck_track(text, timestamptz, timestamptz);

GRANT EXECUTE ON FUNCTION public.truck_track(text, timestamptz, timestamptz, double precision) TO authenticated;
