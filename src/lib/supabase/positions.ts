"use server";

import { createClient } from "@/lib/supabase/server";
import { findWialonUnit, getWialonConfig } from "@/lib/wialon/config";
import { projectPointOntoRoute, haversineMeters, formatDuration } from "@/lib/geometry";

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
      "id, truck_id, site_id, route_geometry, route_total_distance_meters, route_total_time_seconds, is_off_route, is_speeding"
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

  // ── Notifications: fire only on a false → true transition ──
  const siteName = site?.name || "destination";
  const wasOffRoute = dispatch.is_off_route === true;
  const wasSpeeding = dispatch.is_speeding === true;
  const nowOffRoute = deviationBasis === "route" && onRoute === false;
  const nowSpeeding = isSpeeding;

  const notificationsToInsert: {
    dispatch_id: string;
    truck_id: string;
    kind: "off_route" | "speeding";
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
    })
    .eq("id", dispatchId);

  return { result };
}
