-- Mirror the sheet's own date text, and its row order.
--
-- NOTE: this file's first version explained the change with a theory
-- that turned out to be wrong — that the sheet mixed day-first and
-- month-first formats between hand-pasted batches. It does not. Of 1142
-- rows, 633 have a first component above 12 ("25/8/2026") and so can
-- only be day-first, and not one row has a second component above 12.
-- The format is consistent and the parser reads it correctly.
--
-- The real problem is in the source data: 163 rows in the sheet carry a
-- date that has not happened yet — "8/9/2026", "8/12/2026" — and those
-- sorted above today, so a page ordered on occurred_at and capped at a
-- hundred rows showed nothing but fills dated months ahead.
--
-- So the Carburant page stops depending on that column. occurred_raw
-- holds the cell exactly as the sheet renders it and the page prints
-- that, which keeps a bad date visible as the office typed it rather
-- than laundering it through a reformat. sheet_row is the row's position
-- in the sheet, which is what "the last hundred transactions" means: the
-- sheet is append-ordered, so its last hundred rows are the last hundred
-- logged.
--
-- occurred_at stays, still parsed day-first, because the dashboard's
-- litres-today tile has to filter on a real timestamp. Rows with a bad
-- date in the sheet will still land on the wrong day there — fixing that
-- means fixing the sheet, not the parser.

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
