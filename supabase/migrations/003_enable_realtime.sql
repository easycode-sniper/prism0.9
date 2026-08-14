-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PRISM — Enable Realtime on dispatches table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Run this ONCE to enable Supabase Realtime for dispatches.
-- This allows all connected users to see dispatch changes
-- immediately (create, update, delete) without refreshing.
--
-- After running this, open the Supabase dashboard and verify:
-- Database → Replication → supabase_realtime → Source Tables
-- "public.dispatches" should be listed as enabled.

ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatches;
