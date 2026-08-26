-- Retention for the alert feed.
--
-- Notifications had no retention rule at all, and fleet-wide speeding
-- took the feed from a handful a day to roughly 145. Left alone the
-- table grows forever, and every read of it is capped at 1000 rows by
-- PostgREST without an error to say so.
--
-- WHY 40 DAYS AND NOT ONE. The user only wants a DAY of feed, and the
-- feed now asks for a day (NOTIFICATION_FEED_HOURS in
-- src/lib/supabase/history.ts). But two things read this table as a
-- RECORD rather than as a feed, and deleting at a day would break both
-- silently:
--
--   * driver_speeding_leaders() counts speeding alerts MONTH TO DATE for
--     the dashboard's "Over the limit, by driver" panel. At a one-day
--     retention it would collapse to today while the panel carried on
--     saying "this month".
--   * dashboard_daily_series(p_days) builds the "Alerts raised per day"
--     chart from these rows, over up to 90 days and 30 as shipped. At a
--     one-day retention that chart is a single bar.
--
-- 40 days covers a full month-to-date on the 31st plus the 30-day chart,
-- with a week of margin. The rows nobody looks at cost nothing; the ones
-- the user does not want to SEE are already hidden by the feed window.
-- Reducing this is a one-line change, but it is not free — it silently
-- shortens both of those features.
CREATE OR REPLACE FUNCTION public.prune_notifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.notifications WHERE created_at < NOW() - INTERVAL '40 days';
$$;

REVOKE ALL ON FUNCTION public.prune_notifications() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_notifications() FROM anon, authenticated;

-- Alongside prune-fleet-snapshots, a few minutes apart so the two
-- deletes do not land on the same tick.
SELECT cron.unschedule('prune-notifications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'prune-notifications'
);

SELECT cron.schedule(
  'prune-notifications',
  '23 4 * * *',
  $$ SELECT public.prune_notifications(); $$
);
