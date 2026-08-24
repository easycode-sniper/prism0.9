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
import { FACTORY_LAT, FACTORY_LNG } from "@/lib/constants";

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

// Speed limit — drivers must not exceed this. Matches the same rule as
// the original single-file app.
const SPEED_LIMIT_KMH = 90;

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
  const wasSpeeding = dispatch.is_speeding === true;
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
  if (nowSpeeding && !wasSpeeding) {
    notificationsToInsert.push({
      dispatch_id: dispatch.id,
      truck_id: dispatch.truck_id,
      kind: "speeding",
      title: "Speed limit exceeded",
      message: `${dispatch.truck_id} is going ${Math.round(speed)}km/h on the run to ${siteName} (limit ${SPEED_LIMIT_KMH}km/h).`,
    });
  }
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

  if (notificationsToInsert.length > 0) {
    await supabase.from("notifications").insert(notificationsToInsert);
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
}

/**
 * What separates one fleet-wide zone from another: how to test a point
 * against it, which per-truck flag records presence, and what to say on
 * arrival.
 *
 * Both the parc and the factory are checked this way — for every cargo
 * truck, every tick, regardless of dispatch — because a truck reaches
 * either whether or not anyone opened a dispatch for the trip. That is
 * the whole point of the factory alert in particular: arriving there to
 * load is the moment a dispatch gets *created*, so it cannot be
 * conditional on one already existing.
 */
interface ZoneTarget {
  /** For log lines only. */
  label: string;
  isInside(lat: number, lng: number): boolean;
  /** Column on fleet_trucks holding the last known presence. */
  flagColumn: "at_hq" | "at_factory";
  rpcName: "mark_trucks_hq_state" | "mark_trucks_factory_state";
  /** The RPC's boolean argument name, which differs per zone. */
  rpcFlagArg: "p_at_hq" | "p_at_factory";
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
    isInside: (lat, lng) => haversineMeters(lat, lng, hq.centerLat, hq.centerLng) <= radius,
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
    isInside,
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

async function runZoneArrivalCheck(
  supabase: SupabaseClient,
  trucks: ZoneTruck[],
  target: ZoneTarget
): Promise<void> {
  const withPosition = trucks.filter(
    (t): t is {
      truck_id: string;
      lat: number;
      lng: number;
      driverName?: string | null;
      age_minutes?: number | null;
    } => t.lat != null && t.lng != null
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
  const freshest = new Map<string, (typeof withPosition)[number]>();
  for (const t of withPosition) {
    const existing = freshest.get(t.truck_id);
    if (!existing) {
      freshest.set(t.truck_id, t);
      continue;
    }
    const age = t.age_minutes ?? Number.POSITIVE_INFINITY;
    const existingAge = existing.age_minutes ?? Number.POSITIVE_INFINITY;
    if (age < existingAge) freshest.set(t.truck_id, t);
  }
  const positioned = [...freshest.values()];

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
    const within = target.isInside(t.lat, t.lng);
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
      const { error: notifyError } = await supabase.from("notifications").insert(
        toNotify.map((truck_id) => ({ truck_id, ...target.notification(truck_id) }))
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