-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PRISM — Enable Realtime on notifications table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Needed so the client-side sound alert listener can react
-- to new notification rows (off_route, speeding, arrivals)
-- as they're inserted, not just on manual page refresh.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
