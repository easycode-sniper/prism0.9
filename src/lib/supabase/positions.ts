"use server";

import { createClient } from "@/lib/supabase/server";
import { findWialonUnit, getWialonConfig } from "@/lib/wialon";
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
  timestamp: Date;
}

const ROUTE_BUFFER_METERS = 400;
const FALLBACK_AVG_SPEED_KMH = 65;

export async function checkPositionForDispatch(
  truckId: string,
  dispatchId: string
): Promise<{ result?: PositionCheckResult; error?: string }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  // Get dispatch info
  const { data: dispatch, error: dispatchError } = await supabase
    .from("dispatches")
    .select("id, truck_id, site_id, route_geometry, route_total_distance_meters, route_total_time_seconds")
    .eq("id", dispatchId)
    .single();

  if (dispatchError || !dispatch) return { error: "Dispatch not found" };

  // Get site coordinates for fallback
  const { data: site } = await supabase
    .from("construction_sites")
    .select("lat, lng")
    .eq("id", dispatch.site_id)
    .single();

  // Get live position from Wialon
  const config = await getWialonConfig();
  if (!config?.token) return { error: "Wialon not configured" };

  const unit = await findWialonUnit(config, truckId);
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
    timestamp: new Date(),
  };

  // Update dispatch record
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
      ever_off_route: result.onRoute === false ? true : undefined,
    })
    .eq("id", dispatchId);

  return { result };
}
