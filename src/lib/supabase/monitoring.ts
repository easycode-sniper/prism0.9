"use server";

import { createClient } from "@/lib/supabase/server";
import { getFleetLiveData } from "./fleet";

export interface MonitoringTruck {
  truck_id: string;
  status: "moving" | "idle" | "offline";
  lat: number | null;
  lng: number | null;
  speed: number;
  course: number | null;
  age_minutes: number | null;
  matched: boolean;
  driver_name: string | null;
  // Dispatch info
  dispatched: boolean;
  dispatch_id: string | null;
  site_name: string | null;
  client: string | null;
  dispatched_at: string | null;
  last_on_route: boolean | null;
  last_eta_seconds: number | null;
  route_geometry: [number, number][] | null;
}

export interface MonitoringData {
  trucks: MonitoringTruck[];
  error: string | null;
  total: number;
  moving: number;
  idle: number;
  offline: number;
  dispatched: number;
}

export async function getMonitoringData(): Promise<MonitoringData> {
  const supabase = await createClient();
  const fleetResult = await getFleetLiveData();

  if (fleetResult.error && fleetResult.trucks.length === 0) {
    return {
      trucks: [],
      error: fleetResult.error,
      total: 0,
      moving: 0,
      idle: 0,
      offline: 0,
      dispatched: 0,
    };
  }

  // Get active dispatches
  const { data: dispatches } = await supabase
    .from("dispatches")
    .select(
      `
      id,
      truck_id,
      dispatched_at,
      last_on_route,
      last_eta_seconds,
      route_geometry,
      site:construction_sites(name, client)
    `
    )
    .eq("status", "active");

  const dispatchMap = new Map<string, any>();
  if (dispatches) {
    for (const d of dispatches) {
      dispatchMap.set(d.truck_id, d);
    }
  }

  const trucks: MonitoringTruck[] = fleetResult.trucks.map((t) => {
    const dispatch = dispatchMap.get(t.truck_id);
    return {
      truck_id: t.truck_id,
      status: t.status,
      lat: t.lat,
      lng: t.lng,
      speed: t.speed,
      course: t.course ?? null,
      age_minutes: t.age_minutes,
      matched: t.matched,
      driver_name: t.driverName ?? null,
      dispatched: !!dispatch,
      dispatch_id: dispatch?.id || null,
      site_name: Array.isArray(dispatch?.site)
        ? dispatch.site[0]?.name
        : dispatch?.site?.name || null,
      client: Array.isArray(dispatch?.site)
        ? dispatch.site[0]?.client
        : dispatch?.site?.client || null,
      dispatched_at: dispatch?.dispatched_at || null,
      last_on_route: dispatch?.last_on_route ?? null,
      last_eta_seconds: dispatch?.last_eta_seconds ?? null,
      route_geometry: dispatch?.route_geometry ?? null,
    };
  });

  return {
    trucks,
    error: null,
    total: trucks.length,
    moving: trucks.filter((t) => t.status === "moving").length,
    idle: trucks.filter((t) => t.status === "idle").length,
    offline: trucks.filter((t) => t.status === "offline").length,
    dispatched: trucks.filter((t) => t.dispatched).length,
  };
}
