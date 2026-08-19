"use server";

import { createClient } from "@/lib/supabase/server";
import { opsToday } from "@/lib/format";

// The four dashboard headline figures for the current operations day.
//
// Distance is NOT computed here. Reconstructing it from a day of
// snapshots costs about a second and spills to disk (see migration 019),
// which is fine on a five-minute schedule and unacceptable on a page that
// polls. pg_cron writes it to fleet_day_metrics; this reads one row.

/** Litres per 100 km assumed when app_config has no 'fuel' entry. A
 *  loaded semi on this route runs roughly 35–45; the handful of staff
 *  cars pull the fleet average down slightly. Tune the stored value
 *  against a Wialon fuel report rather than editing this constant. */
const DEFAULT_LITRES_PER_100KM = 38;

export interface DayStats {
  /** Kilometres driven by the whole fleet today, staff cars included. */
  km: number;
  /** Litres, derived from km. Estimated, not metered — see fuelEstimated. */
  litres: number;
  fuelEstimated: true;
  litresPer100km: number;
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

  const [metrics, dispatches, entries, fuelCfg] = await Promise.all([
    supabase
      .from("fleet_day_metrics")
      .select("km, vehicles_moved, computed_at")
      .eq("ops_day", today)
      .maybeSingle(),
    supabase
      .from("dispatches")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("hq_entries")
      .select("id", { count: "exact", head: true })
      .gte("entered_at", `${today}T00:00:00+01:00`)
      .lt("entered_at", `${today}T23:59:59.999+01:00`),
    supabase
      .from("app_config")
      .select("config_value")
      .eq("config_key", "fuel")
      .maybeSingle(),
  ]);

  const rateRaw = (fuelCfg.data?.config_value as { litres_per_100km?: number } | undefined)
    ?.litres_per_100km;
  const rate = typeof rateRaw === "number" && rateRaw > 0 ? rateRaw : DEFAULT_LITRES_PER_100KM;

  // No row yet means the schedule has not run since midnight, which is a
  // real zero for the first few minutes of a day rather than an error.
  const km = Number(metrics.data?.km ?? 0);

  return {
    stats: {
      km,
      litres: Math.round((km * rate) / 100),
      fuelEstimated: true,
      litresPer100km: rate,
      activeDispatches: dispatches.count ?? 0,
      parcEntries: entries.count ?? 0,
      vehiclesMoved: metrics.data?.vehicles_moved ?? 0,
      computedAt: (metrics.data?.computed_at as string | undefined) ?? null,
    },
  };
}
