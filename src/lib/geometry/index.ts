const R = 6371000;

function toRad(deg: number): number {
  return deg * Math.PI / 180;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function closestPointOnSegment(p: [number, number], a: [number, number], b: [number, number]): [number, number] {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return a;
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * dx, ay + t * dy];
}

export interface RouteProjection {
  distanceToRoute: number;
  distanceCovered: number;
  totalRouteLength: number;
}

export function projectPointOntoRoute(
  point: [number, number],
  routeLine: [number, number][]
): RouteProjection | null {
  if (!routeLine || routeLine.length < 2) return null;
  let minDist = Infinity;
  let cumulativeAtClosest = 0;
  let cumulative = 0;

  for (let i = 0; i < routeLine.length - 1; i++) {
    const a = routeLine[i];
    const b = routeLine[i + 1];
    const segLen = haversineMeters(a[0], a[1], b[0], b[1]);
    const closest = closestPointOnSegment(point, a, b);
    const d = haversineMeters(point[0], point[1], closest[0], closest[1]);
    if (d < minDist) {
      minDist = d;
      cumulativeAtClosest = cumulative + haversineMeters(a[0], a[1], closest[0], closest[1]);
    }
    cumulative += segLen;
  }

  return { distanceToRoute: minDist, distanceCovered: cumulativeAtClosest, totalRouteLength: cumulative };
}

// Ray casting point-in-polygon. `ring` is a closed or unclosed list of
// [lat, lng] vertices.
export function pointInPolygon(point: [number, number], ring: [number, number][]): boolean {
  const [py, px] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToPolygonBoundaryMeters(point: [number, number], ring: [number, number][]): number {
  let minDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const closest = closestPointOnSegment(point, a, b);
    const d = haversineMeters(point[0], point[1], closest[0], closest[1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// Arrival check against a real geofence polygon: inside counts as arrived,
// and so does being within `edgeBufferMeters` of the boundary (GPS noise
// near the edge shouldn't produce a false negative).
export function isWithinGeofence(
  point: [number, number],
  ring: [number, number][],
  edgeBufferMeters: number
): boolean {
  if (ring.length < 3) return false;
  if (pointInPolygon(point, ring)) return true;
  return distanceToPolygonBoundaryMeters(point, ring) <= edgeBufferMeters;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}
