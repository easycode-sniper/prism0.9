"use server";

import { createClient } from "@/lib/supabase/server";
import { findWialonUnit, getWialonConfig } from "@/lib/wialon/config";
import { projectPointOntoRoute, haversineMeters, formatDuration, isWithinGeofence } from "@/lib/geometry";
import { listGeofences } from "@/lib/supabase/geofences";

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

// Usine Amouda Ciment, El Baida — verified via Google Places. Used as the
// factory arrival fallback when no factory geofence polygon is loaded.
const FACTORY_LAT = 34.4368063;
const FACTORY_LNG = 2.058655;

export async function checkPositionForDispatch(
  truckId: string,
  dispatchId: string
): Promise<{ result?: PositionCheckResult; error?: string }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  // Get dispatch info — including CURRENT off-route/speeding state, so we
  // can tell whether this check represents a NEW violation (false → true)
  // or a continuation of one already notified about.
  const { data: dispatch, error: dispatchError } = await supabase
    .from("dispatches")
    .select(
      "id, truck_id, site_id, route_geometry, route_total_distance_meters, route_total_time_seconds, is_off_route, is_speeding, site_arrival_notified, factory_arrival_notified"
    )
    .eq("id", dispatchId)
    .single();

  if (dispatchError || !dispatch) return { error: "Dispatch not found" };

  // Get site info for fallback + notification messages
  const { data: site } = await supabase
    .from("construction_sites")
    .select("name, lat, lng")
    .eq("id", dispatch.site_id)
    .single();

  // Get live position (+ driver, if resolvable) from Wialon
  const config = getWialonConfig();
  if (!config?.token) return { error: "Wialon not configured" };

  const unit = await findWialonUnit(truckId);
  if (!unit) return { error: `Truck ${truckId} not found in Wialon` };
  if (!unit.pos) return { error: `No position data for ${truckId}` };

  const point: [number, number] = [unit.pos.lat, unit.pos.lng];

  // Calculate deviation and ETA
  let deviationMeters: number | null = null;
  let onRoute: boolean | null = null;
  let deviationBasis: "route" | "straight" = "straight";
  let etaSeconds: number | null = null;
  let etaBasis: "osrm-speed" | "fallback-speed" | null = null;

  const routeGeometry = dispatch.route_geometry as [number, number][] | null;

  if (routeGeometry && routeGeometry.length >= 2) {
    // Use route geometry
    const proj = projectPointOntoRoute(point, routeGeometry);
    if (proj) {
      deviationMeters = proj.distanceToRoute;
      deviationBasis = "route";
      onRoute = deviationMeters <= ROUTE_BUFFER_METERS;

      // ETA from OSRM speed
      const totalDist = dispatch.route_total_distance_meters;
      const totalTime = dispatch.route_total_time_seconds;
      if (totalDist && totalTime) {
        const avgSpeedMps = totalDist / totalTime;
        const remaining = Math.max(0, proj.totalRouteLength - proj.distanceCovered);
        etaSeconds = remaining / avgSpeedMps;
        etaBasis = "osrm-speed";
      }
    }
  } else {
    // Fallback: straight-line distance to destination
    if (site?.lat && site?.lng) {
      deviationMeters = haversineMeters(point[0], point[1], site.lat, site.lng);
      deviationBasis = "straight";
      etaSeconds = (deviationMeters / 1000) / FALLBACK_AVG_SPEED_KMH * 3600;
      etaBasis = "fallback-speed";
    }
  }

  const isSpeeding = unit.pos.speed > SPEED_LIMIT_KMH;

  const result: PositionCheckResult = {
    truckId,
    lat: unit.pos.lat,
    lng: unit.pos.lng,
    speed: unit.pos.speed,
    deviationMeters,
    onRoute,
    deviationBasis,
    etaSeconds,
    etaBasis,
    etaLabel: formatDuration(etaSeconds),
    isSpeeding,
    driverName: unit.driverName,
    timestamp: new Date(),
  };

  // ── Geofence arrival: real polygon if uploaded, distance buffer otherwise ──
  const { data: geofences } = await listGeofences();
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
    kind: "off_route" | "speeding" | "site_arrival" | "factory_arrival";
    title: string;
    message: string;
  }[] = [];

  if (nowOffRoute && !wasOffRoute) {
    notificationsToInsert.push({
      dispatch_id: dispatchId,
      truck_id: truckId,
      kind: "off_route",
      title: "🔴 Truck left assigned route",
      message: `${truckId} has deviated from its route to ${siteName} (${(deviationMeters! / 1000).toFixed(1)}km off).`,
    });
  }
  if (nowSpeeding && !wasSpeeding) {
    notificationsToInsert.push({
      dispatch_id: dispatchId,
      truck_id: truckId,
      kind: "speeding",
      title: "🟠 Speed limit exceeded",
      message: `${truckId} is going ${Math.round(unit.pos.speed)}km/h on the run to ${siteName} (limit ${SPEED_LIMIT_KMH}km/h).`,
    });
  }
  if (nowSiteArrived) {
    notificationsToInsert.push({
      dispatch_id: dispatchId,
      truck_id: truckId,
      kind: "site_arrival",
      title: "🟢 Arrived at destination",
      message: `${truckId} has arrived at ${siteName}.`,
    });
  }
  if (nowFactoryArrived) {
    notificationsToInsert.push({
      dispatch_id: dispatchId,
      truck_id: truckId,
      kind: "factory_arrival",
      title: "🟣 Arrived at factory",
      message: `${truckId} has arrived at Usine Amouda Ciment.`,
    });
  }

  if (notificationsToInsert.length > 0) {
    await supabase.from("notifications").insert(notificationsToInsert);
  }

  // Update dispatch record — current state (resettable) + lifetime flags
  // (never reset, used for history/ratings) + driver name snapshot.
  await supabase
    .from("dispatches")
    .update({
      last_lat: result.lat,
      last_lng: result.lng,
      last_checked_at: result.timestamp.toISOString(),
      last_deviation_meters: result.deviationMeters,
      last_on_route: result.onRoute,
      last_deviation_basis: result.deviationBasis,
      last_eta_seconds: result.etaSeconds,
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
    .eq("id", dispatchId);

  return { result };
}
