// The geofence row shape and its decoding, shared by both readers.
//
// There are two callers with different clients: lib/supabase/geofences.ts
// reads them session-scoped for the pages, and lib/fleet/geofences.ts
// reads them with the service role for the scheduled tick. They had a
// copy of this decoding each, and the copies had drifted — the guard
// below was added to the session-scoped one after an unparseable polygon
// took out a whole read, and never reached the tick's copy. Keeping one
// copy is what stops that happening again.
//
// This file is deliberately NOT "use server": it exports plain values,
// which a "use server" module may not do (see check-server-actions.mts).

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

export interface GeofenceRow {
  id: string;
  name: string;
  kind: GeofenceKind;
  site_id: string | null;
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  polygon_geojson: string | null;
}

export function geojsonToRing(geojson: string | null): [number, number][] | null {
  if (!geojson) return null;
  // Guarded because this runs inside a .map over every geofence: an
  // unparseable polygon used to throw out of the read entirely, so one
  // bad row cost the caller ALL geofences — and the caller reads a
  // missing geofence as "no truck is anywhere", which is a wrong answer
  // rather than a visible failure.
  try {
    const parsed = JSON.parse(geojson) as { type: string; coordinates: [number, number][][] };
    if (parsed.type !== "Polygon") return null;
    if (!Array.isArray(parsed.coordinates?.[0])) return null;
    // GeoJSON coordinates are [lng, lat]; this codebase uses [lat, lng].
    return parsed.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]);
  } catch (err) {
    console.error("[geofences] unparseable polygon, treated as circle-or-nothing:", err);
    return null;
  }
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
