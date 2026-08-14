-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PRISM — Fleet snapshots table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Stores periodic fleet telemetry snapshots for
-- historical analysis and cross-session persistence.

CREATE TABLE IF NOT EXISTS public.fleet_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_data JSONB NOT NULL,
  truck_count INTEGER NOT NULL DEFAULT 0,
  moving_count INTEGER NOT NULL DEFAULT 0,
  idle_count INTEGER NOT NULL DEFAULT 0,
  offline_count INTEGER NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fleet_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet snapshots viewable by authenticated users" ON public.fleet_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage fleet snapshots" ON public.fleet_snapshots
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_fleet_snapshots_captured_at
  ON public.fleet_snapshots (captured_at DESC);

-- Keep only last 24 hours of snapshots (cleanup)
-- Run periodically or via pg_cron
-- DELETE FROM public.fleet_snapshots WHERE captured_at < NOW() - INTERVAL '24 hours';
