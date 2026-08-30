/**
 * Parse a Wialon geofence KML export and match it to our client sites.
 *
 * There WAS a KML parser here once (lib/kml.ts, removed in 34eacfc). It
 * did a different job: bulk-matching a Wialon zone export against site
 * names, which was judged a worse fit than typing the coordinates that
 * mattered. That judgement was about the effort of exporting and the
 * hopelessness of the matching. Both changed:
 *
 *   - the export is one multi-select, not 500 clicks;
 *   - and there is a signal that makes the matching reliable.
 *
 * That signal is NOT the name, though the first sample suggested it
 * was. One export matched its client character for character; the next
 * did not come close:
 *
 *   zone   SINOSTEEL ENGINEERING DESIGN ET RESEARCH UNSTITUTE CO CL-gar djebilet
 *   client SOCIETE SINOSTEEL ENGIEERING DESIGN RESEARCH INSTITUTE CO, LTD/TINDOUF, GARA DJBILAT
 *
 * Both sides carry typos, in different places (ENGIEERING/ENGINEERING,
 * UNSTITUTE/INSTITUTE, DJBILAT/djebilet), and each adds words the other
 * lacks. No spelling-based rule survives that.
 *
 * GEOGRAPHY DOES. That zone's centroid sits 0.33km from its site's
 * stored coordinate; the next nearest of the 125 sites is 115km away.
 * A 350x separation is not a threshold anyone has to tune. So distance
 * decides, and the name is kept only as corroboration and for the
 * review list to read sensibly.
 *
 * The CIMENTRIE AMOUDA - CLIENT prefix still earns its place as the
 * FACTORY filter. Lafarge runs three plants and only the Amouda
 * (western) line is in scope; a zone without the prefix is another
 * plant's, a driver's home — the list is full of those, flagged so
 * dispatchers know where not to go — or stale.
 */

export type ZoneShape = "polygon" | "line" | "point" | "unknown";

export interface ParsedZone {
  /** Placemark name, whitespace-collapsed. */
  name: string;
  /** The address line Wialon writes into <description>, with its
   *  embedded image data stripped. Null when absent. */
  description: string | null;
  shape: ZoneShape;
  /** [lat, lng] — FLIPPED from KML's lon,lat,alt order. Getting this
   *  backwards puts Algeria in the Indian Ocean, and it is the single
   *  easiest mistake to make here. */
  ring: [number, number][];
}

/** Wialon stamps a base64/hex thumbnail into a `img_data` attribute on
 *  <description>. It is kilobytes per placemark and of no use to us; it
 *  also makes every downstream regex slower and harder to read. */
function stripImageData(xml: string): string {
  return xml.replace(/\s+img_data="[^"]*"/g, "");
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function tagText(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? collapse(m[1]) : null;
}

/**
 * KML coordinates are `lon,lat[,alt]` separated by whitespace. Returned
 * as [lat, lng] to match this codebase's convention everywhere else.
 */
function parseCoordinates(raw: string): [number, number][] {
  const out: [number, number][] = [];
  for (const tuple of raw.trim().split(/\s+/)) {
    if (!tuple) continue;
    const parts = tuple.split(",");
    if (parts.length < 2) continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    // A zone with a bad coordinate is dropped rather than imported at
    // 0,0 — the Gulf of Guinea is a long way from Médéa and a truck
    // would never arrive.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push([lat, lng]);
  }
  return out;
}

export function parseGeofenceKml(xml: string): ParsedZone[] {
  const clean = stripImageData(xml);
  const zones: ParsedZone[] = [];

  for (const m of clean.matchAll(/<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi)) {
    const block = m[1];
    const name = tagText(block, "name");
    if (!name) continue;

    let shape: ZoneShape = "unknown";
    let coordsRaw: string | null = null;

    // Order matters: a Polygon contains a LinearRing which contains the
    // coordinates, so test the outer shapes first.
    if (/<Polygon[\s>]/i.test(block)) {
      shape = "polygon";
      coordsRaw = tagText(block, "coordinates");
    } else if (/<LineString[\s>]/i.test(block)) {
      shape = "line";
      coordsRaw = tagText(block, "coordinates");
    } else if (/<Point[\s>]/i.test(block)) {
      shape = "point";
      coordsRaw = tagText(block, "coordinates");
    } else {
      coordsRaw = tagText(block, "coordinates");
    }

    zones.push({
      name,
      description: tagText(block, "description"),
      shape,
      ring: coordsRaw ? parseCoordinates(coordsRaw) : [],
    });
  }

  return zones;
}

// ── Matching ─────────────────────────────────────────────────

/** The prefix Wialon uses for this line's client zones. Matched loosely
 *  on spacing and case because it is typed by hand in their UI, but the
 *  words themselves have to be there — it is the only thing separating
 *  an Amouda client from another plant's. */
const AMOUDA_PREFIX = /^\s*ciment(?:e)?rie\s+amouda\s*-\s*client\s*/i;

export interface ClientSite {
  id: string;
  client: string;
  name: string;
  lat: number;
  lng: number;
}

export type MatchKind =
  /** Prefixed, and a site sits within the distance threshold. */
  | "client"
  /** Prefixed, but no site is near enough to be sure. Review, do not
   *  import: this is where a genuinely new client lands, and also where
   *  a site whose stored coordinate is wrong would land. */
  | "amouda-far"
  /** Not prefixed, and the name is a known driver — a home marker. */
  | "driver"
  /** Not prefixed and not a driver. Another plant, or stale. */
  | "other";

export interface ZoneMatch {
  zone: ParsedZone;
  kind: MatchKind;
  site: ClientSite | null;
  /** Distance from the zone centroid to the matched site, in km. Null
   *  when nothing was matched. */
  km: number | null;
  /** How far the SECOND nearest site was. A match at 0.3km with the
   *  runner-up at 115km is certain; one at 4km with a runner-up at 5km
   *  is a coin toss and should be reviewed however good the name looks. */
  runnerUpKm: number | null;
  /** True when the names also agree after collapsing whitespace and
   *  case — corroboration, never the deciding vote. */
  nameAgrees: boolean;
  /** The outline crosses itself. PostGIS calls such a polygon invalid
   *  and point-in-polygon on one is unreliable, so it must be repaired
   *  (ST_MakeValid) or rejected rather than imported as-is. Real: one of
   *  the two samples is a bowtie. */
  selfIntersecting: boolean;
}

const key = (s: string) => collapse(s).toLowerCase();

/** Centroid as the mean of the ring's points. Crude for a continent,
 *  exact enough here: these zones are a few hundred metres across, and
 *  the decision they feed is "0.3km or 115km away". */
export function ringCentre(ring: [number, number][]): [number, number] | null {
  if (ring.length === 0) return null;
  const lat = ring.reduce((a, [la]) => a + la, 0) / ring.length;
  const lng = ring.reduce((a, [, ln]) => a + ln, 0) / ring.length;
  return [lat, lng];
}

/** Does the closed ring cross itself? PostGIS calls such a polygon
 *  invalid and point-in-polygon on one is unreliable, so the importer
 *  has to repair or reject rather than trust it. O(n^2) is fine — these
 *  rings have single-digit point counts. */
export function ringSelfIntersects(ring: [number, number][]): boolean {
  // A KML ring repeats its first point to close itself. Left in, the
  // modular wrap below builds a zero-length final segment from that
  // duplicate back to itself, which crosses everything and reported an
  // ordinary square as a bowtie. Drop it and work on the open ring.
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;

  const n = pts.length;
  if (n < 4) return false;
  const seg = (i: number) => [pts[i], pts[(i + 1) % n]] as const;
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Adjacent segments legitimately share an endpoint.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const [p1, p2] = seg(i);
      const [p3, p4] = seg(j);
      const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
      const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Classify every zone. Nothing is written and nothing is guessed.
 *
 * DISTANCE DECIDES, for the reason in the file header: the names carry
 * typos on both sides and no spelling rule survives them, while the
 * geography separates the right answer from the runner-up by two orders
 * of magnitude. A zone is importable only when it carries the Amouda
 * prefix AND a site sits within `maxKm`. Everything else goes to review.
 *
 * `runnerUpKm` is reported alongside because the threshold is not the
 * whole story: a match at 0.3km with the next site 115km off is certain,
 * and one at 4km with the next at 5km is a coin toss that a human should
 * see however plausible the name looks.
 *
 * Driver names are matched only for LABELLING — the missing prefix has
 * already excluded them. Naming them lets the review list say "402
 * driver homes" rather than "402 unknown". Verified safe on live data:
 * zero of the 92 driver names collide with the 115 client names, at
 * full name or surname.
 */
export function matchZones(
  zones: ParsedZone[],
  sites: ClientSite[],
  driverNames: string[],
  opts: { maxKm?: number } = {}
): ZoneMatch[] {
  const maxKm = opts.maxKm ?? 5;
  const drivers = new Set(driverNames.map(key));
  const byClient = new Map<string, ClientSite>();
  for (const s of sites) if (!byClient.has(key(s.client))) byClient.set(key(s.client), s);

  return zones.map((zone) => {
    const selfIntersecting = zone.shape === "polygon" && ringSelfIntersects(zone.ring);
    const base = { zone, site: null, km: null, runnerUpKm: null, nameAgrees: false, selfIntersecting };

    if (!AMOUDA_PREFIX.test(zone.name)) {
      const kind: MatchKind = drivers.has(key(zone.name)) ? "driver" : "other";
      return { ...base, kind };
    }

    const remainder = key(zone.name.replace(AMOUDA_PREFIX, ""));
    const nameAgrees = byClient.has(remainder);

    const centre = ringCentre(zone.ring);
    if (!centre) return { ...base, kind: "amouda-far", nameAgrees };

    const ranked = sites
      .map((s) => ({ s, km: haversineKm(centre, [s.lat, s.lng]) }))
      .sort((a, b) => a.km - b.km);
    const best = ranked[0];
    const runnerUpKm = ranked[1]?.km ?? null;

    if (!best || best.km > maxKm) {
      return { ...base, kind: "amouda-far", nameAgrees, km: best?.km ?? null, runnerUpKm };
    }
    return { zone, kind: "client", site: best.s, km: best.km, runnerUpKm, nameAgrees, selfIntersecting };
  });
}

/**
 * PostGIS WKT for upsert_site_geofence, which takes p_polygon_wkt.
 *
 * WKT is `lng lat`, the opposite of the [lat, lng] we carry, so the flip
 * happens once more on the way out. The ring is closed if the source did
 * not close it — PostGIS rejects an open one.
 */
export function ringToPolygonWkt(ring: [number, number][]): string | null {
  if (ring.length < 3) return null;
  const pts = [...ring];
  const [firstLat, firstLng] = pts[0];
  const [lastLat, lastLng] = pts[pts.length - 1];
  if (firstLat !== lastLat || firstLng !== lastLng) pts.push([firstLat, firstLng]);
  return `POLYGON((${pts.map(([lat, lng]) => `${lng} ${lat}`).join(", ")}))`;
}
