"use server";

import { createClient } from "@/lib/supabase/server";

/** 'factory' is the plant's WAITING AREA and 'factory_loading' the
 *  loading bay inside it. They are separate kinds rather than two
 *  'factory' rows because only the first one means "arrived at the
 *  plant" — see selectFactoryGeofence in lib/fleet/geofences.ts. */
export type GeofenceKind = "factory" | "factory_loading" | "site";

export interface GeofenceRecord {
  id: string;
  name: string;
  kind: GeofenceKind;
  siteId: string | null;
  ring: [number, number][] | null; // [lat, lng]
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
}

interface GeofenceRow {
  id: string;
  name: string;
  kind: GeofenceKind;
  site_id: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  polygon_geojson: string | null;
}

function geojsonToRing(geojson: string | null): [number, number][] | null {
  if (!geojson) return null;
  // Guarded because this runs inside a .map over every geofence: an
  // unparseable polygon used to throw out of listGeofences entirely, so
  // one bad row cost the caller ALL geofences — and the caller reads a
  // missing geofence as "no truck is anywhere", which is a wrong answer
  // rather than a visible failure.
  try {
    const parsed = JSON.parse(geojson) as { type: string; coordinates: [number, number][][] };
    if (parsed.type !== "Polygon") return null;
    if (!Array.isArray(parsed.coordinates?.[0])) return null;
    // GeoJSON coordinates are [lng, lat]; this codebase uses [lat, lng].
    return parsed.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]);
  } catch (err) {
    console.error("[listGeofences] unparseable polygon, treated as circle-or-nothing:", err);
    return null;
  }
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
