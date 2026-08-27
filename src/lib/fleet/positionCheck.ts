// Core position-check logic, shared by two callers with different
// Supabase clients: the user-facing server actions in
// lib/supabase/positions.ts (caller's session, RLS applies) and the
// scheduled tick in app/api/tick (service role, no session at all).
//
// Deliberately NOT a "use server" module. Every export of a "use server"
// file becomes a public HTTP endpoint, and these take a Supabase client
// as their first argument — which cannot cross that boundary, and
// shouldn't be callable from a browser regardless.

import type { SupabaseClient } from "@supabase/supabase-js";
import { projectPointOntoRoute, haversineMeters, formatDuration, isWithinGeofence } from "@/lib/geometry";
import type { GeofenceRecord } from "@/lib/supabase/geofences";
import { FACTORY_LAT, FACTORY_LNG, SPEED_LIMIT_KMH, stationWatchRadius } from "@/lib/constants";

export interface PositionCheckResult {
  truckId: string;
  lat: number;
  lng: number;
  speed: number;
  deviationMeters: number | null;
  onRoute: boolean | null;
  deviationBasis: "route" | "straight";
  etaSeconds: number | null;
  etaBasis: "osrm-speed" | "fallback-speed" | null;
  etaLabel: string;
  isSpeeding: boolean;
  driverName: string | null;
  timestamp: Date;
}

const ROUTE_BUFFER_METERS = 400;
const FALLBACK_AVG_SPEED_KMH = 65;

// Geofence arrival buffers — edge buffer for real polygon geofences
// (GPS noise near the boundary), and a plain-distance buffer for sites
// that don't have an uploaded polygon yet.
const GEOFENCE_EDGE_BUFFER_METERS = 150;
const ARRIVAL_DISTANCE_BUFFER_METERS = 300;

// How far out the "arriving shortly" alert fires. Five minutes is what
// was asked for; it lives here rather than inline so the tick's cadence
// can be reasoned about against it — the fleet polls every minute, so
// five minutes is comfortably more than one poll's worth of travel and
// the alert cannot be skipped over by a truck moving too fast between
// samples.
const SITE_APPROACH_SECONDS = 5 * 60;

interface DispatchForCheck {
  id: string;
  truck_id: string;
  site_id: string;
  route_geometry: [number, number][] | null;
  route_total_distance_meters: number | null;
  route_total_time_seconds: number | null;
  is_off_route: boolean | null;
  is_speeding: boolean | null;
  site_arrival_notified: boolean | null;
  factory_arrival_notified: boolean | null;
  site_approach_notified: boolean | null;
}

interface SiteForCheck {
  name: string | null;
  lat: number | null;
  lng: number | null;
}

// Core position-check logic shared by the live-Wialon path and the
// manual-coordinate-paste fallback: deviation/ETA against real route
// geometry (or straight-line if none), geofence arrival detection,
// transition-based notifications, and the dispatch row update.
export async function runPositionCheck(
  supabase: SupabaseClient,
  dispatch: DispatchForCheck,
  site: SiteForCheck | null,
  point: [number, number],
  speed: number,
  driverName: string | null,
  geofences: GeofenceRecord[]
): Promise<PositionCheckResult> {
  let deviationMeters: number | null = null;
  let onRoute: boolean | null = null;
  let deviationBasis: "route" | "straight" = "straight";
  let etaSeconds: number | null = null;
  let etaBasis: "osrm-speed" | "fallback-speed" | null = null;

  const routeGeometry = dispatch.route_geometry;

  if (routeGeometry && routeGeometry.length >= 2) {
    const proj = projectPointOntoRoute(point, routeGeometry);
    if (proj) {
      deviationMeters = proj.distanceToRoute;
      deviationBasis = "route";
      onRoute = deviationMeters <= ROUTE_BUFFER_METERS;

      const totalDist = dispatch.route_total_distance_meters;
      const totalTime = dispatch.route_total_time_seconds;
      if (totalDist && totalTime) {
        const avgSpeedMps = totalDist / totalTime;
        const remaining = Math.max(0, proj.totalRouteLength - proj.distanceCovered);
        etaSeconds = remaining / avgSpeedMps;
        etaBasis = "osrm-speed";
      }
    }
  } else if (site?.lat && site?.lng) {
    deviationMeters = haversineMeters(point[0], point[1], site.lat, site.lng);
    deviationBasis = "straight";
    etaSeconds = (deviationMeters / 1000) / FALLBACK_AVG_SPEED_KMH * 3600;
    etaBasis = "fallback-speed";
  }

  const isSpeeding = speed > SPEED_LIMIT_KMH;

  const result: PositionCheckResult = {
    truckId: dispatch.truck_id,
    lat: point[0],
    lng: point[1],
    speed,
    deviationMeters,
    onRoute,
    deviationBasis,
    etaSeconds,
    etaBasis,
    etaLabel: formatDuration(etaSeconds),
    isSpeeding,
    driverName,
    timestamp: new Date(),
  };

  // ── Geofence arrival: real polygon if uploaded, distance buffer otherwise ──
  const siteGeofence = geofences.find((g) => g.kind === "site" && g.siteId === dispatch.site_id);
  const factoryGeofence = geofences.find((g) => g.kind === "factory");

  const wasSiteArrived = dispatch.site_arrival_notified === true;
  const wasFactoryArrived = dispatch.factory_arrival_notified === true;

  let nowSiteArrived = false;
  if (!wasSiteArrived) {
    if (siteGeofence?.ring) {
      nowSiteArrived = isWithinGeofence(point, siteGeofence.ring, GEOFENCE_EDGE_BUFFER_METERS);
    } else if (site?.lat != null && site?.lng != null) {
      nowSiteArrived = haversineMeters(point[0], point[1], site.lat, site.lng) <= ARRIVAL_DISTANCE_BUFFER_METERS;
    }
  }

  let nowFactoryArrived = false;
  if (!wasFactoryArrived) {
    if (factoryGeofence?.ring) {
      nowFactoryArrived = isWithinGeofence(point, factoryGeofence.ring, GEOFENCE_EDGE_BUFFER_METERS);
    } else {
      nowFactoryArrived = haversineMeters(point[0], point[1], FACTORY_LAT, FACTORY_LNG) <= ARRIVAL_DISTANCE_BUFFER_METERS;
    }
  }

  // ── Notifications: fire only on a false → true transition ──
  const siteName = site?.name || "destination";
  const wasOffRoute = dispatch.is_off_route === true;
  const nowOffRoute = deviationBasis === "route" && onRoute === false;
  const nowSpeeding = isSpeeding;

  const notificationsToInsert: {
    dispatch_id: string;
    truck_id: string;
    kind: "off_route" | "speeding" | "site_arrival" | "site_approaching" | "factory_arrival" | "hq_arrival";
    title: string;
    message: string;
  }[] = [];

  if (nowOffRoute && !wasOffRoute) {
    notificationsToInsert.push({
      dispatch_id: dispatch.id,
      truck_id: dispatch.truck_id,
      kind: "off_route",
      title: "Truck left assigned route",
      message: `${dispatch.truck_id} has deviated from its route to ${siteName} (${(deviationMeters! / 1000).toFixed(1)}km off).`,
    });
  }
  // No speeding notification here any more, on the same reasoning that
  // moved factory_arrival out: speeding is now detected fleet-wide by
  // runFleetSpeedingCheck, which sees every truck rather than only
  // dispatched ones, and emitting from both places would alert twice for
  // one crossing — once against the run and once against the fleet.
  //
  // nowSpeeding is still computed and still persisted below. It is not
  // dead: dispatches.is_speeding is this run's live state, and
  // ever_speeding is what driver_ratings() reads to score a run as
  // clean, so dropping it would quietly change every driver's rating.
  if (nowSiteArrived) {
    notificationsToInsert.push({
      dispatch_id: dispatch.id,
      truck_id: dispatch.truck_id,
      kind: "site_arrival",
      title: "Arrived at destination",
      message: `${dispatch.truck_id} has arrived at ${siteName}.`,
    });
  }
  // No factory_arrival notification here any more. Factory arrival is
  // now detected fleet-wide by runFactoryArrivalCheck, which sees every
  // truck rather than only dispatched ones — emitting it from both
  // places would notify a dispatched truck twice for one arrival.
  // nowFactoryArrived is still computed and still persisted below,
  // because dispatches.factory_arrival_notified is what the History
  // page reads for "reached factory" on a given run.

  // Fires once, when the road-route ETA first drops to five minutes or
  // less, so the client can be ready before the truck is at the gate.
  //
  // Gated on etaBasis === "osrm-speed": the fallback ETA is straight-line
  // distance over an assumed average speed, which near a destination is
  // wrong in the direction that matters — it reads "5 minutes" while the
  // truck is still working through the last few junctions. An alert
  // whose whole value is its timing should not fire on a guess.
  const wasApproachNotified = dispatch.site_approach_notified === true;
  const nowApproaching =
    !wasApproachNotified &&
    !wasSiteArrived &&
    !nowSiteArrived &&
    etaBasis === "osrm-speed" &&
    etaSeconds != null &&
    etaSeconds <= SITE_APPROACH_SECONDS;

  if (nowApproaching) {
    notificationsToInsert.push({
      dispatch_id: dispatch.id,
      truck_id: dispatch.truck_id,
      kind: "site_approaching",
      title: "Arriving at client shortly",
      message: `${dispatch.truck_id} is about ${formatDuration(etaSeconds)} from ${siteName}.`,
    });
  }

  // Throw rather than ignore the result. Every notification here is
  // paired with a flag written by the dispatch update just below, and
  // that flag's whole job is to stop the alert firing twice — so a
  // swallowed insert doesn't merely lose one alert, it marks the run as
  // already alerted and suppresses every retry for the rest of the run.
  // That is exactly how the client-approach alert stayed dead from the
  // day it shipped: a kind the CHECK constraint didn't allow (fixed in
  // 026), rejected in silence, flag written anyway.
  //
  // tick.ts catches per-dispatch errors and collects them as warnings,
  // so throwing costs this one truck's check for this one tick and
  // leaves the flags unwritten — the next tick retries from the same
  // state, and the failure is visible in the tick response instead of
  // being invisible forever.
  if (notificationsToInsert.length > 0) {
    const { error: notifyError } = await supabase.from("notifications").insert(notificationsToInsert);
    if (notifyError) {
      const kinds = notificationsToInsert.map((n) => n.kind).join(", ");
      throw new Error(`notification insert failed (${kinds}): ${notifyError.message}`);
    }
  }

  // Update dispatch record — current state (resettable) + lifetime flags
  // (never reset, used for history/ratings) + driver name snapshot.
  const updateResult = await supabase
    .from("dispatches")
    .update({
      last_lat: result.lat,
      last_lng: result.lng,
      last_checked_at: result.timestamp.toISOString(),
      last_deviation_meters: result.deviationMeters,
      last_on_route: result.onRoute,
      last_deviation_basis: result.deviationBasis,
      // Column is INTEGER — must round. This was silently failing every
      // update whenever eta was computed from real route geometry (a
      // non-whole number), which meant is_off_route/is_speeding never
      // actually persisted and every check looked like a fresh
      // violation. Only surfaced once OSRM routing made this path real.
      last_eta_seconds: result.etaSeconds != null ? Math.round(result.etaSeconds) : null,
      last_eta_basis: result.etaBasis,
      is_off_route: nowOffRoute,
      is_speeding: nowSpeeding,
      ever_off_route: nowOffRoute ? true : undefined,
      ever_speeding: nowSpeeding ? true : undefined,
      driver_name: result.driverName ?? undefined,
      site_arrival_notified: nowSiteArrived ? true : undefined,
      factory_arrival_notified: nowFactoryArrived ? true : undefined,
      site_approach_notified: nowApproaching ? true : undefined,
      arrived_at: nowSiteArrived ? result.timestamp.toISOString() : undefined,
      // Reaching the client is the end of the run, so the run is closed
      // here rather than waiting for a dispatcher to press stop. This
      // one field is what makes the rest of it happen: tick.ts only
      // loads dispatches with status 'active', so a completed run stops
      // being route-checked and stops accruing an ETA on the next tick;
      // listActiveDispatches drops it from Active Runs; and the History
      // page already reads 'completed'. arrived_at above is the moment
      // it ended, and what History measures the duration against.
      status: nowSiteArrived ? "completed" : undefined,
    })
    .eq("id", dispatch.id)
    .select("id");

  if (updateResult.error) {
    console.error("[runPositionCheck] dispatch update failed:", updateResult.error);
  } else if (updateResult.data.length === 0) {
    console.error("[runPositionCheck] dispatch update matched 0 rows for id:", dispatch.id);
  }

  return result;
}

export async function loadDispatchAndSite(
  supabase: SupabaseClient,
  dispatchId: string
): Promise<{ dispatch: DispatchForCheck; site: SiteForCheck | null } | { error: string }> {
  const { data: dispatch, error: dispatchError } = await supabase
    .from("dispatches")
    .select(
      "id, truck_id, site_id, route_geometry, route_total_distance_meters, route_total_time_seconds, is_off_route, is_speeding, site_arrival_notified, factory_arrival_notified, site_approach_notified"
    )
    .eq("id", dispatchId)
    .single();

  if (dispatchError || !dispatch) return { error: "Dispatch not found" };

  const { data: site } = await supabase
    .from("construction_sites")
    .select("name, lat, lng")
    .eq("id", dispatch.site_id)
    .single();

  return { dispatch, site: site ?? null };
}
const HQ_EDGE_BUFFER_METERS = 50;

export interface ZoneTruck {
  truck_id: string;
  lat: number | null;
  lng: number | null;
  driverName?: string | null;
  age_minutes?: number | null;
  /** km/h from the unit's last message. Needed by the speeding check,
   *  which is a fleet-wide transition like the zones but tests the
   *  truck's speed rather than where it is. */
  speed?: number;
}

/** A truck that survived the position filter, so its fix is real. */
type PositionedTruck = ZoneTruck & { lat: number; lng: number };

/**
 * One fleet-wide condition a truck is either in or out of: how to test
 * it, which per-truck flag remembers the last answer, and what to say
 * when it becomes true.
 *
 * The parc and the factory are checked this way — for every cargo truck,
 * every tick, regardless of dispatch — because a truck reaches either
 * whether or not anyone opened a dispatch for the trip. That is the
 * whole point of the factory alert in particular: arriving there to load
 * is the moment a dispatch gets *created*, so it cannot be conditional
 * on one already existing.
 *
 * Speeding is now checked the same way, and the test is deliberately a
 * predicate over the whole truck rather than a point-in-zone: the
 * condition is "over the limit", which has nothing to do with where the
 * truck is. Everything else — the duplicate-unit-name defence, the
 * compare-and-set, the refusal to notify on a write that did not
 * persist — is the same machinery, and reusing it is what stops a second
 * implementation drifting away from those fixes.
 */
interface ZoneTarget {
  /** For log lines only. */
  label: string;
  matches(truck: PositionedTruck): boolean;
  /** Column on fleet_trucks holding the last known answer. */
  flagColumn: "at_hq" | "at_factory" | "is_speeding";
  rpcName: "mark_trucks_hq_state" | "mark_trucks_factory_state" | "mark_trucks_speeding_state";
  /** The RPC's boolean argument name, which differs per target. */
  rpcFlagArg: "p_at_hq" | "p_at_factory" | "p_is_speeding";
  notification(truckId: string): { kind: string; title: string; message: string };
  /** Extra durable record written from the same transition result — the
   *  parc log, for Rapport Parc. Runs only for trucks that actually
   *  transitioned. */
  onArrived?(truckIds: string[], driverOf: Map<string, string | null>): Promise<void>;
}

// Home-base arrival isn't tied to a dispatch — a truck returns to PARC
// OMD whether or not it's currently running a delivery — so it can't
// reuse the dispatches.*_notified flag pattern. fleet_trucks.at_hq is
// the per-truck transition flag instead. Bulk (one read, one insert,
// up to two updates) rather than per-truck round trips, since this
// runs for the whole fleet every poll.
export async function runHqArrivalCheck(
  supabase: SupabaseClient,
  trucks: ZoneTruck[],
  hq: { centerLat: number; centerLng: number; radiusMeters: number }
): Promise<void> {
  const radius = hq.radiusMeters + HQ_EDGE_BUFFER_METERS;
  await runZoneArrivalCheck(supabase, trucks, {
    label: "hq",
    matches: (t) => haversineMeters(t.lat, t.lng, hq.centerLat, hq.centerLng) <= radius,
    flagColumn: "at_hq",
    rpcName: "mark_trucks_hq_state",
    rpcFlagArg: "p_at_hq",
    notification: (truck_id) => ({
      kind: "hq_arrival",
      title: "Arrived at headquarters",
      message: `${truck_id} has arrived at PARC OMD - Headquarters & Parking.`,
    }),
    onArrived: async (truckIds, driverOf) => {
      // The permanent gate record for Rapport Parc. Written from the
      // same compare-and-set result as the notification, so the log and
      // the feed can never disagree about whether an entry happened.
      // The driver name is stamped from this moment's fleet data rather
      // than resolved at read time — drivers change, and a log that
      // rewrites its own history is worse than no log.
      const enteredAt = new Date().toISOString();
      const { error } = await supabase.from("hq_entries").insert(
        truckIds.map((truck_id) => ({
          truck_id,
          driver_name: driverOf.get(truck_id) ?? null,
          entered_at: enteredAt,
        }))
      );
      if (error) console.error("[hqArrivalCheck] parc entry log failed:", error);
    },
  });
}

/**
 * Factory arrival, on the same fleet-wide footing as the parc.
 *
 * The factory geofence is a drawn polygon rather than a circle, so the
 * test is point-in-polygon with the same edge buffer the dispatch-scoped
 * check uses — a truck sitting on the boundary shouldn't flicker.
 */
export async function runFactoryArrivalCheck(
  supabase: SupabaseClient,
  trucks: ZoneTruck[],
  factory: { name: string; ring: [number, number][] | null; centerLat: number | null; centerLng: number | null; radiusMeters: number | null }
): Promise<void> {
  // Polygon when one has been drawn, circle otherwise — the factory is a
  // polygon today, but a circle is a valid way to define it and the
  // check shouldn't silently do nothing if someone redraws it that way.
  const isInside = factory.ring
    ? (lat: number, lng: number) =>
        isWithinGeofence([lat, lng], factory.ring!, GEOFENCE_EDGE_BUFFER_METERS)
    : factory.centerLat != null && factory.centerLng != null
      ? (lat: number, lng: number) =>
          haversineMeters(lat, lng, factory.centerLat!, factory.centerLng!) <=
          (factory.radiusMeters ?? 300) + HQ_EDGE_BUFFER_METERS
      : null;

  if (!isInside) {
    console.warn("[factoryArrivalCheck] factory geofence has neither polygon nor centre; skipped");
    return;
  }

  await runZoneArrivalCheck(supabase, trucks, {
    label: "factory",
    matches: (t) => isInside(t.lat, t.lng),
    flagColumn: "at_factory",
    rpcName: "mark_trucks_factory_state",
    rpcFlagArg: "p_at_factory",
    notification: (truck_id) => ({
      kind: "factory_arrival",
      title: "Arrived at the factory",
      message: `${truck_id} has arrived at ${factory.name}.`,
    }),
  });
}

/**
 * Speeding, for every truck the fleet reports — dispatched or not.
 *
 * This used to live only inside runPositionCheck, which walks active
 * dispatches, so the limit was enforced on delivery runs and nowhere
 * else. A driver doing 110km/h on the way back from the parc with no run
 * open raised nothing. The tick already pulls every unit's speed each
 * minute for the snapshot, so the reading was always there — only the
 * check was scoped to dispatches.
 *
 * Two things the caller must get right, both about which trucks to pass:
 *
 * OFFLINE UNITS ARE EXCLUDED, and that is not the same as treating them
 * as under the limit. A truck that stops reporting keeps whatever flag
 * it had: excluded from the list, it lands in neither `arrived` nor
 * `departed`, so its flag freezes until it reports again. Passing them
 * through instead would clear the flag on every truck that went quiet
 * and re-alert the moment it came back, turning a flapping tracker into
 * a stream of duplicate alerts.
 *
 * STAFF VEHICLES ARE INCLUDED. The parc and factory checks take cargo
 * trucks only, because their arrivals are noise; a speed limit is a
 * safety rule and applies to whoever is behind the wheel.
 */
export async function runFleetSpeedingCheck(
  supabase: SupabaseClient,
  trucks: ZoneTruck[]
): Promise<void> {
  // The alert should say how fast, not just that it happened. Built on
  // the freshest fix per id for the same reason the helper de-duplicates
  // internally: with two Wialon units under one name, the stale one must
  // not be the number the message quotes.
  const speedOf = new Map<string, number>();
  const ageOf = new Map<string, number>();
  for (const t of trucks) {
    const age = t.age_minutes ?? Number.POSITIVE_INFINITY;
    if (!speedOf.has(t.truck_id) || age < (ageOf.get(t.truck_id) ?? Number.POSITIVE_INFINITY)) {
      speedOf.set(t.truck_id, t.speed ?? 0);
      ageOf.set(t.truck_id, age);
    }
  }

  await runZoneArrivalCheck(supabase, trucks, {
    label: "speeding",
    // Strictly greater than, matching the dispatch-scoped test this
    // replaces — 90 exactly is at the limit, not over it.
    matches: (t) => (t.speed ?? 0) > SPEED_LIMIT_KMH,
    flagColumn: "is_speeding",
    rpcName: "mark_trucks_speeding_state",
    rpcFlagArg: "p_is_speeding",
    notification: (truck_id) => ({
      kind: "speeding",
      title: "Speed limit exceeded",
      message: `${truck_id} is going ${Math.round(speedOf.get(truck_id) ?? 0)}km/h (limit ${SPEED_LIMIT_KMH}km/h).`,
    }),
  });
}

/**
 * One entry per truck id, keeping the freshest fix.
 *
 * Wialon can hold two units under the SAME name — a replacement tracker
 * fitted without retiring the old record. Left as-is one vehicle
 * produces two entries, both land in the same batch, and the single ON
 * CONFLICT statement covering the whole fleet is rejected with 21000
 * ("cannot affect row a second time"), which stops tracking for EVERY
 * truck rather than the duplicated one. That ran for 28 hours unnoticed.
 *
 * The RPCs de-duplicate defensively too, but this is the layer that can
 * pick WHICH of the two to believe: the freshest wins, since a stale
 * duplicate could otherwise place a truck somewhere it left hours ago.
 *
 * Shared by the zone checks and the blacklisted-station check so there
 * is one copy of that reasoning rather than two that can drift apart.
 */
function freshestPerTruck<T extends { truck_id: string; age_minutes?: number | null }>(rows: T[]): T[] {
  const freshest = new Map<string, T>();
  for (const t of rows) {
    const existing = freshest.get(t.truck_id);
    if (!existing) {
      freshest.set(t.truck_id, t);
      continue;
    }
    const age = t.age_minutes ?? Number.POSITIVE_INFINITY;
    const existingAge = existing.age_minutes ?? Number.POSITIVE_INFINITY;
    if (age < existingAge) freshest.set(t.truck_id, t);
  }
  return [...freshest.values()];
}


export interface BlacklistStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  blacklisted: boolean;
}

/**
 * A truck STOPPED at a station known to take money from drivers.
 *
 * "Stopped", not "passed": the caller hands in only trucks the fleet
 * feed calls idle, which in this app means a fix under 30 minutes old
 * with speed at or below 5km/h. A truck driving past a blacklisted
 * station therefore raises nothing, which is the whole point — the
 * alert is about the stop, not the road.
 *
 * The watch radius is wider for a blacklisted station (150m rather than
 * the 50m forecourt) so the office hears about it while there is still
 * time to phone the driver, rather than once he is at the pump.
 *
 * State lives in fleet_trucks.at_blacklisted_station_id — WHICH station,
 * not a boolean per station, because at_hq/at_factory's one-column-per-
 * zone shape does not survive 51 stations. Moving from one blacklisted
 * station to another is therefore a real transition and alerts again.
 */
export async function runBlacklistedStationCheck(
  supabase: SupabaseClient,
  trucks: ZoneTruck[],
  stations: BlacklistStation[]
): Promise<void> {
  const watched = stations.filter((s) => s.blacklisted);

  const positioned = freshestPerTruck(
    trucks.filter((t): t is PositionedTruck => t.lat != null && t.lng != null)
  );

  // Where each truck is stopped now: the NEAREST blacklisted station
  // whose watch radius contains it. Nearest rather than first, so two
  // overlapping watch circles cannot make the answer depend on row
  // order — and moving between them stays a clean transition.
  const nowAt = new Map<string, BlacklistStation>();
  for (const t of positioned) {
    let best: { station: BlacklistStation; metres: number } | null = null;
    for (const st of watched) {
      const metres = haversineMeters(t.lat, t.lng, st.lat, st.lng);
      if (metres > stationWatchRadius(st.radiusMeters, true)) continue;
      if (!best || metres < best.metres) best = { station: st, metres };
    }
    if (best) nowAt.set(t.truck_id, best.station);
  }

  // What the database currently believes, for these trucks only.
  const { data: rows, error: readError } = await supabase
    .from("fleet_trucks")
    .select("truck_id, at_blacklisted_station_id")
    .in("truck_id", positioned.map((t) => t.truck_id));
  if (readError) throw new Error(`station state read failed: ${readError.message}`);

  const wasAt = new Map(
    (rows ?? []).map((r) => [r.truck_id as string, (r.at_blacklisted_station_id as string | null) ?? null])
  );

  // Grouped by destination station, because the RPC sets one station for
  // a batch of trucks — and one call per station keeps that contract.
  const arrivedByStation = new Map<string, string[]>();
  const left: string[] = [];

  for (const t of positioned) {
    const now = nowAt.get(t.truck_id) ?? null;
    const before = wasAt.get(t.truck_id) ?? null;
    if (now?.id === before) continue;
    if (now) {
      const list = arrivedByStation.get(now.id) ?? [];
      list.push(t.truck_id);
      arrivedByStation.set(now.id, list);
    } else if (before) {
      left.push(t.truck_id);
    }
  }

  const nameOf = new Map(watched.map((s) => [s.id, s.name]));
  const driverOf = new Map(positioned.map((t) => [t.truck_id, t.driverName ?? null]));

  for (const [stationId, truckIds] of arrivedByStation) {
    const { data: changed, error } = await supabase.rpc("mark_trucks_station_state", {
      p_truck_ids: truckIds,
      p_station_id: stationId,
    });
    // Thrown rather than logged, for the reason the zone checks are: the
    // flag and the alert have to agree. A written flag with no alert
    // suppresses the alert for as long as the truck stays put.
    if (error) throw new Error(`station state write failed, alerts skipped: ${error.message}`);

    const toNotify = ((changed ?? []) as { truck_id: string }[]).map((r) => r.truck_id);
    if (toNotify.length === 0) continue;

    const station = nameOf.get(stationId) ?? "a blacklisted station";
    const { error: notifyError } = await supabase.from("notifications").insert(
      toNotify.map((truck_id) => ({
        truck_id,
        driver_name: driverOf.get(truck_id) ?? null,
        kind: "station_stop",
        title: "Stopped at a blacklisted station",
        message: `${truck_id} has stopped at ${station}.`,
      }))
    );
    // Checked, never fire-and-forget: a kind the CHECK constraint does
    // not allow comes back as 23514, and swallowing it is what left the
    // client-approach alert dead from the day it shipped (migration 026).
    if (notifyError) {
      throw new Error(
        `station stop alert insert failed (flags already set, so these will not retry): ${notifyError.message}`
      );
    }
  }

  if (left.length > 0) {
    const { error } = await supabase.rpc("mark_trucks_station_state", {
      p_truck_ids: left,
      p_station_id: null,
    });
    // A departure that fails to persist leaves the truck pinned to the
    // station forever, and a truck that never leaves can never be seen
    // to arrive again.
    if (error) throw new Error(`station departure write failed: ${error.message}`);
  }
}

async function runZoneArrivalCheck(
  supabase: SupabaseClient,
  trucks: ZoneTruck[],
  target: ZoneTarget
): Promise<void> {
  // Narrowed to PositionedTruck rather than an inline shape: an inline
  // list has to be updated by hand every time ZoneTruck gains a field,
  // and a field it forgets (speed, for the speeding check) silently
  // disappears from the type while still being there at runtime.
  const withPosition = trucks.filter(
    (t): t is PositionedTruck => t.lat != null && t.lng != null
  );
  if (withPosition.length === 0) return;

  // Wialon can hold two units under the SAME name — a replacement
  // tracker fitted without retiring the old record. Left as-is, one
  // vehicle produces two entries, both land in `arrived`, and the
  // single ON CONFLICT statement covering the whole fleet is rejected
  // (21000, "cannot affect row a second time"), which stops HQ tracking
  // for EVERY truck, not just the duplicated one. It ran that way for 28
  // hours before anyone noticed.
  //
  // mark_trucks_hq_state now de-duplicates defensively too, but doing it
  // here as well is not belt-and-braces for its own sake: this is the
  // layer that can pick WHICH of the two fixes to believe. The freshest
  // one wins, since a stale duplicate would otherwise be able to place a
  // truck at HQ that left hours ago.
  const positioned = freshestPerTruck(withPosition);

  if (positioned.length !== withPosition.length) {
    console.warn(
      `[${target.label}ArrivalCheck] ${withPosition.length - positioned.length} duplicate unit name(s) in Wialon; kept the freshest fix for each`
    );
  }

  const { data: rows } = await supabase
    .from("fleet_trucks")
    .select(`truck_id, ${target.flagColumn}`)
    .in("truck_id", positioned.map((t) => t.truck_id));

  const wasInside = new Map(
    (rows ?? []).map((r) => [
      r.truck_id as string,
      (r as Record<string, unknown>)[target.flagColumn] === true,
    ])
  );

  const arrived: string[] = [];
  const departed: string[] = [];

  for (const t of positioned) {
    const within = target.matches(t);
    const was = wasInside.get(t.truck_id) ?? false;
    if (within && !was) arrived.push(t.truck_id);
    else if (!within && was) departed.push(t.truck_id);
  }

  // The flag is written through the RPC rather than a direct upsert, for
  // two reasons.
  //
  // First, RLS: fleet_trucks only carries an admin FOR ALL write
  // policy, so the old upsert was silently rejected for every
  // operator. at_hq never flipped, so each poll re-detected the same
  // arrival and inserted another notification — 7,436 duplicate rows
  // across 41 trucks in three hours, in production.
  //
  // Second, the RPC returns only the trucks whose flag actually
  // changed, and does the compare-and-set in one statement. That's
  // what makes this safe with FleetProvider running in several tabs
  // at once: previously two tabs could both read at_hq = false and
  // both notify. Now the second one's write finds the flag already
  // set and returns nothing to notify about.
  if (arrived.length > 0) {
    const { data: transitioned, error } = await supabase.rpc(target.rpcName, {
      p_truck_ids: arrived,
      [target.rpcFlagArg]: true,
    });

    if (error) {
      // Thrown, not logged-and-returned. Notifications must still be
      // skipped when the flag did not persist — that is the loop which
      // produced the duplicate storm — but swallowing the error here is
      // what let a total HQ-tracking outage run for 28 hours reporting
      // ok:true with no warnings. runFleetTick catches this into its
      // warnings array, which reaches net._http_response, so the next
      // failure is visible from the database instead of only in logs
      // nobody is watching.
      throw new Error(`${target.label} state write failed, notifications skipped: ${error.message}`);
    }

    const toNotify = ((transitioned ?? []) as { truck_id: string }[]).map((r) => r.truck_id);
    if (toNotify.length > 0) {
      const driverOf = new Map(positioned.map((t) => [t.truck_id, t.driverName ?? null]));

      if (target.onArrived) await target.onArrived(toNotify, driverOf);

      // truck_id is spread in here rather than left to each target's
      // notification() to remember: the column is NOT NULL, so omitting
      // it fails the insert outright, and building the row in one place
      // means a new zone cannot forget it.
      //
      // driver_name is stamped from this moment's fleet data for the same
      // reason hq_entries stamps it: a fleet-wide alert has no dispatch
      // to join to, and resolving the name at read time would let a
      // change of driver quietly rewrite who was speeding last week.
      const { error: notifyError } = await supabase.from("notifications").insert(
        toNotify.map((truck_id) => ({
          truck_id,
          driver_name: driverOf.get(truck_id) ?? null,
          ...target.notification(truck_id),
        }))
      );
      // Checked, not fire-and-forget. An unchecked insert here is what
      // hid this exact bug: the flag write succeeded, so every truck was
      // marked as present and would never transition again, while the
      // notification that was the entire point never landed and nothing
      // said so.
      if (notifyError) {
        throw new Error(
          `${target.label} arrival notification insert failed (flags already set, so these will not retry): ${notifyError.message}`
        );
      }
    }
  }

  if (departed.length > 0) {
    const { error } = await supabase.rpc(target.rpcName, {
      p_truck_ids: departed,
      [target.rpcFlagArg]: false,
    });
    // Also thrown rather than logged: a departure that fails to persist
    // leaves the truck flagged as present forever, and a truck that
    // never "leaves" can never be seen to arrive again. That is the same
    // silent, permanent stall as a failed arrival write, just reached
    // from the other side.
    if (error) {
      throw new Error(`${target.label} departure write failed: ${error.message}`);
    }
  }
}