-- Mirror the sheet's own date text, and its row order.
--
-- The Date & Time column cannot be parsed unambiguously. The sheet is
-- maintained by pasting batches of logs in by hand, and the batches do
-- not agree on a format: read day-first, 474 of 1142 rows land in the
-- wrong month, 44 of them in the future; read month-first, the rows
-- whose day is 13 or more become an impossible month and drop out
-- entirely. Neither reading is right for the whole sheet, and there is
-- nothing in the data that says which applies to a given row.
--
-- So the Carburant page stops interpreting it. occurred_raw holds the
-- cell exactly as the sheet renders it, and the page shows that — what
-- the office sees in the sheet is what it sees in the app, with no
-- reading in between that could be wrong.
--
-- sheet_row is the row's position in the sheet, which is what "the last
-- hundred transactions" actually means: the sheet is append-ordered, so
-- its last hundred rows are the last hundred logged. Ordering on a date
-- nobody can parse would have sorted December above yesterday.
--
-- occurred_at stays, still parsed day-first, because the dashboard's
-- litres-today tile has to filter on a real timestamp. It carries the
-- same ambiguity it always did — this migration does not fix that, it
-- stops the Carburant page depending on it.

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
