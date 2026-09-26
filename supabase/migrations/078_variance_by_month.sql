-- ━─ 078: variance by month, the fleet's arc ━──────────────────────
--
-- WHY. Every fuel panel on the dashboard describes ONE window: the
-- range the selector is set to, or "right now" for the live rail. Nothing
-- on the page shows how the fleet's fuel bill has behaved over time, and
-- that gap became real on 2026-09-24 when January–July was pasted into
-- the sheet — nine months of history the app could read but never drew.
--
-- The money it exposes: 2,936,271 DA of variance across Jan–Sep 2026,
-- invisible until this aggregate existed. August alone is 773,680 DA at
-- 48.02 L/100km against a ~46 norm for the rest of the year.
--
-- NO RANGE PARAMETERS, and that is the point rather than an omission.
-- This aggregate answers "how have we been doing", which is a question
-- about the whole record; handing it a date range would let a reader
-- select September and watch the panel collapse to one bar, which is the
-- entire thing it exists to prevent. It is the second panel on the page
-- to ignore the range selector, after the fuel budget gauge (065), and
-- it says so in its own sub-line.
--
-- The pairing rule is the one fuel_period_stats and truck_variance_leaders
-- already use, restated so the two cannot drift: a fill with no variance
-- logged no distance, so its litres would have no denominator. km,
-- litres_per_100km and variance_da therefore aggregate over the PAIRED
-- fills only (paired_fills); amount_da and fills count every row, because
-- a fill that logged no distance still cost what it cost.
--
-- Bounded rather than open: 60 months is a five-year chart, and the cap
-- is a guard on a growing table rather than a page size — at 1,400 rows
-- a month it is decades away.

CREATE OR REPLACE FUNCTION public.fuel_variance_by_month(
  p_limit INT DEFAULT 24
)
RETURNS TABLE (
  month            DATE,
  paired_fills     BIGINT,
  fills            BIGINT,
  km               NUMERIC,
  litres           NUMERIC,
  amount_da        NUMERIC,
  variance_da      NUMERIC,
  litres_per_100km NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    date_trunc('month', f.occurred_at AT TIME ZONE 'Africa/Algiers')::date AS month,
    count(*) FILTER (WHERE f.variance_da IS NOT NULL)                        AS paired_fills,
    count(*)                                                                 AS fills,
    COALESCE(sum(f.distance_km)  FILTER (WHERE f.variance_da IS NOT NULL), 0) AS km,
    COALESCE(sum(f.litres_filled), 0)                                        AS litres,
    COALESCE(sum(f.amount_da), 0)                                            AS amount_da,
    COALESCE(sum(f.variance_da), 0)                                          AS variance_da,
    round(
      COALESCE(sum(f.litres_filled) FILTER (WHERE f.variance_da IS NOT NULL), 0) * 100
      / NULLIF(sum(f.distance_km)   FILTER (WHERE f.variance_da IS NOT NULL), 0), 2
    )                                                                        AS litres_per_100km
  FROM public.fuel_transactions f
  GROUP BY 1
  -- Newest first, so the LIMIT keeps the most recent months rather than
  -- the oldest; the page reverses for display.
  ORDER BY 1 DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 60);
$function$;

COMMENT ON FUNCTION public.fuel_variance_by_month(INT) IS
  'Monthly fuel totals: variance, amount, km and L/100km per calendar month, paired-fills rule as fuel_period_stats. Backs the "Variance by month" panel, which deliberately ignores the range selector.';

-- Same lockdown as 061/063/068: revoke from PUBLIC and anon FIRST, then
-- grant to the app's users — the revoke alone would lock the app out.
REVOKE ALL ON FUNCTION public.fuel_variance_by_month(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fuel_variance_by_month(INT) TO authenticated;

-- PostgREST caches grants too (063): without the reload the API sits a
-- version behind and the panel says it cannot find the function.
NOTIFY pgrst, 'reload schema';
