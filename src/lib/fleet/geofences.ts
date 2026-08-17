// Geofence reading against a caller-supplied client, so the scheduled
// tick can load them with the service role. lib/supabase/geofences.ts
// keeps the session-scoped server action that pages call.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeofenceRecord } from "@/lib/supabase/geofences";

interface GeofenceRow {
  id: string;
  name: string;
  kind: "factory" | "site";
  site_id: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  polygon_geojson: string | null;
}

function geojsonToRing(geojson: string | null): [number, number][] | null {
  if (!geojson) return null;
  const parsed = JSON.parse(geojson) as { type: string; coordinates: [number, number][][] };
  if (parsed.type !== "Polygon") return null;
  // GeoJSON coordinates are [lng, lat]; this codebase uses [lat, lng].
  return parsed.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]);
}

export function rowsToGeofences(rows: GeofenceRow[]): GeofenceRecord[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    siteId: row.site_id,
    ring: geojsonToRing(row.polygon_geojson),
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    radiusMeters: row.radius_meters,
  }));
}

export async function loadGeofences(
  supabase: SupabaseClient
): Promise<{ data: GeofenceRecord[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_geofences_geojson");
  if (error) return { data: [], error: error.message };
  return { data: rowsToGeofences((data ?? []) as GeofenceRow[]), error: null };
}
