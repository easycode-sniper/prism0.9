-- Fuel transactions, synced from the office's Google Sheet.
--
-- This is measured data — actual pump transactions, not a distance-based
-- estimate — and takes over from fleet_day_metrics' fuel estimate on any
-- day it has real rows. See src/lib/fuel/parse.ts for how a sheet row
-- becomes a row here; two things worth knowing at the schema level:
--
--   Full refresh, not incremental. The source is a live spreadsheet
--   people edit directly — correcting a typo, deleting a duplicate row —
--   and at ~1,600 rows/month there is no cost to just re-reading
--   everything and replacing the table each sync, which is the only way
--   an edit or deletion in the sheet is reflected here at all. See
--   refresh_fuel_transactions() below.
--
--   category exists because not every fill is a cargo truck. ~7% of
--   transactions in the source are logged against "Vh Service" — pool
--   vehicles Wialon doesn't track — and those rows have no truck_id to
--   give. Keeping them as their own category rather than dropping them
--   or forcing a fake truck match is what the source data actually says.

CREATE TABLE IF NOT EXISTS public.fuel_transactions (
  transaction_no   TEXT PRIMARY KEY,
  shift            TEXT,
  model            TEXT,
  truck_id         TEXT,
  category         TEXT NOT NULL CHECK (category IN ('truck', 'vh_service')),
  driver_name      TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  card_no          TEXT,
  station          TEXT,
  fuel_type        TEXT,
  amount_da        NUMERIC NOT NULL,
  odometer_km      NUMERIC,
  distance_km      NUMERIC,
  litres_filled    NUMERIC,
  -- Recomputed from distance_km at the sheet's own assumed rate, not
  -- copied from the sheet's "Liters per Km" / "Cost per Km" / Variance
  -- columns — those are sometimes literally "#VALUE!" in the source
  -- (18 of 800 real rows, all from a distance value the sheet itself
  -- stored as locale-formatted text instead of a number). Recomputing
  -- recovers those for free.
  expected_litres  NUMERIC,
  expected_cost_da NUMERIC,
  variance_da      NUMERIC,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fuel_transactions_occurred_at_idx
  ON public.fuel_transactions (occurred_at);
CREATE INDEX IF NOT EXISTS fuel_transactions_truck_id_idx
  ON public.fuel_transactions (truck_id);

ALTER TABLE public.fuel_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fuel_transactions_select" ON public.fuel_transactions;
CREATE POLICY "fuel_transactions_select" ON public.fuel_transactions
  FOR SELECT TO authenticated USING (true);
-- No insert/update/delete policy: only the sync route writes here, via
-- the service role, same shape as driver_directory and hq_entries.

-- Atomic full-table replace. Wrapping the delete+insert in one function
-- (rather than two calls from the route handler) means there is no
-- window where a concurrent read sees an empty table mid-sync.
CREATE OR REPLACE FUNCTION public.refresh_fuel_transactions(p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INT;
BEGIN
  -- WHERE true rather than a bare DELETE: Supabase runs pg_safeupdate,
  -- which refuses an unqualified DELETE as a guard against wiping a
  -- table by accident. The intent here really is "every row" — this is a
  -- full refresh — so the predicate is spelled out explicitly.
  --
  -- NOTE: the JSON keys in p_rows must be snake_case to match the column
  -- names declared below. jsonb_to_recordset matches by exact string and
  -- silently produces NULLs for anything it cannot match, so camelCase
  -- input fails here as a NOT NULL violation on transaction_no rather
  -- than as anything that names the real problem. See toDbRow() in
  -- src/app/api/fuel-sync/route.ts.
  DELETE FROM public.fuel_transactions WHERE true;

  INSERT INTO public.fuel_transactions (
    transaction_no, shift, model, truck_id, category, driver_name,
    occurred_at, card_no, station, fuel_type, amount_da,
    odometer_km, distance_km, litres_filled,
    expected_litres, expected_cost_da, variance_da
  )
  SELECT
    transaction_no, shift, model, truck_id, category, driver_name,
    occurred_at, card_no, station, fuel_type, amount_da,
    odometer_km, distance_km, litres_filled,
    expected_litres, expected_cost_da, variance_da
  FROM jsonb_to_recordset(p_rows) AS x(
    transaction_no   TEXT,
    shift            TEXT,
    model            TEXT,
    truck_id         TEXT,
    category         TEXT,
    driver_name      TEXT,
    occurred_at      TIMESTAMPTZ,
    card_no          TEXT,
    station          TEXT,
    fuel_type        TEXT,
    amount_da        NUMERIC,
    odometer_km      NUMERIC,
    distance_km      NUMERIC,
    litres_filled    NUMERIC,
    expected_litres  NUMERIC,
    expected_cost_da NUMERIC,
    variance_da      NUMERIC
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_fuel_transactions(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_fuel_transactions(JSONB) FROM anon, authenticated;

-- ── Scheduling, mirroring migration 015's tick-nonce pattern exactly ──
-- Same reasoning: a single-use token Postgres mints per call, redeemed
-- by deleting it, is strictly harder to forge than a hand-copied secret
-- and needs nothing configured in two places.

CREATE TABLE IF NOT EXISTS public.fuel_sync_nonces (
  nonce      TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fuel_sync_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fuel_sync_nonces FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.dispatch_fuel_sync()
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
    FROM vault.decrypted_secrets WHERE name = 'fuel_sync_url';

  IF v_url IS NULL THEN
    RAISE WARNING 'fuel sync not configured — set fuel_sync_url in Vault';
    RETURN;
  END IF;

  DELETE FROM public.fuel_sync_nonces WHERE created_at < NOW() - INTERVAL '10 minutes';

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.fuel_sync_nonces (nonce) VALUES (v_nonce);

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-fuel-sync-nonce', v_nonce
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_fuel_sync() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_fuel_sync() FROM anon, authenticated;

-- Every 15 minutes: pump transactions do not need minute-level freshness,
-- and this keeps the sync well under Sheets' 60-reads/min quota (one
-- read per run either way).
SELECT cron.unschedule('fuel-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fuel-sync');

SELECT cron.schedule(
  'fuel-sync',
  '*/15 * * * *',
  $cron$SELECT public.dispatch_fuel_sync();$cron$
);
