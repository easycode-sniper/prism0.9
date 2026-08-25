"use server";

import { createClient } from "@/lib/supabase/server";

export interface GeofenceRecord {
  id: string;
  name: string;
  kind: "factory" | "site";
  siteId: string | null;
  ring: [number, number][] | null; // [lat, lng]
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
}

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

export async function listGeofences(): Promise<{ data: GeofenceRecord[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_geofences_geojson");
  if (error) return { data: [], error: error.message };

  const records = ((data ?? []) as GeofenceRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    siteId: row.site_id,
    ring: geojsonToRing(row.polygon_geojson),
    centerLat: row.center_lat,
    centerLng: row.center_lng,
    radiusMeters: row.radius_meters,
  }));

  return { data: records, error: null };
}
