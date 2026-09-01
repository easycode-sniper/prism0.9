// Which drawn client site a point falls in.
//
// Its own module, and it imports geometry by RELATIVE path rather than
// through the "@/" alias, for one reason: scripts/check-site-zones.mts
// runs under `node --experimental-strip-types`, which does not resolve
// tsconfig path aliases. Pulling this out of positionCheck.ts — whose
// import chain is full of aliases — is what makes the logic testable at
// all. Same shape as geometry/index.ts and kml/geofenceKml.ts, the
// other two modules the check scripts reach into.

import { haversineMeters, pointInPolygon } from "../geometry/index.ts";

/** A client site's drawn polygon, as runSiteZoneCheck needs it. */
export interface SiteZone {
  /** construction_sites.id — what the visit row and the flag record.
   *  Not the geofence's own id: the report groups by site, and a site
   *  redrawn in Wialon gets a new geofence row for the same site. */
  siteId: string;
  name: string;
  ring: [number, number][];
}

/** The same zone with its bounding box and centroid worked out once,
 *  rather than 40 times a tick. See siteZoneAt. */
export interface BoundedSiteZone extends SiteZone {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  centroidLat: number;
  centroidLng: number;
}

export function boundSiteZone(zone: SiteZone): BoundedSiteZone {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  let sumLat = 0, sumLng = 0;
  for (const [lat, lng] of zone.ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    sumLat += lat;
    sumLng += lng;
  }
  return {
    ...zone,
    minLat, maxLat, minLng, maxLng,
    // Vertex mean, not the true area centroid. It is only ever used to
    // break a tie between two polygons that BOTH contain the truck, so
    // it needs to be stable and cheap, not exact.
    centroidLat: sumLat / zone.ring.length,
    centroidLng: sumLng / zone.ring.length,
  };
}

/**
 * Which drawn site a point is in, or null.
 *
 * Pure, so scripts/check-site-zones.mts can hold it against PostGIS on
 * real polygons — Rapport Geo's client rows are built entirely on this
 * answer and PostGIS never evaluates it at tick time, so a disagreement
 * would surface as missing rows and wrong durations rather than as an
 * error.
 *
 * THE BOUNDING BOX IS AN OPTIMISATION AND MUST NOT CHANGE THE ANSWER.
 * 112 polygons against ~40 trucks is 4,480 ray casts a minute, and a
 * Wialon ring can carry hundreds of vertices, so a point outside a
 * zone's box skips the cast entirely. A box is by construction at least
 * as large as the ring inside it, so rejecting on it can only discard
 * points the ray cast would also have rejected — the check script pins
 * that by running every point both ways rather than trusting the
 * argument.
 *
 * STRICT CONTAINMENT, no edge buffer. That is a deliberate disagreement
 * with the dispatch-scoped arrival check, which buffers by 150m. They
 * answer different questions: "has it arrived?" is an alert, where a
 * generous buffer costs nothing, and "how long was it there?" is a
 * measurement, where 039 showed a 50m buffer turning a 3½-hour queue
 * into loading time. The owner reads this table against Wialon's own
 * zone report, which uses strict containment, so strict is also the
 * only way the two can agree.
 */
export function siteZoneAt(
  lat: number,
  lng: number,
  zones: BoundedSiteZone[]
): BoundedSiteZone | null {
  let best: { zone: BoundedSiteZone; metres: number } | null = null;
  for (const z of zones) {
    if (lat < z.minLat || lat > z.maxLat || lng < z.minLng || lng > z.maxLng) continue;
    if (z.ring.length < 3) continue;
    if (!pointInPolygon([lat, lng], z.ring)) continue;
    // Nearest centroid wins when two polygons genuinely overlap, so the
    // answer cannot depend on row order. Not theoretical: the two CSCEC
    // Boudouaou sites are 40m apart, close enough that whoever drew
    // them may well have overlapped them.
    const metres = haversineMeters(lat, lng, z.centroidLat, z.centroidLng);
    if (!best || metres < best.metres) best = { zone: z, metres };
  }
  return best?.zone ?? null;
}
