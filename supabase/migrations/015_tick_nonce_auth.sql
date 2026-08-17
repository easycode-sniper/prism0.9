-- ━─ Authenticate the tick without a hand-copied shared secret ━──
-- 014 authenticated /api/tick with CRON_SECRET: a value that had to be
-- set identically in Supabase Vault and in the hosting environment. That
-- is one manual step in two dashboards, and getting it wrong fails as a
-- silent 401 on a schedule nobody watches — which is exactly what
-- happened.
--
-- Instead Postgres mints a single-use token per tick and the route
-- redeems it against this table with the service role. Forging one means
-- already having write access to the database, and redeeming is a delete,
-- so a captured token can't be replayed. Nothing to copy anywhere.

CREATE TABLE IF NOT EXISTS public.tick_nonces (
  nonce      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No policies: the service role bypasses RLS, and nobody else should
-- see or touch this table at all.
ALTER TABLE public.tick_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tick_nonces FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_tick_nonces_created_at
  ON public.tick_nonces (created_at);

-- Mint a nonce, send it, and drop anything stale. Tokens are only valid
-- for a few minutes, so the table stays tiny without its own cron job.
CREATE OR REPLACE FUNCTION public.dispatch_fleet_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_url    TEXT;
  v_nonce  TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'fleet_tick_url';

  IF v_url IS NULL THEN
    RAISE WARNING 'fleet tick not configured — set fleet_tick_url in Vault';
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

REVOKE ALL ON FUNCTION public.dispatch_fleet_tick() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_fleet_tick() FROM anon, authenticated;
