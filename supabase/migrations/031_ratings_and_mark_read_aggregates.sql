-- Two more reads that would have stopped being right without saying so.
--
-- Same trap as migrations 028 and 029: PostgREST caps a response at 1000
-- rows and does not error when it truncates. Both of these are invisible
-- today because the tables are small — 20 dispatches — and both would
-- have gone quietly wrong later, which is the worst kind of bug to leave
-- in a table that only grows.
--
--   getDriverRatings read every completed and stopped dispatch and
--   aggregated them in JS. Past a thousand runs it would have become
--   "ratings from the oldest thousand", so a driver's score would stop
--   reflecting anything recent while still looking like a score.
--
--   markMyNotificationsRead fetched a user's dispatch ids and passed
--   them to .in(). Past a thousand dispatches the id list is truncated,
--   so the oldest notifications could never be marked read — the button
--   would work and quietly do less than it claimed.
--
-- Both are one statement in Postgres, and neither has a ceiling there.

CREATE OR REPLACE FUNCTION public.driver_ratings()
RETURNS TABLE (
  name           TEXT,
  total_runs     BIGINT,
  deviations     BIGINT,
  speeding_count BIGINT,
  clean_runs     BIGINT,
  score          INT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- Score is the share of runs with NEITHER a deviation NOR a speeding
  -- violation, unchanged from the JS it replaces. A run with no driver
  -- name is still that truck's run and falls back to the truck id in
  -- brackets, also unchanged.
  SELECT
    COALESCE(d.driver_name, '(' || d.truck_id || ')')                    AS name,
    count(*)                                                             AS total_runs,
    count(*) FILTER (WHERE d.ever_off_route)                             AS deviations,
    count(*) FILTER (WHERE d.ever_speeding)                              AS speeding_count,
    count(*) FILTER (WHERE NOT d.ever_off_route AND NOT d.ever_speeding) AS clean_runs,
    round(
      count(*) FILTER (WHERE NOT d.ever_off_route AND NOT d.ever_speeding) * 100.0
      / NULLIF(count(*), 0)
    )::INT                                                               AS score
  FROM public.dispatches d
  WHERE d.status IN ('stopped', 'completed')
  GROUP BY COALESCE(d.driver_name, '(' || d.truck_id || ')')
  ORDER BY count(*) DESC;
$$;

CREATE OR REPLACE FUNCTION public.mark_my_notifications_read()
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
  v_is_admin BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ) INTO v_is_admin;

  IF v_is_admin THEN
    UPDATE public.notifications SET read = TRUE WHERE read = FALSE;
  ELSE
    -- A correlated subquery rather than an id list handed to the client
    -- and passed back in .in(): that round trip is what the 1000-row cap
    -- truncates.
    UPDATE public.notifications n
    SET read = TRUE
    WHERE n.read = FALSE
      AND EXISTS (
        SELECT 1 FROM public.dispatches d
        WHERE d.id = n.dispatch_id AND d.dispatched_by = auth.uid()
      );
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_ratings()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_notifications_read() TO authenticated;
