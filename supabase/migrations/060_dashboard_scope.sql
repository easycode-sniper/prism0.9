-- ━─ Dashboard scope: one driver, or one truck ━────────────────────────
--
-- The dashboard could only ever answer "how is the fleet doing". This
-- adds p_driver / p_truck to the aggregates behind it so the same page
-- can answer it about one man or one vehicle.
--
-- FOUR FUNCTIONS CHANGE SIGNATURE. driver_variance_leaders and
-- truck_variance_leaders deliberately do NOT: they already return one
-- row per entity and the whole set is 92 drivers / 74 trucks, far under
-- any limit, so the page picks its row out of the list it already has.
-- Two fewer signatures to keep in step is worth more than the bytes.
--
-- ── The hard part: a driver's name is not one string ──────────────────
--
-- fuel_transactions.driver_name comes from the owner's fuel SHEET.
-- zone_visits.driver_name and dispatches.driver_name come from WIALON.
-- The two disagree — that is the whole reason lib/drivers/match.ts
-- exists and needs four widening passes. Scoping "the fleet" by one
-- literal name would silently return a driver's fuel and none of his
-- deliveries, which is worse than refusing.
--
-- norm_driver_name() below is match.ts's pass 1 and pass 2 in SQL:
-- strip accents, upper-case, drop everything that is not a letter, then
-- SORT THE TOKENS so "AMIR SMARA" and "SMARA AMIR" agree. It stops
-- there on purpose. The fuzzy passes (edit distance, containment) are
-- NOT reproduced: they exist to put a phone number on a card, where a
-- wrong guess is a wrong address, whereas here a wrong guess silently
-- attributes one man's fuel to another. Exact-after-normalising is the
-- line, and genuine misspellings in the sheet ("ZEKRAOUI Abdelkader" vs
-- "Zakraoui abdelkader") stay unmatched and visible — the same call
-- Rapport Voyages made, and a correction for the source sheet rather
-- than for SQL.

-- ── 0. Name normalisation ─────────────────────────────────────────────
-- IMMUTABLE so it can be used in an index later if this ever gets slow.
-- unaccent() is NOT used: it lives in an extension that may not be
-- installed, and translate() over the accents these names actually
-- carry is both dependency-free and obvious.
CREATE OR REPLACE FUNCTION public.norm_driver_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    ELSE (
      SELECT string_agg(tok, ' ' ORDER BY tok)
      FROM regexp_split_to_table(
        btrim(regexp_replace(
          -- ß FIRST, and not via translate(): JS's toUpperCase expands
          -- it to "SS" while Postgres upper() leaves it alone, and
          -- translate() maps one character to one character so it cannot
          -- do the expansion. Without this the two sides disagree on any
          -- name containing it.
          upper(translate(replace(replace(p_name, 'ß', 'ss'), 'ẞ', 'SS'),
            -- Latin-1, the accents these names actually carry...
            'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ'
            -- ...plus the Latin Extended-A letters that DECOMPOSE under
            -- NFD, because that is exactly what the TypeScript twin
            -- strips. The list is not arbitrary and must not be widened
            -- casually: ł, đ, ø, æ and œ have NO canonical
            -- decomposition, so JS leaves them and the [^A-Z] pass turns
            -- them into separators. Mapping any of those here would make
            -- the two implementations disagree, which is the one thing
            -- this function must never do. Dotless ı is the exception
            -- that proves it — it does not decompose either, but
            -- JS's toUpperCase sends it to 'I', so SQL must too.
            || 'ĂĀĄĆČĒĖĘĚĞĪĮİŃŇŌŐŘŚŠŢŤŪŮŰŲŹŽŻȘȚ'
            || 'ăāąćčēėęěğīįıńňōőřśšţťūůűųźžżșț',
            'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy'
            || 'AAACCEEEEGIIINNOORSSTTUUUUZZZST'
            || 'aaacceeeegiiinnoorssttuuuuzzzst')),
          '[^A-Z]+', ' ', 'g'
        )),
        ' '
      ) AS tok
      WHERE tok <> ''
    )
  END;
$function$;

COMMENT ON FUNCTION public.norm_driver_name(TEXT) IS
  'Driver name reduced for cross-source comparison: accents stripped, upper-cased, non-letters dropped, tokens sorted. Mirrors pass 1+2 of lib/drivers/match.ts. Deliberately NOT fuzzy.';

-- ── 1. The KPI strip ──────────────────────────────────────────────────
-- BOTH signatures dropped, and that is not belt-and-braces: dropping only
-- the old one makes this file fail on a second run with "already exists
-- with same argument types", because by then the function IS the new
-- shape. A migration that cannot be replayed is a migration that cannot
-- be trusted to rebuild the database. Same below.
DROP FUNCTION IF EXISTS public.fuel_period_stats(DATE, DATE);
DROP FUNCTION IF EXISTS public.fuel_period_stats(DATE, DATE, TEXT, TEXT);
CREATE FUNCTION public.fuel_period_stats(
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_driver TEXT DEFAULT NULL,
  p_truck  TEXT DEFAULT NULL
)
RETURNS TABLE (
  fills              BIGINT,
  km                 NUMERIC,
  litres             NUMERIC,
  amount_da          NUMERIC,
  litres_per_100km   NUMERIC,
  variance_da        NUMERIC,
  unpaired_fills     BIGINT,
  unpaired_litres    NUMERIC,
  unpaired_amount_da NUMERIC,
  first_raw          TEXT,
  last_raw           TEXT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH scoped AS (
    SELECT * FROM public.fuel_transactions f
    WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
      AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
      AND (p_driver IS NULL
           OR public.norm_driver_name(f.driver_name) = public.norm_driver_name(p_driver))
      AND (p_truck IS NULL OR f.truck_id = p_truck)
  )
  SELECT
    count(*)                                                        AS fills,
    COALESCE(sum(distance_km)  FILTER (WHERE variance_da IS NOT NULL), 0) AS km,
    COALESCE(sum(litres_filled), 0)                                 AS litres,
    COALESCE(sum(amount_da), 0)                                     AS amount_da,
    round(
      COALESCE(sum(litres_filled) FILTER (WHERE variance_da IS NOT NULL), 0) * 100
      / NULLIF(sum(distance_km)   FILTER (WHERE variance_da IS NOT NULL), 0), 2
    )                                                               AS litres_per_100km,
    COALESCE(sum(variance_da), 0)                                   AS variance_da,
    count(*)                    FILTER (WHERE variance_da IS NULL)  AS unpaired_fills,
    COALESCE(sum(litres_filled) FILTER (WHERE variance_da IS NULL), 0) AS unpaired_litres,
    COALESCE(sum(amount_da)     FILTER (WHERE variance_da IS NULL), 0) AS unpaired_amount_da,
    (SELECT occurred_raw FROM scoped
      WHERE sheet_row IS NOT NULL ORDER BY sheet_row ASC  LIMIT 1)   AS first_raw,
    (SELECT occurred_raw FROM scoped
      WHERE sheet_row IS NOT NULL ORDER BY sheet_row DESC LIMIT 1)   AS last_raw
  FROM scoped;
$function$;

-- ── 2. The daily series ───────────────────────────────────────────────
--
-- THE ONE REAL COMPROMISE ON THIS PAGE, and it is in the km column.
-- Fleet-wide, km comes from fleet_day_metrics, which pg_cron writes from
-- telemetry — real distance driven, per calendar day. That table has NO
-- per-truck breakdown, and it cannot be given one retroactively because
-- it derives from fleet_snapshots, which prunes after 7 days.
--
-- So when a scope is set, km switches source to the fuel sheet's own
-- distance_km: kilometres covered BETWEEN TWO FILLS, credited to the day
-- of the later fill. That is genuinely this truck's distance, but it is
-- not "distance driven on this day" — a truck that runs four days and
-- fills on the fourth puts four days of road on one column. The page
-- relabels the chart when scoped so nobody reads it as the fleet chart
-- with a filter applied. Owner's call, 2026-09-10.
--
-- Everything else scopes cleanly: litres, amount, consumption and
-- da_per_km are all fuel_transactions; deliveries are zone_visits, which
-- carries truck_id and a Wialon driver_name; alerts are notifications,
-- which carries truck_id and reaches a driver through dispatches.
DROP FUNCTION IF EXISTS public.dashboard_daily_series(DATE, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.dashboard_daily_series(DATE, DATE, INTEGER, TEXT, TEXT);
CREATE FUNCTION public.dashboard_daily_series(
  p_from        DATE DEFAULT NULL,
  p_to          DATE DEFAULT NULL,
  p_min_seconds INTEGER DEFAULT 1500,
  p_driver      TEXT DEFAULT NULL,
  p_truck       TEXT DEFAULT NULL
)
RETURNS TABLE (
  day          DATE,
  km           NUMERIC,
  litres       NUMERIC,
  consumption  NUMERIC,
  alerts       BIGINT,
  amount_da    NUMERIC,
  da_per_km    NUMERIC,
  deliveries   BIGINT,
  days_clamped BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH scope AS (
    SELECT
      public.norm_driver_name(p_driver) AS driver_key,
      p_truck                            AS truck_id,
      (p_driver IS NOT NULL OR p_truck IS NOT NULL) AS scoped
  ),
  data_start AS (
    SELECT LEAST(
      (SELECT (min(occurred_at) AT TIME ZONE 'Africa/Algiers')::date FROM public.fuel_transactions),
      (SELECT min(ops_day)                                          FROM public.fleet_day_metrics),
      (SELECT (min(created_at)  AT TIME ZONE 'Africa/Algiers')::date FROM public.notifications),
      (SELECT (min(entered_at)  AT TIME ZONE 'Africa/Algiers')::date FROM public.zone_visits)
    ) AS day
  ),
  asked AS (
    SELECT
      COALESCE(p_to, (now() AT TIME ZONE 'Africa/Algiers')::date) AS last_day,
      COALESCE(
        p_from,
        (SELECT day FROM data_start),
        (now() AT TIME ZONE 'Africa/Algiers')::date - 29
      ) AS first_day
  ),
  bounds AS (
    SELECT
      asked.last_day,
      GREATEST(asked.first_day, asked.last_day - 729) AS first_day,
      (asked.first_day < asked.last_day - 729)        AS clamped
    FROM asked
  ),
  days AS (
    SELECT generate_series(first_day, last_day, INTERVAL '1 day')::date AS day FROM bounds
  ),
  fuel AS (
    SELECT (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date AS day,
           sum(f.litres_filled)                                          AS litres,
           sum(f.litres_filled) FILTER (WHERE f.variance_da IS NOT NULL) AS paired_litres,
           sum(f.distance_km)   FILTER (WHERE f.variance_da IS NOT NULL) AS paired_km,
           sum(f.amount_da)                                              AS amount_da,
           sum(f.amount_da)     FILTER (WHERE f.variance_da IS NOT NULL) AS paired_amount_da
    FROM public.fuel_transactions f, bounds, scope
    WHERE (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(f.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR f.truck_id = scope.truck_id)
    GROUP BY 1
  ),
  -- A notification reaches a driver only through its dispatch, the same
  -- join driver_speeding_leaders uses. A truck it carries directly.
  alert AS (
    SELECT (n.created_at AT TIME ZONE 'Africa/Algiers')::date AS day, count(*) AS alerts
    FROM public.notifications n
    LEFT JOIN public.dispatches d ON d.id = n.dispatch_id
    CROSS JOIN bounds
    CROSS JOIN scope
    WHERE (n.created_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(d.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR n.truck_id = scope.truck_id)
    GROUP BY 1
  ),
  site_start AS (
    SELECT MIN((entered_at AT TIME ZONE 'Africa/Algiers')::date) AS first_day
    FROM public.zone_visits WHERE zone_kind = 'site'
  ),
  delivery AS (
    SELECT (z.entered_at AT TIME ZONE 'Africa/Algiers')::date AS day, count(*) AS deliveries
    FROM public.zone_visits z, bounds, scope
    WHERE z.zone_kind = 'site'
      AND (z.entered_at AT TIME ZONE 'Africa/Algiers')::date BETWEEN bounds.first_day AND bounds.last_day
      AND EXTRACT(EPOCH FROM (COALESCE(z.exited_at, NOW()) - z.entered_at)) >= p_min_seconds
      AND (scope.driver_key IS NULL
           OR public.norm_driver_name(z.driver_name) = scope.driver_key)
      AND (scope.truck_id IS NULL OR z.truck_id = scope.truck_id)
    GROUP BY 1
  )
  SELECT
    days.day,
    -- Fleet-wide: telemetry, and NOT COALESCEd (048 — a missing row means
    -- never recorded, which is not zero). Scoped: the sheet's distance
    -- between fills, which is null on a day with no qualifying fill for
    -- the same reason.
    CASE WHEN scope.scoped THEN fuel.paired_km ELSE m.km END                   AS km,
    COALESCE(fuel.litres, 0)                                                   AS litres,
    round(fuel.paired_litres * 100 / NULLIF(fuel.paired_km, 0), 2)             AS consumption,
    COALESCE(alert.alerts, 0)                                                  AS alerts,
    COALESCE(fuel.amount_da, 0)                                                AS amount_da,
    round(fuel.paired_amount_da / NULLIF(fuel.paired_km, 0), 2)                AS da_per_km,
    CASE WHEN site_start.first_day IS NOT NULL AND days.day >= site_start.first_day
         THEN COALESCE(delivery.deliveries, 0)
    END                                                                        AS deliveries,
    bounds.clamped                                                             AS days_clamped
  FROM days
  CROSS JOIN site_start
  CROSS JOIN bounds
  CROSS JOIN scope
  LEFT JOIN public.fleet_day_metrics m ON m.ops_day = days.day
  LEFT JOIN fuel     ON fuel.day     = days.day
  LEFT JOIN alert    ON alert.day    = days.day
  LEFT JOIN delivery ON delivery.day = days.day
  ORDER BY days.day;
$function$;

-- ── 3. Speeding leaders ───────────────────────────────────────────────
-- Scoped it still returns a list, of one row: the page draws the same
-- panel either way rather than growing a second layout.
DROP FUNCTION IF EXISTS public.driver_speeding_leaders(INT, DATE, DATE);
DROP FUNCTION IF EXISTS public.driver_speeding_leaders(INT, DATE, DATE, TEXT, TEXT);
CREATE FUNCTION public.driver_speeding_leaders(
  p_limit  INT  DEFAULT 100,
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_driver TEXT DEFAULT NULL,
  p_truck  TEXT DEFAULT NULL
)
RETURNS TABLE (
  driver_name TEXT,
  truck_count BIGINT,
  trucks      TEXT,
  times       BIGINT,
  last_at     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    COALESCE(d.driver_name, '(' || n.truck_id || ')')          AS driver_name,
    count(DISTINCT n.truck_id)                                 AS truck_count,
    string_agg(DISTINCT n.truck_id, ', ' ORDER BY n.truck_id)  AS trucks,
    count(*)                                                   AS times,
    max(n.created_at)                                          AS last_at
  FROM public.notifications n
  LEFT JOIN public.dispatches d    ON d.id = n.dispatch_id
  LEFT JOIN public.fleet_trucks ft ON ft.truck_id = n.truck_id
  WHERE n.kind = 'speeding'
    AND COALESCE(ft.category, 'truck') IS DISTINCT FROM 'staff'
    AND (p_from IS NULL OR (n.created_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
    AND (p_to   IS NULL OR (n.created_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
    AND (p_driver IS NULL
         OR public.norm_driver_name(d.driver_name) = public.norm_driver_name(p_driver))
    AND (p_truck IS NULL OR n.truck_id = p_truck)
  GROUP BY COALESCE(d.driver_name, '(' || n.truck_id || ')')
  ORDER BY count(*) DESC, max(n.created_at) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$function$;

-- ── 4. Where we fill up ───────────────────────────────────────────────
-- Scoped, this stops being "where the fleet fills up" and becomes "where
-- this truck fills up", which is a more useful question than it sounds:
-- a truck that fills somewhere the rest of the fleet never uses is the
-- shape a blacklisted-station problem takes.
--
-- Note it keeps CREATE OR REPLACE's sibling DROP for the same
-- replayability reason as the others — 055 used CREATE OR REPLACE and
-- got away with it only because it never changed the signature.
DROP FUNCTION IF EXISTS public.fuel_station_leaders(DATE, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.fuel_station_leaders(DATE, DATE, INTEGER, TEXT, TEXT);
CREATE FUNCTION public.fuel_station_leaders(
  p_from   DATE DEFAULT NULL,
  p_to     DATE DEFAULT NULL,
  p_limit  INTEGER DEFAULT 6,
  p_driver TEXT DEFAULT NULL,
  p_truck  TEXT DEFAULT NULL
)
RETURNS TABLE (
  station        TEXT,
  fills          BIGINT,
  amount_da      NUMERIC,
  litres         NUMERIC,
  rank           BIGINT,
  total_fills    BIGINT,
  total_amount   NUMERIC,
  total_stations BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH inwindow AS (
    SELECT f.station, f.amount_da, f.litres_filled
    FROM public.fuel_transactions f
    WHERE (p_from IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date >= p_from)
      AND (p_to   IS NULL OR (f.occurred_at AT TIME ZONE 'Africa/Algiers')::date <= p_to)
      AND f.station IS NOT NULL
      AND btrim(f.station) <> ''
      AND (p_driver IS NULL
           OR public.norm_driver_name(f.driver_name) = public.norm_driver_name(p_driver))
      AND (p_truck IS NULL OR f.truck_id = p_truck)
  ),
  per_station AS (
    SELECT i.station,
           COUNT(*)::BIGINT                  AS fills,
           COALESCE(SUM(i.amount_da), 0)     AS amount_da,
           COALESCE(SUM(i.litres_filled), 0) AS litres
    FROM inwindow i
    GROUP BY i.station
  ),
  totals AS (
    SELECT COALESCE(SUM(fills), 0)::BIGINT AS total_fills,
           COALESCE(SUM(amount_da), 0)     AS total_amount,
           COUNT(*)::BIGINT                AS total_stations
    FROM per_station
  )
  SELECT p.station, p.fills, p.amount_da, p.litres,
         ROW_NUMBER() OVER (ORDER BY p.fills DESC, p.station)::BIGINT AS rank,
         t.total_fills, t.total_amount, t.total_stations
  FROM per_station p, totals t
  ORDER BY p.fills DESC, p.station
  LIMIT GREATEST(p_limit, 1);
$function$;

GRANT EXECUTE ON FUNCTION public.norm_driver_name(TEXT)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_station_leaders(DATE, DATE, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_period_stats(DATE, DATE, TEXT, TEXT)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(DATE, DATE, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_speeding_leaders(INT, DATE, DATE, TEXT, TEXT) TO authenticated;

-- ── 5. The roster behind the search box ───────────────────────────────
--
-- Who can be searched for. Deliberately UNION-ed from the sources the
-- dashboard actually aggregates rather than from Wialon: a name that
-- appears in no fuel row and no zone visit would select a scope with
-- nothing behind it, and an empty dashboard reads as a broken filter.
--
-- fills / visits are returned so the picker can show what is behind a
-- name before it is chosen, and so a driver the sheet spells one way and
-- the tracker another is visibly two entries rather than mysteriously
-- half-empty.
DROP FUNCTION IF EXISTS public.dashboard_scope_options();
CREATE FUNCTION public.dashboard_scope_options()
RETURNS TABLE (
  kind       TEXT,
  id         TEXT,
  label      TEXT,
  fills      BIGINT,
  visits     BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH drivers AS (
    SELECT public.norm_driver_name(driver_name) AS key,
           -- The spelling shown is the most common one, so the picker
           -- offers the name as it is usually written rather than
           -- whichever row sorted first.
           mode() WITHIN GROUP (ORDER BY driver_name) AS label,
           count(*) AS fills
    FROM public.fuel_transactions
    WHERE driver_name IS NOT NULL AND public.norm_driver_name(driver_name) <> ''
    GROUP BY 1
  ),
  driver_visits AS (
    SELECT public.norm_driver_name(driver_name) AS key,
           -- The tracker's own most common spelling, for the same reason
           -- the sheet's is taken above: a driver who has never appeared
           -- in the fuel sheet must still be offered under a name a
           -- person recognises. Falling back to the normalised key here
           -- printed "ABDELKADER ZEKRAOUI" — token-sorted and shouting,
           -- which is a machine's spelling of a man's name.
           mode() WITHIN GROUP (ORDER BY driver_name) AS label,
           count(*) AS visits
    FROM public.zone_visits
    WHERE driver_name IS NOT NULL AND public.norm_driver_name(driver_name) <> ''
    GROUP BY 1
  ),
  driver_rows AS (
    -- The sheet's spelling leads where there is one, because that is the
    -- side the money is on and the side the owner types from.
    SELECT
      'driver'::TEXT AS kind,
      COALESCE(d.label, z.label)                     AS id,
      COALESCE(d.label, z.label)                     AS label,
      COALESCE(d.fills, 0)                           AS fills,
      COALESCE(z.visits, 0)                          AS visits
    FROM drivers d
    FULL OUTER JOIN driver_visits z ON z.key = d.key
  ),
  truck_rows AS (
    SELECT
      'truck'::TEXT AS kind,
      t.truck_id    AS id,
      t.truck_id    AS label,
      COALESCE((SELECT count(*) FROM public.fuel_transactions f WHERE f.truck_id = t.truck_id), 0) AS fills,
      COALESCE((SELECT count(*) FROM public.zone_visits z WHERE z.truck_id = t.truck_id), 0)       AS visits
    FROM (
      SELECT DISTINCT truck_id FROM public.fuel_transactions WHERE truck_id IS NOT NULL
      UNION
      SELECT DISTINCT truck_id FROM public.zone_visits       WHERE truck_id IS NOT NULL
    ) t
  )
  SELECT * FROM driver_rows
  UNION ALL
  SELECT * FROM truck_rows
  ORDER BY kind, label;
$function$;

GRANT EXECUTE ON FUNCTION public.dashboard_scope_options() TO authenticated;

-- ── Tell PostgREST the signatures changed ─────────────────────────────
--
-- NOT optional. PostgREST matches an RPC request to a function by its
-- ARGUMENT NAMES from a CACHED schema, and three signatures just moved.
-- Skipping this is exactly the 2026-09-02 outage: correct SQL, correct
-- functions, and a dashboard sitting on its loading skeletons because
-- the API in front of it was a version behind. apply_migration issues
-- the reload itself; a plain SQL console does not.
NOTIFY pgrst, 'reload schema';
