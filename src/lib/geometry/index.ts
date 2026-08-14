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

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}
