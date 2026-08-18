-- Driver directory: the HR side of a driver, which Wialon does not hold.
--
-- Wialon is the roster of *who drives* — it knows names and which unit a
-- driver is bound to, and nothing else. Phone numbers and home addresses
-- come from a spreadsheet the office keeps. This table is that
-- spreadsheet, so the Drivers page can join the two.
--
-- It is deliberately a table rather than a file in the repo: these are
-- 128 employees' personal phone numbers and home addresses, and the repo
-- is public. Here the rows sit behind RLS and can be corrected without a
-- redeploy.
--
-- Wialon stays the source of truth for who exists. A row here that no
-- Wialon driver matches is simply never rendered — it is reference data,
-- not a roster of its own.
--
-- The 128 rows themselves are NOT in this file, and deliberately so: this
-- migration is public, the data is not. It was loaded from the office
-- spreadsheet directly against the database. To rebuild the table
-- elsewhere, re-import that spreadsheet rather than looking for a seed
-- here.

CREATE TABLE IF NOT EXISTS public.driver_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  hired_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Name matching happens in the application (it has to tolerate reordering
-- and spelling drift, which SQL equality cannot), so this index serves
-- the ordered full-table read the page does, not a lookup.
CREATE INDEX IF NOT EXISTS driver_directory_full_name_idx
  ON public.driver_directory (full_name);

ALTER TABLE public.driver_directory ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in operator. No INSERT/UPDATE/DELETE policy:
-- corrections go through the service role or the SQL editor, the same
-- shape hq_entries uses, so a compromised browser session cannot rewrite
-- staff records.
DROP POLICY IF EXISTS "driver_directory_select" ON public.driver_directory;
CREATE POLICY "driver_directory_select" ON public.driver_directory
  FOR SELECT TO authenticated USING (true);
