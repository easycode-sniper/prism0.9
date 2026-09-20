-- ━─ 070: two cadences — live every minute, deep every three ━───────
--
-- The Vercel CPU warning of 2026-09-18 forced the question of which
-- checks actually need a fast clock. The answer split the old
-- monolithic tick in two (src/lib/fleet/tick.ts has the ownership
-- rules):
--
--   LIVE  (/api/tick,       * * * * *)  snapshot + parc/factory/
--                                        loading-bay/station checks —
--                                        I/O-bound, cheap per run.
--   DEEP  (/api/tick/deep,  */3 * * * *) route deviation, ETA,
--                                        site-zone log, speeding —
--                                        CPU-heavy, latency-tolerant.
--
-- The loading bay rides WITH the factory-arrival check on the live
-- cycle on purpose: its queue time is measured against the waiting
-- visit opened by that check, and separating them lets a truck enter
-- the bay before any waiting visit exists — queue time silently null.
--
-- The deep cycle shares tick_nonces with the live one: each dispatch
-- mints its own single-use token, so two schedules drawing from one
-- table cannot collide.
--
-- The fleet_tick_url in Vault still pointed at prism0-9.vercel.app —
-- a 307 redirect on every call since the domain moved to
-- prismfleet.vercel.app. Fixed here rather than left redirecting:
-- a redirect is latency on the hot path and a silent dependency on
-- Vercel keeping the old host alive.

-- Fix the stale live URL in place, then create the deep one. This
-- instance's vault schema exposes create_secret and update_secret but
-- no delete_secret — updating by id is the supported path, and the
-- deep URL is created only when absent so the migration is idempotent.
SELECT vault.update_secret(id, new_secret := 'https://prismfleet.vercel.app/api/tick')
  FROM vault.secrets WHERE name = 'fleet_tick_url';

SELECT vault.create_secret('https://prismfleet.vercel.app/api/tick/deep', 'fleet_deep_tick_url')
 WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'fleet_deep_tick_url');

CREATE OR REPLACE FUNCTION public.dispatch_fleet_deep_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_url   TEXT;
  v_nonce TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'fleet_deep_tick_url';

  IF v_url IS NULL THEN
    RAISE WARNING 'fleet deep tick not configured — set fleet_deep_tick_url in Vault';
    RETURN;
  END IF;

  DELETE FROM public.tick_nonces WHERE created_at < NOW() - INTERVAL '10 minutes';

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.tick_nonces (nonce) VALUES (v_nonce);

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-tick-nonce', v_nonce
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END $$;

REVOKE ALL ON FUNCTION public.dispatch_fleet_deep_tick() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_fleet_deep_tick() FROM anon, authenticated;

-- Reschedule: live back to every minute (the CPU that made that
-- unaffordable moved to the deep cycle's three-minute clock), deep on
-- its own job.
SELECT cron.unschedule('fleet-tick')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-tick');
SELECT cron.schedule('fleet-tick', '* * * * *', $$SELECT public.dispatch_fleet_tick();$$);

SELECT cron.unschedule('fleet-deep-tick')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fleet-deep-tick');
SELECT cron.schedule('fleet-deep-tick', '*/3 * * * *', $$SELECT public.dispatch_fleet_deep_tick();$$);
