-- Mirror the sheet's own date text, and its row order.
--
-- The Date & Time column is genuinely ambiguous, and the sheet's own
-- row order is the only thing that resolves it. The sheet is
-- append-only, so its rows are in chronological order, and read that
-- way the flip is visible at a single boundary: row 510 is
-- "8/12/2026 23:18:51" and row 511 is "13/8/2026 08:11:50" — 12 August
-- into 13 August, continuous. Days 1-12 are written month/day, days 13
-- and up day/month. Every row is August 2026; there is no other month
-- in the sheet and no future date.
--
-- Read day-first, as the parser does, the first 509 rows land on
-- 8 January through 8 December. Those are the wrong months in
-- occurred_at, and 163 of them read as later in the year than today,
-- which is why a page ordered on that column and capped at a hundred
-- rows showed nothing but fills dated months ahead.
--
-- So the Carburant page stops depending on it. occurred_raw holds the
-- cell exactly as the sheet renders it and the page prints that;
-- sheet_row holds the row's position, which is what "the last hundred
-- transactions" means for an append-only sheet.
--
-- occurred_at stays, still parsed day-first, because the dashboard's
-- litres-today tile has to filter on a real timestamp. It is wrong for
-- rows dated on or before the 12th and is known to be — a proper fix
-- is deferred, not forgotten.

ALTER TABLE public.fuel_transactions
  ADD COLUMN IF NOT EXISTS occurred_raw TEXT,
  ADD COLUMN IF NOT EXISTS sheet_row    INTEGER;

-- The page's only ordering, so it gets the index rather than occurred_at.
CREATE INDEX IF NOT EXISTS fuel_transactions_sheet_row_idx
  ON public.fuel_transactions (sheet_row DESC);

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
    occurred_at, occurred_raw, sheet_row, card_no, station, fuel_type, amount_da,
    odometer_km, distance_km, litres_filled,
    expected_litres, expected_cost_da, variance_da
  )
  SELECT
    transaction_no, shift, model, truck_id, category, driver_name,
    occurred_at, occurred_raw, sheet_row, card_no, station, fuel_type, amount_da,
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
    occurred_raw     TEXT,
    sheet_row        INTEGER,
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
