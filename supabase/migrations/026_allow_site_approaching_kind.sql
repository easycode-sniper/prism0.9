-- The client-approach alert has never once reached the feed.
--
-- 025 added dispatches.site_approach_notified and the code that fires a
-- 'site_approaching' notification, but left notifications_kind_check
-- listing only the five kinds that existed before it. Every approach
-- alert has therefore been rejected with 23514 (check_violation) at the
-- moment of insert.
--
-- That alone would have been a visible bug. What made it invisible is
-- that the insert in runPositionCheck was fire-and-forget: the error was
-- discarded, the function carried on, and the dispatch update that
-- follows it wrote site_approach_notified = true. The flag exists to
-- make the alert fire once — so from then on the run was marked as
-- already alerted and never tried again. One rejected insert lost the
-- alert for the whole run, silently.
--
-- 00026-523-35 -> ABRAJ INJAZ, TIARET is the proof of both halves: a
-- road-route ETA of 284 seconds, site_approach_notified = true, and no
-- notification row anywhere in the table.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind = ANY (ARRAY[
    'off_route'::text,
    'speeding'::text,
    'site_arrival'::text,
    'site_approaching'::text,
    'factory_arrival'::text,
    'hq_arrival'::text
  ]));

-- Re-arm the runs the swallowed failure marked as alerted. The flag
-- claims an alert was delivered; for these rows none ever was, so the
-- honest value is false — and for any run still on the road it lets the
-- alert fire the way it should have the first time.
--
-- Scoped by NOT EXISTS rather than by id: this repairs exactly the rows
-- where the flag and the feed disagree, and is a no-op on every run
-- whose alert really did land.
UPDATE public.dispatches d
SET site_approach_notified = false
WHERE d.site_approach_notified
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.dispatch_id = d.id
      AND n.kind = 'site_approaching'
  );
