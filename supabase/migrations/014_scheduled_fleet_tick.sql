-- ━─ Move fleet monitoring off the browser and onto a schedule ━──
-- Until now the whole monitoring cycle — Wialon fetch, snapshot, a
-- position check per active dispatch, HQ arrival sweep — ran inside
-- FleetProvider in every operator's browser. That meant nothing was
-- monitored while the app was closed, and every extra open tab repeated
-- the same work and raced the same writes.
--
-- pg_cron gives minute-level scheduling inside this database, on the
-- free plan, so the schedule needs no Vercel cron and no plan change.
-- pg_net makes the outbound call. The tick itself stays in the Next.js
-- app (/api/tick) so it can reuse the existing Wialon client, geometry
-- and position-check code rather than being ported to Deno.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- The browser now reads truck positions from the newest snapshot row
-- instead of calling Wialon itself, so it needs these pushed to it.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.fleet_snapshots;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- Snapshots are written every minute forever, so they need a retention
-- rule. 7 days is well past what History and the dashboard read.
CREATE OR REPLACE FUNCTION public.prune_fleet_snapshots()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.fleet_snapshots WHERE captured_at < NOW() - INTERVAL '7 days';
$$;

REVOKE ALL ON FUNCTION public.prune_fleet_snapshots() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_fleet_snapshots() FROM anon, authenticated;

-- ── The schedule ──
-- The endpoint URL and shared secret are read from Vault rather than
-- written here, because this file is in git. Set them once with:
--
--   SELECT vault.create_secret('https://<your-app>/api/tick', 'fleet_tick_url');
--   SELECT vault.create_secret('<random string>', 'fleet_tick_secret');
--
-- and put the same secret in the app's CRON_SECRET environment variable.

CREATE OR REPLACE FUNCTION public.dispatch_fleet_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'fleet_tick_url';
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'fleet_tick_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'fleet tick not configured — set fleet_tick_url and fleet_tick_secret in Vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END $$;

REVOKE ALL ON FUNCTION public.dispatch_fleet_tick() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_fleet_tick() FROM anon, authenticated;

SELECT cron.unschedule('fleet-tick') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'fleet-tick'
);
SELECT cron.schedule('fleet-tick', '* * * * *', 'SELECT public.dispatch_fleet_tick()');

SELECT cron.unschedule('prune-fleet-snapshots') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'prune-fleet-snapshots'
);
SELECT cron.schedule('prune-fleet-snapshots', '17 4 * * *', 'SELECT public.prune_fleet_snapshots()');
