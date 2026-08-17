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
    kind: "off_route" | "speeding" | "site_arrival" | "factory_arrival" | "hq_arrival";
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
  if (nowFactoryArrived) {
    notificationsToInsert.push({
      dispatch_id: dispatch.id,
      truck_id: dispatch.truck_id,
      kind: "factory_arrival",
      title: "Arrived at factory",
      message: `${dispatch.truck_id} has arrived at Usine Amouda Ciment.`,
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
      "id, truck_id, site_id, route_geometry, route_total_distance_meters, route_total_time_seconds, is_off_route, is_speeding, site_arrival_notified, factory_arrival_notified"
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

// Home-base arrival isn't tied to a dispatch — a truck returns to PARC
// OMD whether or not it's currently running a delivery — so it can't
// reuse the dispatches.*_notified flag pattern. fleet_trucks.at_hq is
// the per-truck transition flag instead. Bulk (one read, one insert,
// up to two updates) rather than per-truck round trips, since this
// runs for the whole fleet every poll.
export async function runHqArrivalCheck(
  supabase: SupabaseClient,
  trucks: { truck_id: string; lat: number | null; lng: number | null; driverName?: string | null }[],
  hq: { centerLat: number; centerLng: number; radiusMeters: number }
): Promise<void> {
  const positioned = trucks.filter(
    (t): t is { truck_id: string; lat: number; lng: number; driverName?: string | null } =>
      t.lat != null && t.lng != null
  );
  if (positioned.length === 0) return;

  const { data: rows } = await supabase
    .from("fleet_trucks")
    .select("truck_id, at_hq")
    .in("truck_id", positioned.map((t) => t.truck_id));

  const wasAtHq = new Map((rows ?? []).map((r) => [r.truck_id, r.at_hq === true]));
  const radius = hq.radiusMeters + HQ_EDGE_BUFFER_METERS;

  const arrived: string[] = [];
  const departed: string[] = [];

  for (const t of positioned) {
    const within = haversineMeters(t.lat, t.lng, hq.centerLat, hq.centerLng) <= radius;
    const was = wasAtHq.get(t.truck_id) ?? false;
    if (within && !was) arrived.push(t.truck_id);
    else if (!within && was) departed.push(t.truck_id);
  }

  // The flag is written through mark_trucks_hq_state rather than a
  // direct upsert, for two reasons.
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
    const { data: transitioned, error } = await supabase.rpc("mark_trucks_hq_state", {
      p_truck_ids: arrived,
      p_at_hq: true,
    });

    if (error) {
      // Don't notify if the flag didn't persist — that's exactly the
      // loop that produced the duplicate storm.
      console.error("[hqArrivalCheck] HQ state write failed, skipping notifications:", error);
      return;
    }

    const toNotify = ((transitioned ?? []) as { truck_id: string }[]).map((r) => r.truck_id);
    if (toNotify.length > 0) {
      // The permanent gate record for Rapport Parc. Written from the
      // same compare-and-set result as the notification, so the log and
      // the feed can never disagree about whether an entry happened.
      // The driver name is stamped from this moment's fleet data rather
      // than resolved at read time — drivers change, and a log that
      // rewrites its own history is worse than no log.
      const driverOf = new Map(positioned.map((t) => [t.truck_id, t.driverName ?? null]));
      const enteredAt = new Date().toISOString();

      const { error: entryError } = await supabase.from("hq_entries").insert(
        toNotify.map((truck_id) => ({
          truck_id,
          driver_name: driverOf.get(truck_id) ?? null,
          entered_at: enteredAt,
        }))
      );
      if (entryError) console.error("[hqArrivalCheck] parc entry log failed:", entryError);

      await supabase.from("notifications").insert(
        toNotify.map((truck_id) => ({
          truck_id,
          kind: "hq_arrival" as const,
          title: "Arrived at headquarters",
          message: `${truck_id} has arrived at PARC OMD - Headquarters & Parking.`,
        }))
      );
    }
  }

  if (departed.length > 0) {
    const { error } = await supabase.rpc("mark_trucks_hq_state", {
      p_truck_ids: departed,
      p_at_hq: false,
    });
    if (error) console.error("[hqArrivalCheck] HQ departure write failed:", error);
  }
}