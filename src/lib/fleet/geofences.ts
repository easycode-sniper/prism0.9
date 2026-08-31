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

/**
 * The factory geofence that "arrived at the factory" is tested against.
 *
 * The plant has TWO zones drawn in Wialon and they do not mean the same
 * thing. "Zone d'attente" is the waiting area — 4.2 km², where trucks
 * queue. "Zone chargement" sits inside it and is where they actually
 * take on cement.
 *
 * ARRIVAL IS THE WAITING AREA. A truck that reaches the plant and joins
 * the queue has arrived, and that is the moment a dispatch gets created
 * — the whole reason this check runs fleet-wide rather than per
 * dispatch. Testing the loading bay instead would fire late, and not at
 * all for a truck that queues and leaves without loading.
 *
 * So there is meant to be exactly one kind='factory' row and it is meant
 * to be the waiting area. This exists because the previous `find()` over
 * two rows would have picked whichever the RPC happened to return first:
 * no error, no warning, and an alert that quietly changes meaning. The
 * pick is by id so it is at least stable, and the second row is
 * reported rather than swallowed — the loading bay belongs to a
 * separate check with its own flag, not to this one.
 */
export function selectFactoryGeofence(geofences: GeofenceRecord[]): {
  factory: GeofenceRecord | null;
  warning: string | null;
} {
  const factories = geofences
    .filter((g) => g.kind === "factory")
    .sort((a, b) => a.id.localeCompare(b.id));

  if (factories.length === 0) return { factory: null, warning: null };
  if (factories.length === 1) return { factory: factories[0], warning: null };

  return {
    factory: factories[0],
    warning:
      `${factories.length} factory geofences exist (${factories.map((f) => f.name).join(", ")}); ` +
      `arrival is being tested against "${factories[0].name}". Only the waiting area belongs here — ` +
      `the loading bay needs its own kind and flag, not a second 'factory' row.`,
  };
}

export async function loadGeofences(
  supabase: SupabaseClient
): Promise<{ data: GeofenceRecord[]; error: string | null }> {
  const { data, error } = await supabase.rpc("get_geofences_geojson");
  if (error) return { data: [], error: error.message };
  return { data: rowsToGeofences((data ?? []) as GeofenceRow[]), error: null };
}
