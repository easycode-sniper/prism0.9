-- ━─ 077: the fuel backstop moves to every four hours ━─────────────
--
-- WHAT CHANGED. The fuel sheet grew from 2,636 rows to 13,783 on
-- 2026-09-24 (January–July were pasted above August). The hourly
-- backstop re-reads and re-parses the whole sheet every run, so one
-- sync went from ~3–6 s to ~16 s, and 24 of those a day is the single
-- largest contributor to the project's Vercel Fluid Active CPU — the
-- metric sitting at 3 h 16 m against a 4 h Hobby cap on 2026-09-26.
--
-- WHY THIS IS SAFE. The Apps Script onChange trigger (c35262f) is the
-- PRIMARY path: an edit to the sheet pushes /api/fuel-sync within
-- seconds, and that path is untouched by this migration. This job is
-- the BACKSTOP — it exists for the case where the sheet is edited while
-- the script is asleep, erroring, or its trigger is disabled. Nothing
-- about the dashboard's freshness depends on this schedule: the owner
-- sees edits in seconds either way.
--
-- WHY FOUR HOURS. Not two, not six. A four-hour gap on a figure that
-- is already correct to within a second whenever anyone actually edits
-- the sheet is invisible, and it takes the sync from 24 runs a day to
-- 6 — about 18 runs and ~4.8 minutes of function time a day removed,
-- which is most of what the fuel sheet was costing. It is also the
-- easiest number to reason about when reading the cron table: 00, 04,
-- 08, 12, 16, 20.
--
-- The route's own coalescing (MIN_RUN_INTERVAL_MS in
-- src/app/api/fuel-sync/route.ts) is untouched: a push that arrives
-- inside the quiet window is acknowledged immediately and one trailing
-- run covers the burst, so a burst of edits is still ONE refresh.
--
-- REVERSIBLE. Change the schedule back to '0 * * * *' and the backstop
-- is hourly again; nothing else in this migration is stateful.

SELECT cron.unschedule('fuel-sync')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fuel-sync');

SELECT cron.schedule(
  'fuel-sync',
  '0 */4 * * *',
  $cron$SELECT public.dispatch_fuel_sync();$cron$
);
