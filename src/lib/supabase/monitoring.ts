// Not "use server" — nothing left here calls Wialon or touches
// Supabase server-side. Trucks come from FleetProvider's shared
// context; only these plain types are still used, by fleetJoin.ts and
// the pages that render its output.

export interface MonitoringTruck {
  truck_id: string;
  status: "moving" | "idle" | "offline";
  lat: number | null;
  lng: number | null;
  speed: number;
  course: number | null;
  age_minutes: number | null;
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

