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
import { loadGeofences, selectFactoryGeofence, selectLoadingGeofence } from "@/lib/fleet/geofences";
import {
  loadDispatchAndSite,
  runPositionCheck,
  runHqArrivalCheck,
  runFactoryArrivalCheck,
  runFactoryLoadingCheck,
  runFleetSpeedingCheck,
  runBlacklistedStationCheck,
} from "@/lib/fleet/positionCheck";

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
  // vehicle in fleet_trucks, never a rule about ID shape, because the ID
  // range does not reliably say which is which and muting a real truck
  // by accident is the failure nobody notices.
  //
  // This comment used to cite 00031-115-35 as a cargo truck inside the
  // staff-looking range. It is NOT one: the owner reclassified it on
  // 2026-08-27, and the data agreed — zero dispatches and zero fuel
  // transactions in the whole sheet, which no working cargo truck has.
  // It is now category 'staff'. Left recorded here so the example is not
  // reinstated from the old note.
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
  } else {
    // Previously this fell through in silence. A missing or malformed HQ
    // geofence would disable parc tracking entirely while the tick kept
    // reporting ok with no warnings — the same invisibility that hid the
    // 28-hour outage.
    warnings.push("hq: no usable site geofence (needs centre and radius); parc arrivals not checked");
  }

  // Factory arrival runs fleet-wide, not per dispatch. Reaching the
  // factory to load is what prompts a dispatch to be created, so it
  // cannot be conditional on one already existing — which is exactly why
  // the dispatch-scoped version inside runPositionCheck had produced a
  // single notification in the app's lifetime.
  //
  // Which factory geofence, specifically, is not a detail — the plant
  // has a waiting area and a loading bay and only the first one means
  // "arrived". See selectFactoryGeofence.
  const { factory, warning: factoryWarning } = selectFactoryGeofence(geofences);
  if (factoryWarning) warnings.push(`factory: ${factoryWarning}`);
  if (factory) {
    try {
      await runFactoryArrivalCheck(supabase, cargoTrucks, {
        name: factory.name,
        ring: factory.ring,
        centerLat: factory.centerLat,
        centerLng: factory.centerLng,
        radiusMeters: factory.radiusMeters,
      });
    } catch (err) {
      warnings.push(`factory: ${(err as Error).message}`);
    }
  } else {
    warnings.push("factory: no factory geofence found; factory arrivals not checked");
  }

  // The loading bay, inside the waiting area. Raises no alert — it
  // writes the zone_visits rows the factory report reads, so queue time
  // and loading time are measurable per truck per day. Runs after the
  // waiting-area check so that on the tick a truck first appears at the
  // plant, the outer visit is opened before the inner one.
  const loadingBay = selectLoadingGeofence(geofences);
  if (loadingBay) {
    try {
      await runFactoryLoadingCheck(supabase, cargoTrucks, {
        name: loadingBay.name,
        ring: loadingBay.ring,
      });
    } catch (err) {
      warnings.push(`loading: ${(err as Error).message}`);
    }
  }

  // Speeding, last, because it is the one check that must not be able to
  // cost the others: a truck over the limit is worth knowing about, but
  // not at the price of a missed arrival.
  //
  // CARGO ONLY. This used to run on every vehicle, on the reasoning that
  // a speed limit is a safety rule and does not care what a vehicle is
  // for. That reasoning was sound and the result was still wrong: a
  // light car keeps up with traffic, so 7 staff vehicles raised 65 of
  // the fleet's 171 speeding alerts — 63 of them in a single day, 44% of
  // the total — and the alert the owner actually acts on is a laden
  // cement truck over the limit. An alert nobody acts on is not a safety
  // net, it is what buries the ones they do. The owner's call, 2026-08-28.
  //
  // Offline units are filtered out rather than passed through as "not
  // speeding". Excluded, a truck that stopped reporting appears in
  // neither the arrived nor the departed list, so its flag freezes until
  // it reports again. Passed through, every truck that went quiet would
  // have its flag cleared and would re-alert the moment it came back —
  // a flapping tracker turned into a stream of duplicate alerts.
  try {
    await runFleetSpeedingCheck(
      supabase,
      cargoTrucks.filter((t) => t.status !== "offline")
    );
  } catch (err) {
    warnings.push(`speeding: ${(err as Error).message}`);
  }

  // Trucks stopped at a station known to take money from drivers.
  //
  // IDLE ONLY, and that filter is the feature: the fleet feed calls a
  // truck idle when its fix is under 30 minutes old and its speed is at
  // or below 5km/h, so a truck driving PAST a blacklisted station raises
  // nothing. The alert is about the stop.
  //
  // Every vehicle, not just cargo — a station that shorts a driver does
  // it whatever he is driving.
  try {
    const { data: stationRows, error: stationError } = await supabase
      .from("gas_stations")
      .select("id, name, lat, lng, radius_meters, blacklisted")
      .eq("blacklisted", true);

    if (stationError) {
      warnings.push(`stations: ${stationError.message}`);
    } else if ((stationRows ?? []).length > 0) {
      await runBlacklistedStationCheck(
        supabase,
        trucks.filter((t) => t.status === "idle"),
        (stationRows ?? []).map((r) => ({
          id: r.id as string,
          name: r.name as string,
          lat: r.lat as number,
          lng: r.lng as number,
          radiusMeters: (r.radius_meters as number) ?? 50,
          blacklisted: true,
        }))
      );
    }
  } catch (err) {
    warnings.push(`stations: ${(err as Error).message}`);
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
