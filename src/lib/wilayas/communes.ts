// Algerian communes: the layer under the wilayas.
//
// VENDORED DATA. The 1,540 rows below come from
// github.com/kossa/algerian-cities (MIT), converted on 2026-09-18 to
// compact tuples — [name_fr, name_ar, post_code, wilaya_code, lat, lng]
// — and sorted by wilaya then name. One source row was dropped:
// "Tessala" (Mila), whose coordinates pointed at the Atlantic; its
// neighbours cover the ground for nearest-matching.
//
// THE SAME HONESTY AS THE WILAYA TABLE: these are commune CENTROIDS.
// Nearest-centroid is a good answer in the dense north where communes
// are a few km across, and coarser in the south where one commune can
// be the size of a country. It names a place; it does not survey a
// boundary. Real boundaries still want PostGIS polygons.

// Relative ".ts", not "@/": bare node cannot resolve tsconfig paths.
// Same reason freshness.ts and the wilaya table spell theirs this way.
import { communeTuples } from "./communes-data.ts";
import { getWilayaByCode, type Wilaya } from "./index.ts";

// [name_fr, name_ar, post_code, wilaya_code, lat, lng] — see above.
type CommuneTuple = [string, string, string, string, number, number];

const communes = communeTuples;

export interface NearestCommune {
  name: string;
  nameAr: string;
  postCode: string;
  wilaya: Wilaya;
  distanceKm: number;
}

/** The commune whose centre is nearest to the point. A linear scan over
 *  1,540 rows is microseconds; the only cost here is the chunk of data
 *  itself, which is why this module exists apart from the wilaya table
 *  and is imported dynamically where it is used. */
export function nearestCommune(lat: number, lng: number): NearestCommune | null {
  let best: { index: number; distanceKm: number } | null = null;
  for (let i = 0; i < communes.length; i++) {
    const [, , , , cLat, cLng] = communes[i];
    const dLat = (cLat - lat) * 110.574;
    const dLng = (cLng - lng) * 111.32 * Math.cos((lat * Math.PI) / 180);
    const distanceKm = Math.sqrt(dLat * dLat + dLng * dLng);
    if (!best || distanceKm < best.distanceKm) best = { index: i, distanceKm };
  }
  if (!best) return null;

  const [name, nameAr, postCode, wilayaCode] = communes[best.index];
  // Every commune's wilaya code exists in the 58-row table; the guard
  // is for TypeScript, not for doubt.
  const wilaya = getWilayaByCode(wilayaCode);
  if (!wilaya) return null;

  return { name, nameAr, postCode, wilaya, distanceKm: best.distanceKm };
}

/** How many rows made it through the conversion. Exported for the check
 *  scripts; a number that is not ~1540 means the vendored file was
 *  truncated or double-loaded. */
export const COMMUNE_COUNT = communes.length;
