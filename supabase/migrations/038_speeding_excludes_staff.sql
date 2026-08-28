-- Keep staff vehicles out of the speeding leaderboard.
--
-- The tick stopped RAISING speeding alerts for staff cars in the same
-- change as this migration, which fixes the feed going forward. It does
-- nothing for the panel: driver_speeding_leaders counts NOTIFICATION
-- ROWS over the operations month, so the 65 staff alerts already on
-- record — 63 of them from a single day — would have gone on topping
-- that list until the month rolled over.
--
-- Filtered here rather than deleted. Those rows are a true record of
-- what the fleet did; the owner's decision is that light vehicles over
-- 90km/h are not actionable, which is a question of what to SHOW, not
-- of what happened. A filter is also reversible — if staff speeding
-- ever matters again, the rows are still there.
--
-- LEFT JOIN, not INNER: a notification whose truck_id has no
-- fleet_trucks row must still be counted. Every vehicle should have one,
-- but "should" is how a silent undercount starts, and an inner join
-- here would quietly drop any truck missing from the roster.

CREATE OR REPLACE FUNCTION public.driver_speeding_leaders(p_limit integer DEFAULT 100)
RETURNS TABLE (
  driver_name text,
  truck_count bigint,
  trucks      text,
  times       bigint,
  last_at     timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT
    -- Same fallback driver_ratings() uses, so a truck with no named
    -- driver reads identically on both panels.
    COALESCE(d.driver_name, '(' || n.truck_id || ')')          AS driver_name,
    count(DISTINCT n.truck_id)                                 AS truck_count,
    string_agg(DISTINCT n.truck_id, ', ' ORDER BY n.truck_id)  AS trucks,
    count(*)                                                   AS times,
    max(n.created_at)                                          AS last_at
  FROM public.notifications n
  LEFT JOIN public.dispatches d    ON d.id = n.dispatch_id
  LEFT JOIN public.fleet_trucks ft ON ft.truck_id = n.truck_id
  WHERE n.kind = 'speeding'
    -- A car that keeps up with traffic is not the alert anyone acts on;
    -- a laden cement truck over the limit is. IS DISTINCT FROM, so a
    -- NULL category (no roster row) counts rather than vanishing.
    AND COALESCE(ft.category, 'truck') IS DISTINCT FROM 'staff'
    -- The operations month, in Africa/Algiers. created_at is timestamptz
    -- and ::date renders in UTC, so an alert at 00:40 local would
    -- otherwise fall into the previous day — and on the 1st, the
    -- previous MONTH. See the note on dashboard_daily_series.
    AND (n.created_at AT TIME ZONE 'Africa/Algiers')
        >= date_trunc('month', (now() AT TIME ZONE 'Africa/Algiers'))
  GROUP BY COALESCE(d.driver_name, '(' || n.truck_id || ')')
  ORDER BY count(*) DESC, max(n.created_at) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

GRANT EXECUTE ON FUNCTION public.driver_speeding_leaders(integer) TO authenticated;

-- A staff car excluded from the check can never have its flag cleared
-- by the check, so anything currently true would freeze there. Zero
-- rows are set today; this is here so re-running the migration after a
-- period of mixed behaviour cannot leave one stuck.
UPDATE public.fleet_trucks
   SET is_speeding = false
 WHERE category = 'staff' AND is_speeding IS TRUE;
