"use server";

import { createClient } from "@/lib/supabase/server";
import { parseKmlPolygons, matchZonesToSites, type ZoneMatchResult } from "@/lib/kml";

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

export interface KmlUploadReport {
  matched: { zoneName: string; siteName: string }[];
  unmatched: { zoneName: string }[];
}

export async function uploadKmlZones(
  kmlText: string
): Promise<{ report?: KmlUploadReport; error?: string }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.data.user.id)
    .single();
  if (profile?.role !== "admin") return { error: "Only admins can upload geofences" };

  const zones = parseKmlPolygons(kmlText);
  if (zones.length === 0) return { error: "No polygon placemarks found in this KML file" };

  const { data: sites, error: sitesError } = await supabase
    .from("construction_sites")
    .select("id, name");
  if (sitesError) return { error: sitesError.message };

  const matches: ZoneMatchResult[] = matchZonesToSites(zones, sites ?? []);

  const report: KmlUploadReport = { matched: [], unmatched: [] };

  for (const match of matches) {
    if (!match.matchedSiteId || !match.matchedSiteName) {
      report.unmatched.push({ zoneName: match.zoneName });
      continue;
    }

    const ring = [...match.ring];
    const [firstLat, firstLng] = ring[0];
    const [lastLat, lastLng] = ring[ring.length - 1];
    if (firstLat !== lastLat || firstLng !== lastLng) ring.push([firstLat, firstLng]);

    const wkt = `POLYGON((${ring.map(([lat, lng]) => `${lng} ${lat}`).join(", ")}))`;
    const { error: upsertError } = await supabase.rpc("upsert_site_geofence", {
      p_site_id: match.matchedSiteId,
      p_name: match.zoneName,
      p_polygon_wkt: wkt,
      p_created_by: user.data.user.id,
    });

    if (upsertError) {
      report.unmatched.push({ zoneName: match.zoneName });
      continue;
    }

    report.matched.push({ zoneName: match.zoneName, siteName: match.matchedSiteName });
  }

  return { report };
}
