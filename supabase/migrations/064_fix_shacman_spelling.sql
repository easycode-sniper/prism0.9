-- ── SHACMAN, no k ─────────────────────────────────────────────────────
--
-- The model classification above is wrong on one letter: the function
-- travelled from the console migrations (2026-09-14) misspelled, and
-- 063 reproduced it spelling and all. The brand is SHACMAN (Shaanxi
-- Automobile Group). This migration is the correction that was actually
-- applied to the live database on 2026-09-15, so a fresh build from
-- these files converges on the same function the project runs.
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
    WHEN split_part(p_truck_id, '-', 2) IN ('519', '522', '525') THEN 'Shacman'
  END
$function$;

COMMENT ON FUNCTION public.truck_model(TEXT) IS
  'Classifies a plate into MAN / Renault / Shacman, NULL for staff and VH Service.';