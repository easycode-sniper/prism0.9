-- ━─ The model mix, by amount ━──────────────────────────────────────────
--
-- The dashboard's new treemap ("Fuel by model") sizes three rectangles —
-- MAN, Renault, SHACMAN — by what each model was paid at the pump. This
-- migration is the aggregate behind it, and it settles a piece of drift
-- on the way through.
--
-- ── 0. truck_model, which belongs in this repo and is not ─────────────
--
-- A classification function `public.truck_model(text)` was written and
-- applied on the PROJECT — as a pair of console migrations on
-- 2026-09-14, `truck_model_consumption` and `truck_model_category_guard`
-- — but never committed to a file here, so a fresh database from these
-- migrations could not reproduce it. It is idempotent, so the CREATE
-- OR REPLACE below both heals the repo and leaves the live database
-- untouched. The definition is verbatim from the project, spelling and
-- all ("Shackman", not "Shacman").
--
-- What it says: a plate classifies as a model only when its second
-- hyphen-separated part is a "5" year (51x/52x — the truck-era plates
-- the fleet actually runs). Staff and VH Service plates carry different
-- digits and come back NULL, which is the whole point — they are not
-- trucks and must never inflate a model's figure. Third part "16"
-- (wilaya-of-origin) is a Renault. Year 523 is the MAN; 519/522/525 are
-- the SHACMAN.
CREATE OR REPLACE FUNCTION public.truck_model(p_truck_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_truck_id IS NULL THEN NULL
    WHEN split_part(p_truck_id, '-', 2) NOT LIKE '5%' THEN NULL
    WHEN split_part(p_truck_id, '-', 3) = '16'  THEN 'Renault'
    WHEN split_part(p_truck_id, '-', 2) = '523' THEN 'MAN'
    WHEN split_part(p_truck_id, '-', 2) IN ('519', '522', '525') THEN 'Shackman'
  END
$function$;

COMMENT ON FUNCTION public.truck_model(TEXT) IS
  'Classifies a plate into MAN / Renault / Shackman, NULL for staff and VH Service. Reproduced verbatim from the console migrations truck_model_consumption and truck_model_category_guard (2026-09-14) so the repo can rebuild the database.';

-- ── 1. The aggregate ─────────────────────────────────────────────────
--
-- One row per model, ordered by amount so the page can rank without a
-- second question, plus the window totals on every row (like
-- fuel_station_leaders in 060): the treemap's cell areas are each
-- model's share of the total, and deriving that total from a list the
-- database already limited would be the exact bug the station donut's
-- remainder saved us from.
--
-- The window is scoped the same way fuel_period_stats is (060):
-- date bounds, then norm_driver_name / truck_id. Staff plates are
-- excluded by tenure — a staff vehicle has no model, so its row is
-- classified NULL — and the category guard is on top of that as defence
-- in depth, exactly as truck_model_category_guard did it.
--
-- litres_per_100km follows the headline's pairing rule: only fills that
-- carry a variance. A fill without one logged no distance, so its litres
-- in the numerator with nothing in the denominator would overstate what
-- that model burns.
DROP FUNCTION IF EXISTS public.fuel_model_stats(DATE, DATE, TEXT, TEXT);
CREATE FUNCTION public.fuel_model_stats(
  p_from    DATE DEFAULT NULL,
  p_to      DATE DEFAULT NULL,
  p_driver  TEXT DEFAULT NULL,
  p_truck   TEXT DEFAULT NULL
)
RETURNS TABLE (
  model             TEXT,
  fills             BIGINT,
  litres            NUMERIC,
  amount_da         NUMERIC,
  litres_per_100km  NUMERIC,
  total_fills       BIGINT,
  total_amount      NUMERIC,
  total_litres      NUMERIC
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH scoped AS (
    SELECT f.*
    FROM public.fuel_transactions f
    LEFT JOIN public.fleet_trucks ft ON ft.truck_id = f.truck_id
    WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
      AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
      AND (p_driver IS NULL
           OR public.norm_driver_name(f.driver_name) = public.norm_driver_name(p_driver))
      AND (p_truck IS NULL OR f.truck_id = p_truck)
      AND COALESCE(ft.category, 'truck') IS DISTINCT FROM 'staff'
  ),
  per_model AS (
    SELECT
      public.truck_model(f.truck_id)                                   AS model,
      count(*)::BIGINT                                                 AS fills,
      COALESCE(sum(f.litres_filled), 0)                                AS litres,
      COALESCE(sum(f.amount_da), 0)                                    AS amount_da,
      round(
        COALESCE(sum(f.litres_filled) FILTER (WHERE f.variance_da IS NOT NULL), 0) * 100
        / NULLIF(sum(f.distance_km)   FILTER (WHERE f.variance_da IS NOT NULL), 0), 2
      )                                                                AS litres_per_100km
    FROM scoped f
    GROUP BY 1
  ),
  totals AS (
    SELECT COALESCE(sum(fills), 0)::BIGINT AS total_fills,
           COALESCE(sum(amount_da), 0)     AS total_amount,
           COALESCE(sum(litres), 0)        AS total_litres
    FROM per_model
  )
  SELECT pm.model,
         pm.fills,
         pm.litres,
         pm.amount_da,
         pm.litres_per_100km,
         t.total_fills,
         t.total_amount,
         t.total_litres
  FROM per_model pm, totals t
  WHERE pm.model IS NOT NULL
  ORDER BY pm.amount_da DESC, pm.model;
$function$;

COMMENT ON FUNCTION public.fuel_model_stats(DATE, DATE, TEXT, TEXT) IS
  'Per-model fuel totals (fills, litres, amount, L/100km on paired fills) plus window totals, ordered by amount. Backs the "Fuel by model" treemap. Scoped like fuel_period_stats; staff excluded.';

-- ── 2. Grants ─────────────────────────────────────────────────────────
-- The 061 pattern: app-called functions are authenticated-only. The new
-- aggregate is SECURITY INVOKER and calls truck_model internally, so the
-- signed-in caller needs EXECUTE on that one too — this restates the
-- live project's existing grant rather than trusting the PUBLIC default.
REVOKE ALL ON FUNCTION public.truck_model(TEXT)                         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fuel_model_stats(DATE, DATE, TEXT, TEXT)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.truck_model(TEXT)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_model_stats(DATE, DATE, TEXT, TEXT) TO authenticated;

-- A brand-new function, but PostgREST caches grants too, and 060 taught
-- us that skipping the reload is how the API sits a version behind.
NOTIFY pgrst, 'reload schema';