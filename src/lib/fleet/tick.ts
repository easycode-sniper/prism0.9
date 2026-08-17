// One cycle of fleet monitoring, run server-side on a schedule.
//
// This is the work FleetProvider used to do in every operator's browser,
// every 60s, per open tab: fetch the fleet from Wialon, snapshot it, and
// check each active dispatch plus HQ arrivals. Doing it in the client
// meant nothing was monitored while the app was closed, and N tabs meant
// N Wialon logins and N racing generations of the same writes.
//
// Runs with the service role, so RLS write policies don't apply.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWialonConfig, fetchFleetData, type FleetTruck, type VehicleCategory } from "@/lib/fleet/wialon";
import { loadGeofences } from "@/lib/fleet/geofences";
import { loadDispatchAndSite, runPositionCheck, runHqArrivalCheck } from "@/lib/fleet/positionCheck";

export interface TickResult {
  ok: boolean;
  trucks: number;
  dispatchesChecked: number;
  durationMs: number;
  error: string | null;
  warnings: string[];
}

export async function runFleetTick(supabase: SupabaseClient): Promise<TickResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];

  // Resolved with the tick's own (service-role) client. Reading it via
  // the session-scoped helper returns nothing here — there is no session
  // — and surfaces as "Wialon is not configured" on a project where it
  // is configured perfectly well.
  const config = await loadWialonConfig(supabase);
  if (!config) {
    return {
      ok: false,
      trucks: 0,
      dispatchesChecked: 0,
      durationMs: Date.now() - startedAt,
      error: "Wialon is not configured — set the API token in Admin → Settings.",
      warnings,
    };
  }

  const fleet = await fetchFleetData(config);
  if (fleet.error) {
    return {
      ok: false,
      trucks: 0,
      dispatchesChecked: 0,
      durationMs: Date.now() - startedAt,
      error: fleet.error,
      warnings,
    };
  }

  // Staff cars are tracked and mapped like everything else, but they
  // shuttle in and out of HQ all day and their arrivals aren't
  // actionable — they buried the real ones. Classification is per
  // vehicle in fleet_trucks, not a rule about ID shape: one real cargo
  // truck (00031-115-35) sits inside the staff-looking ID range, and
  // muting a real truck by accident is the failure nobody notices.
  const { data: categoryRows, error: categoryError } = await supabase
    .from("fleet_trucks")
    .select("truck_id, category");
  if (categoryError) warnings.push(`categories: ${categoryError.message}`);

  const categoryOf = new Map<string, VehicleCategory>(
    (categoryRows ?? []).map((r) => [r.truck_id as string, (r.category ?? "truck") as VehicleCategory])
  );

  // Stamped onto the snapshot so the browser can label them without a
  // second query, and so a snapshot records how a unit was classified
  // at the time it was taken.
  const trucks: FleetTruck[] = fleet.trucks.map((t) => ({
    ...t,
    category: categoryOf.get(t.truck_id) ?? "truck",
  }));
  const cargoTrucks = trucks.filter((t) => t.category !== "staff");

  // The snapshot doubles as this job's heartbeat — pg_net is
  // fire-and-forget and won't report a failed tick, so a gap in
  // fleet_snapshots is the signal that the schedule has stopped.
  // It's also what the browser now reads its truck positions from.
  const { error: snapshotError } = await supabase.from("fleet_snapshots").insert({
    snapshot_data: trucks,
    truck_count: trucks.length,
    moving_count: trucks.filter((t: FleetTruck) => t.status === "moving").length,
    idle_count: trucks.filter((t: FleetTruck) => t.status === "idle").length,
    offline_count: trucks.filter((t: FleetTruck) => t.status === "offline").length,
    captured_at: new Date().toISOString(),
  });
  if (snapshotError) warnings.push(`snapshot: ${snapshotError.message}`);

  const [{ data: geofences, error: geofenceError }, { data: dispatches, error: dispatchError }] =
    await Promise.all([
      loadGeofences(supabase),
      supabase.from("dispatches").select("id, truck_id").eq("status", "active"),
    ]);

  if (geofenceError) warnings.push(`geofences: ${geofenceError}`);
  if (dispatchError) warnings.push(`dispatches: ${dispatchError.message}`);

  const truckById = new Map(trucks.map((t) => [t.truck_id, t]));
  const active = (dispatches ?? []) as { id: string; truck_id: string }[];

  // Sequential rather than Promise.all: a tick runs inside one
  // serverless invocation with a hard duration cap, and a burst of
  // parallel Wialon/Postgres work is what makes an invocation spike.
  // Each check is a handful of same-region queries, so serial is
  // comfortably fast and far more predictable.
  let checked = 0;
  for (const dispatch of active) {
    const truck = truckById.get(dispatch.truck_id);
    if (truck?.lat == null || truck.lng == null) continue;

    try {
      const loaded = await loadDispatchAndSite(supabase, dispatch.id);
      if ("error" in loaded) {
        warnings.push(`dispatch ${dispatch.truck_id}: ${loaded.error}`);
        continue;
      }
      await runPositionCheck(
        supabase,
        loaded.dispatch,
        loaded.site,
        [truck.lat, truck.lng],
        truck.speed,
        truck.driverName,
        geofences
      );
      checked++;
    } catch (err) {
      warnings.push(`dispatch ${dispatch.truck_id}: ${(err as Error).message}`);
    }
  }

  // HQ is the one 'site' geofence with no site_id — a real customer site
  // always has one. Same rule the dashboard's location split uses.
  const hq = geofences.find((g) => g.kind === "site" && g.siteId == null);
  if (hq?.centerLat != null && hq?.centerLng != null && hq?.radiusMeters != null) {
    try {
      await runHqArrivalCheck(supabase, cargoTrucks, {
        centerLat: hq.centerLat,
        centerLng: hq.centerLng,
        radiusMeters: hq.radiusMeters,
      });
    } catch (err) {
      warnings.push(`hq: ${(err as Error).message}`);
    }
  }

  return {
    ok: true,
    trucks: trucks.length,
    dispatchesChecked: checked,
    durationMs: Date.now() - startedAt,
    error: null,
    warnings,
  };
}
