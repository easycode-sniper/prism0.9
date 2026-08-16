import type { FleetTruck } from "@/lib/wialon/config";
import type { DispatchRecord } from "@/lib/supabase/actions";
import type { MonitoringTruck } from "@/lib/supabase/monitoring";

// Joins the already-fetched fleet feed (from FleetProvider's context,
// which polls Wialon once and shares it app-wide) with active
// dispatches (a plain Supabase query, no Wialon round-trip) — client
// side, so pages don't each need their own Wialon fetch just to get
// this same shape of data.
export function joinFleetWithDispatches(trucks: FleetTruck[], dispatches: DispatchRecord[]): MonitoringTruck[] {
  const dispatchByTruck = new Map(dispatches.map((d) => [d.truck_id, d]));

  return trucks.map((t): MonitoringTruck => {
    const d = dispatchByTruck.get(t.truck_id);
    return {
      truck_id: t.truck_id,
      status: t.status,
      lat: t.lat,
      lng: t.lng,
      speed: t.speed,
      course: t.course,
      age_minutes: t.age_minutes,
      matched: t.matched,
      driver_name: t.driverName,
      dispatched: !!d,
      dispatch_id: d?.id ?? null,
      site_name: d?.site?.name ?? null,
      client: d?.site?.client ?? null,
      dispatched_at: d?.dispatched_at ?? null,
      last_on_route: d?.last_on_route ?? null,
      last_eta_seconds: d?.last_eta_seconds ?? null,
      route_geometry: d?.route_geometry ?? null,
    };
  });
}
