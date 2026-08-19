"use server";

import { createClient } from "@/lib/supabase/server";
import { opsToday } from "@/lib/format";

// The four dashboard headline figures for the current operations day.
//
// Distance is NOT computed here. Reconstructing it from a day of
// snapshots costs about a second and spills to disk (see migration 019),
// which is fine on a five-minute schedule and unacceptable on a page that
// polls. pg_cron writes it to fleet_day_metrics; this reads one row.

// Fuel is not metered on this fleet. Wialon derives it from a per-unit
// consumption rate the office configured, and this derives it the same
// way — same arithmetic, same rates — so the two figures reconcile rather
// than merely resembling each other.
//
// Rates live in app_config under 'fuel' so they can be corrected without
// a deploy, and are per category because a semi and a staff car differ by
// a factor of four or five. Both shapes are accepted:
//
//   {"litres_per_100km": 38}                        one rate for everything
//   {"litres_per_100km": {"truck": 38, "staff": 8}} per category
//
// This is now only the FALLBACK for a day with no synced pump
// transactions yet — see fuel_transactions below, which is measured, not
// estimated, and wins whenever it has rows for today. The truck default
// matches ASSUMED_L_PER_100KM in lib/fuel/parse.ts (45), which is the
// same assumption the connected sheet's own formulas use, so a day that
// switches from the estimate to real data mid-scroll doesn't jump for a
// reason nobody can see.
const DEFAULT_RATES = { truck: 45, staff: 8 };

type RateConfig = number | { truck?: number; staff?: number } | undefined;

function resolveRates(raw: RateConfig): { truck: number; staff: number } {
  const ok = (n: unknown): n is number => typeof n === "number" && n > 0;
  if (ok(raw)) return { truck: raw, staff: raw };
  if (raw && typeof raw === "object") {
    return {
      truck: ok(raw.truck) ? raw.truck : DEFAULT_RATES.truck,
      staff: ok(raw.staff) ? raw.staff : DEFAULT_RATES.staff,
    };
  }
  return DEFAULT_RATES;
}

export interface DayStats {
  /** Kilometres driven by the whole fleet today, staff cars included. */
  km: number;
  /** Litres. Real (summed from today's pump transactions) whenever any
   *  exist; otherwise derived from km at the configured rates. */
  litres: number;
  fuelEstimated: boolean;
  /** Only meaningful when fuelEstimated is true. */
  rates: { truck: number; staff: number };
  activeDispatches: number;
  parcEntries: number;
  vehiclesMoved: number;
  /** When pg_cron last recomputed the distance, so the page can admit to
   *  being up to five minutes stale rather than implying live figures. */
  computedAt: string | null;
}

export async function getDayStats(): Promise<{ stats?: DayStats; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  const today = opsToday();

  const dayStart = `${today}T00:00:00+01:00`;
  const dayEnd = `${today}T23:59:59.999+01:00`;

  const [metrics, dispatches, entries, fuelCfg, fuelToday] = await Promise.all([
    supabase
      .from("fleet_day_metrics")
      .select("km, km_truck, km_staff, vehicles_moved, computed_at")
      .eq("ops_day", today)
      .maybeSingle(),
    supabase
      .from("dispatches")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("hq_entries")
      .select("id", { count: "exact", head: true })
      .gte("entered_at", dayStart)
      .lt("entered_at", dayEnd),
    supabase
      .from("app_config")
      .select("config_value")
      .eq("config_key", "fuel")
      .maybeSingle(),
    // Real pump transactions win over the estimate whenever today has
    // any. litres_filled is null on a first-ever fill's row shape only
    // in fleet_day_metrics-style derived data — here it is null only
    // when a transaction genuinely recorded no litres, which the sum
    // correctly ignores.
    supabase
      .from("fuel_transactions")
      .select("litres_filled")
      .gte("occurred_at", dayStart)
      .lt("occurred_at", dayEnd),
  ]);

  const rates = resolveRates(
    (fuelCfg.data?.config_value as { litres_per_100km?: RateConfig } | undefined)?.litres_per_100km
  );

  // No row yet means the schedule has not run since midnight, which is a
  // real zero for the first few minutes of a day rather than an error.
  const km = Number(metrics.data?.km ?? 0);
  const kmTruck = Number(metrics.data?.km_truck ?? 0);
  const kmStaff = Number(metrics.data?.km_staff ?? 0);

  // Distance from a snapshot written before categories existed is in `km`
  // but neither column; charge it at the truck rate, which is what those
  // vehicles overwhelmingly were.
  const kmUncategorised = Math.max(0, km - kmTruck - kmStaff);

  const meteredLitres = (fuelToday.data ?? []).reduce(
    (sum, r) => sum + (Number(r.litres_filled) || 0),
    0
  );
  const hasMeteredData = (fuelToday.data?.length ?? 0) > 0;

  const litres = hasMeteredData
    ? meteredLitres
    : ((kmTruck + kmUncategorised) * rates.truck + kmStaff * rates.staff) / 100;

  return {
    stats: {
      km,
      litres: Math.round(litres),
      fuelEstimated: !hasMeteredData,
      rates,
      activeDispatches: dispatches.count ?? 0,
      parcEntries: entries.count ?? 0,
      vehiclesMoved: metrics.data?.vehicles_moved ?? 0,
      computedAt: (metrics.data?.computed_at as string | undefined) ?? null,
    },
  };
}
