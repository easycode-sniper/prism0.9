// Minimal KML parser — extracts named Polygon placemarks only (what the
// Wialon zone export uses). No XML library needed: KML's structure is
// predictable enough for a targeted regex/string scan, and this avoids
// pulling in a DOM parser that isn't available in the server runtime.

export interface KmlPolygonZone {
  name: string;
  // [lat, lng] ring, matching the [lat, lng] convention used elsewhere
  // in this codebase (route_geometry, geometry/index.ts).
  ring: [number, number][];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripCdata(text: string): string {
  const match = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return match ? match[1] : text;
}

export function parseKmlPolygons(kmlText: string): KmlPolygonZone[] {
  const zones: KmlPolygonZone[] = [];
  const placemarkRe = /<Placemark\b[\s\S]*?<\/Placemark>/g;
  const placemarks = kmlText.match(placemarkRe) ?? [];

  for (const placemark of placemarks) {
    const nameMatch = placemark.match(/<name>([\s\S]*?)<\/name>/);
    if (!nameMatch) continue;
    const name = decodeEntities(stripCdata(nameMatch[1])).trim();
    if (!name) continue;

    const coordsMatch = placemark.match(
      /<Polygon\b[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/
    );
    if (!coordsMatch) continue;

    const raw = decodeEntities(coordsMatch[1]).trim();
    const ring: [number, number][] = raw
      .split(/\s+/)
      .filter(Boolean)
      .map((triplet) => {
        const [lng, lat] = triplet.split(",").map(Number);
        return [lat, lng] as [number, number];
      })
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    if (ring.length >= 3) {
      zones.push({ name, ring });
    }
  }

  return zones;
}

// Normalizes a name for fuzzy matching: uppercase, strip accents and
// punctuation, collapse whitespace. Matches the kind of copy-paste/export
// noise seen in the real Wialon zone names (extra spaces, accents, dashes).
export function normalizeZoneName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export interface ZoneMatchResult {
  zoneName: string;
  ring: [number, number][];
  matchedSiteId: string | null;
  matchedSiteName: string | null;
}

// Matches parsed KML zones against known construction sites by normalized
// name. Exact match first, then a token-overlap fuzzy match — needed
// because the real Wialon export mixes in 500+ zones, most stale or
// belonging to other companies, and names rarely match byte-for-byte.
export function matchZonesToSites(
  zones: KmlPolygonZone[],
  sites: { id: string; name: string }[]
): ZoneMatchResult[] {
  const normalizedSites = sites.map((s) => ({
    ...s,
    normalized: normalizeZoneName(s.name),
    tokens: new Set(normalizeZoneName(s.name).split(" ").filter((t) => t.length > 2)),
  }));

  return zones.map((zone) => {
    const zoneNormalized = normalizeZoneName(zone.name);

    const exact = normalizedSites.find((s) => s.normalized === zoneNormalized);
    if (exact) {
      return { zoneName: zone.name, ring: zone.ring, matchedSiteId: exact.id, matchedSiteName: exact.name };
    }

    const zoneTokens = new Set(zoneNormalized.split(" ").filter((t) => t.length > 2));
    let best: { id: string; name: string } | null = null;
    let bestScore = 0;

    for (const site of normalizedSites) {
      if (site.tokens.size === 0 || zoneTokens.size === 0) continue;
      let overlap = 0;
      for (const t of zoneTokens) if (site.tokens.has(t)) overlap++;
      const score = overlap / Math.max(site.tokens.size, zoneTokens.size);
      if (score > bestScore) {
        bestScore = score;
        best = site;
      }
    }

    // Require a solid majority-token overlap before accepting a fuzzy
    // match — this is the filter that keeps stale/other-company zones
    // (e.g. "LAFARGE") out of the result.
    if (best && bestScore >= 0.6) {
      return { zoneName: zone.name, ring: zone.ring, matchedSiteId: best.id, matchedSiteName: best.name };
    }

    return { zoneName: zone.name, ring: zone.ring, matchedSiteId: null, matchedSiteName: null };
  });
}
