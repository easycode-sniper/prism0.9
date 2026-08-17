-- ━─ Durable log of trucks entering the parc ━──────────────
-- Rapport Parc needs a permanent record of every truck that entered
-- PARC OMD. Neither existing table can serve that:
--
--   * notifications is a feed — the UI only ever reads the most recent
--     300, and its rows carry no driver name.
--   * fleet_snapshots is pruned after 7 days, and reconstructing
--     crossings from raw positions is expensive and lossy.
--
-- So entries get their own table. A few rows a day, kept indefinitely,
-- with the driver name captured as it was at the moment of entry rather
-- than looked up later — drivers change, and a log that silently
-- rewrites its own history is worse than no log.

CREATE TABLE IF NOT EXISTS public.hq_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  truck_id    TEXT        NOT NULL,
  driver_name TEXT,
  entered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hq_entries_entered_at
  ON public.hq_entries (entered_at DESC);

ALTER TABLE public.hq_entries ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in operator; written only by the scheduled
-- tick, which uses the service role and bypasses RLS. No insert policy
-- on purpose — nothing else should be able to forge a gate record.
DROP POLICY IF EXISTS "HQ entries viewable by authenticated users" ON public.hq_entries;
CREATE POLICY "HQ entries viewable by authenticated users"
  ON public.hq_entries FOR SELECT TO authenticated USING (true);
