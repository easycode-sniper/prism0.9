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
 *   - and the names turn out not to need fuzzy matching at all. Wialon's
 *     zones for this line are named
 *         CIMENTRIE AMOUDA - CLIENT <our exact client name>
 *     so after stripping the prefix the remainder equals
 *     construction_sites.client verbatim.
 *
 * That prefix is also the factory filter. Lafarge runs three plants and
 * only the Amouda (western) line is in scope; a zone without the prefix
 * is either another plant's, a driver's home — the list is full of those,
 * flagged so dispatchers know where not to go — or stale.
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
}

export type MatchKind =
  /** Prefixed and the remainder equals a client name exactly. */
  | "client"
  /** Prefixed, but the remainder matches no client we hold. */
  | "amouda-unknown"
  /** Not prefixed, and the name is a known driver — a home marker. */
  | "driver"
  /** Not prefixed and not a driver. Another plant, or stale. */
  | "other";

export interface ZoneMatch {
  zone: ParsedZone;
  kind: MatchKind;
  site: ClientSite | null;
}

const key = (s: string) => collapse(s).toLowerCase();

/**
 * Classify every zone. Nothing is written and nothing is guessed: a zone
 * only becomes importable when the prefix is present AND the remainder
 * is a client we already hold, so an unrecognised name lands in review
 * rather than in the database.
 *
 * Driver names are checked only for LABELLING — they are already
 * excluded by having no prefix. It is worth naming them anyway so the
 * review list can say "402 driver homes" instead of "402 unknown".
 * Verified safe on the live data: zero of the 92 driver names collide
 * with any of the 115 client names, at full name or surname.
 */
export function matchZones(
  zones: ParsedZone[],
  sites: ClientSite[],
  driverNames: string[]
): ZoneMatch[] {
  const byClient = new Map<string, ClientSite>();
  for (const s of sites) if (!byClient.has(key(s.client))) byClient.set(key(s.client), s);
  const drivers = new Set(driverNames.map(key));

  return zones.map((zone) => {
    if (AMOUDA_PREFIX.test(zone.name)) {
      const remainder = zone.name.replace(AMOUDA_PREFIX, "");
      const site = byClient.get(key(remainder)) ?? null;
      return { zone, kind: site ? "client" : "amouda-unknown", site };
    }
    if (drivers.has(key(zone.name))) return { zone, kind: "driver", site: null };
    return { zone, kind: "other", site: null };
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
