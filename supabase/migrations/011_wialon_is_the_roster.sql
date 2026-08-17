-- ━─ Drop the fleet_trucks foreign key on dispatches ━──────
-- dispatches.truck_id used to point at the seeded fleet_trucks
-- registry. Since Wialon became the roster, truck_id is the raw
-- Wialon unit name — and those names don't all match the seeded
-- IDs (the old matchTrucksToUnits had to strip leading zeros and
-- split on "-" precisely because they differ). Measured against
-- production: of 42 distinct Wialon truck names seen so far, 9
-- have no fleet_trucks row, so dispatching any of them failed
-- with a foreign-key violation.
--
-- fleet_trucks is no longer a registry — it only carries the
-- per-truck at_hq flag now — so there is nothing left for this
-- constraint to protect.

ALTER TABLE public.dispatches
  DROP CONSTRAINT IF EXISTS fk_dispatch_truck;
