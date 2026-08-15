"use server";

// Real road routing via the public OSRM demo server — matches what the
// original single-file app used. Free, no API key, but rate-limited and
// not intended for production load per OSRM's own usage policy; revisit
// with a dedicated router if that becomes a real constraint.

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

export interface RouteResult {
  geometry: [number, number][]; // [lat, lng], matching this codebase's convention
  distanceMeters: number;
  durationSeconds: number;
}

export async function fetchRoute(
  from: [number, number],
  to: [number, number]
): Promise<RouteResult | null> {
  try {
    const [fromLat, fromLng] = from;
    const [toLat, toLng] = to;
    const url = `${OSRM_BASE}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;

    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json();
    const route = data?.routes?.[0];
    if (!route?.geometry?.coordinates) return null;

    const geometry: [number, number][] = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => [lat, lng]
    );

    return {
      geometry,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
    };
  } catch {
    return null;
  }
}
