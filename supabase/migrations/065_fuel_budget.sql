-- ── The fuel budget ──────────────────────────────────────────────────
--
-- The dashboard's budget gauge ("Fuel budget", the first panel of the
-- right rail) needs one table: a month and the money assigned to it.
-- Nothing else — the consumption side comes from the fuel sheet through
-- fuel_period_stats, exactly as every other fuel panel reads it, so the
-- budget is stored as a target and the sheet stays the one source of
-- what was actually spent.
--
-- The gauge is deliberately MONTHLY: each month gets one budget, set by
-- an admin, and the panel reads the row for the current month. A budget
-- that changed shape per day would be a different product.
--
-- Reads are open to any signed-in user; writes go through the same
-- profile-role gate the clients table uses (migration 051), and the
-- server action refuses the call before it reaches here anyway — the
-- policy is the last red line, not the first.

CREATE TABLE IF NOT EXISTS public.monthly_budgets (
  month date PRIMARY KEY,
  amount numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monthly_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_budgets_read_authenticated"
  ON public.monthly_budgets
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "monthly_budgets_write_admin"
  ON public.monthly_budgets
  FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
  ));

-- The owner's starting figure: September 2026, the month this migration
-- lands in. Subsequent months get their budget set from the panel.
INSERT INTO public.monthly_budgets (month, amount)
VALUES ('2026-09-01', 11234123.31)
ON CONFLICT (month) DO NOTHING;