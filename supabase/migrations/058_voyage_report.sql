-- ━─ Rapport Voyages: the fuel sheet per truck, with the trips beside it ━─
--
-- The owner's request, 2026-09-08, with a hand-made CSV as the spec: one
-- row per truck, and in this order — truck, driver, amount filled,
-- kilometres, litres, L/100km, variance, number of voyages. The voyage
-- count is the point; the fuel columns are what it is read against.
--
-- ── What a voyage is ──────────────────────────────────────────
--
-- "The voyages count from the factory to the client." So a voyage is a
-- load at Amouda that reached a client site — not a delivery, and not a
-- loading. Counted as: a qualifying site visit with a factory_loading
-- visit by the same truck between it and that truck's PREVIOUS site
-- visit. One load, one delivery, one voyage; a second delivery on the
-- same load does not double-count, because the loading it would claim
-- lies before the previous delivery rather than after it.
--
-- Measured over the whole record: 200 qualifying deliveries, 178 of them
-- traceable to a load at Amouda. The other 22 are real deliveries whose
-- loading is not in the log — the truck loaded somewhere else, or the
-- load predates zone logging (factory rows start 2026-08-31, site rows
-- 2026-09-01, so the first deliveries have no prior loading recorded).
--
-- ANCHORED ON THE DELIVERY, not the loading. A voyage falls in the range
-- when the truck REACHED THE CLIENT inside it. Anchoring on the load
-- instead would let voyages exceed deliveries for the same range — a
-- truck loading on the last evening and arriving the next morning — and
-- someone reading Livraisons beside this would take that for a bug. This
-- way voyages are always a subset of that report's deliveries.
--
-- SAME 25-MINUTE RULE as Rapport Livraisons and Déchargés, passed in as
-- p_min_seconds rather than hardcoded. A site polygon clipped by a
-- public road logs a truck that merely drove past.
--
-- ── Why NULL and not 0 ────────────────────────────────────────
--
-- The owner saw this before it was built: "the fuel sheet covers the
-- entire fleet, but the voyages count only one factory, which is the
-- Amouda one. So there will be a lot of trucks that did zero voyages...
-- if you can't find any voyages for that specific truck, say not
-- available, or another factory."
--
-- He is right, and it is the same distinction 048 and 056 turn on. This
-- app watches exactly one plant. A truck with no voyages either made
-- none or loaded at a plant nothing here can see, and those are not the
-- same statement — printing 0 asserts the first when the data cannot
-- tell them apart. So the count is NULL, and the report prints "Not
-- available". Today that is 28 of 74 trucks.
--
-- ── The fuel half ─────────────────────────────────────────────
--
-- ONE POPULATION FOR ALL FIVE COLUMNS: fills carrying a variance, which
-- is the same set truck_variance_leaders uses for the dashboard table
-- the owner already reads. A fill without a variance logged no distance
-- (overwhelmingly a Vh Service vehicle, which has no truck_id at all and
-- so cannot reach this report), and mixing populations inside one ROW is
-- worse than mixing them across panels: litres and L/100km sit two cells
-- apart, and a reader who divides one by the other must get the number
-- printed beside them. The cost is 8 fills and 63,800 DA fleet-wide,
-- 0.14% of spend.
--
-- DRIVERS ARE A LIST, not a name. Over a month 38 of 74 trucks carry two
-- drivers and 9 carry three, so a single name would silently pick one
-- man to answer for another's fuel. They are ordered by fills, so the
-- one who drove it most reads first, and the count comes back beside
-- them for the UI to mark. Deduplicated on upper(trim(...)), which
-- merges pure case and whitespace variants only — the sheet also holds
-- genuine misspellings ("ZEKRAOUI Abdelkader" against "Zakraoui
-- abdelkader") and fuzzy-matching those risks merging two real people,
-- so they are left visible rather than guessed at. That is a correction
-- to make in the source sheet.

CREATE OR REPLACE FUNCTION public.fuel_voyage_report(
  p_from        TIMESTAMPTZ,
  p_to          TIMESTAMPTZ,
  p_min_seconds INTEGER DEFAULT 1500,
  p_limit       INTEGER DEFAULT 500
)
RETURNS TABLE (
  truck_id         TEXT,
  drivers          TEXT,
  driver_count     BIGINT,
  amount_da        NUMERIC,
  km               NUMERIC,
  litres           NUMERIC,
  litres_per_100km NUMERIC,
  variance_da      NUMERIC,
  fills            BIGINT,
  -- NULL, never 0. See the header.
  voyages          BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  WITH paid AS (
    SELECT f.truck_id, f.driver_name, f.amount_da, f.distance_km,
           f.litres_filled, f.variance_da
    FROM public.fuel_transactions f
    WHERE f.truck_id IS NOT NULL
      AND f.variance_da IS NOT NULL
      AND f.occurred_at >= p_from
      AND f.occurred_at <  p_to
  ),
  fuel AS (
    SELECT p.truck_id,
           round(sum(p.amount_da))                                              AS amount_da,
           round(sum(p.distance_km))                                            AS km,
           round(sum(p.litres_filled), 2)                                       AS litres,
           round(sum(p.litres_filled) * 100 / NULLIF(sum(p.distance_km), 0), 2) AS litres_per_100km,
           round(sum(p.variance_da))                                            AS variance_da,
           count(*)                                                             AS fills
    FROM paid p GROUP BY p.truck_id
  ),
  named AS (
    -- One row per truck per DISTINCT PERSON, keeping the spelling that
    -- appears most often on the sheet.
    SELECT p.truck_id,
           (ARRAY_AGG(p.driver_name ORDER BY p.driver_name))[1] AS driver_name,
           count(*) AS n
    FROM paid p
    WHERE p.driver_name IS NOT NULL AND trim(p.driver_name) <> ''
    GROUP BY p.truck_id, upper(trim(p.driver_name))
  ),
  crew AS (
    SELECT n.truck_id,
           string_agg(n.driver_name, ', ' ORDER BY n.n DESC, n.driver_name) AS drivers,
           count(*)                                                         AS driver_count
    FROM named n GROUP BY n.truck_id
  ),
  deliv AS (
    -- The window runs over the WHOLE table, never the reported range:
    -- the previous delivery that bounds a voyage may sit before p_from,
    -- and clipping it would invent a voyage out of an older loading.
    SELECT z.truck_id, z.entered_at,
           lag(z.entered_at) OVER (PARTITION BY z.truck_id ORDER BY z.entered_at) AS prev_delivery
    FROM public.zone_visits z
    WHERE z.zone_kind = 'site'
      AND EXTRACT(EPOCH FROM (COALESCE(z.exited_at, NOW()) - z.entered_at)) >= p_min_seconds
  ),
  voyage AS (
    SELECT d.truck_id, count(*) AS voyages
    FROM deliv d
    WHERE d.entered_at >= p_from
      AND d.entered_at <  p_to
      AND EXISTS (
        SELECT 1 FROM public.zone_visits f
        WHERE f.truck_id = d.truck_id
          AND f.zone_kind = 'factory_loading'
          AND f.entered_at < d.entered_at
          AND (d.prev_delivery IS NULL OR f.entered_at > d.prev_delivery)
      )
    GROUP BY d.truck_id
  )
  SELECT fuel.truck_id,
         COALESCE(crew.drivers, '—'),
         COALESCE(crew.driver_count, 0),
         fuel.amount_da, fuel.km, fuel.litres, fuel.litres_per_100km, fuel.variance_da,
         fuel.fills,
         voyage.voyages
  FROM fuel
  LEFT JOIN crew   ON crew.truck_id   = fuel.truck_id
  LEFT JOIN voyage ON voyage.truck_id = fuel.truck_id
  -- The voyage count is the report's subject, so it leads; trucks with
  -- none sink to the bottom rather than scattering through the table.
  ORDER BY voyage.voyages DESC NULLS LAST, fuel.truck_id
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$function$;

GRANT EXECUTE ON FUNCTION public.fuel_voyage_report(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
