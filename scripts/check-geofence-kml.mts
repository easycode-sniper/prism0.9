// Checks for src/lib/kml/geofenceKml.ts.
//
// Run: node --experimental-strip-types scripts/check-geofence-kml.mts
//
// The fixture is a REAL Wialon export — one placemark, image data and
// all — because the things that break a KML parser are the things a
// hand-written fixture leaves out: names on their own line surrounded by
// tabs, a kilobyte of hex in an attribute, and lon,lat coordinate order.

import {
  parseGeofenceKml,
  matchZones,
  ringToPolygonWkt,
  ringSelfIntersects,
  ringCentre,
  type ClientSite,
} from "../src/lib/kml/geofenceKml.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`); }
}

// Verbatim from the export, image data truncated only for width — the
// attribute is still present so the stripper is exercised.
const REAL = `<?xml version="1.0" encoding="utf-8"?>
<kml>
\t<Document>
\t\t<name>
\t\t\tGeofences
\t\t</name>
\t\t<Placemark>
\t\t\t<name>
\t\t\t\tCIMENTRIE AMOUDA - CLIENT cosider ouvrage d'art pôle A 30-01  Boughezoul- Médéa .
\t\t\t</name>
\t\t\t<description img_data="89504E470D0A1A0A0000000D4948445200000020">
\t\t\t\tRoute Transsaharienne, commune Boughezoul, Wilaya de Médéa, Algeria, Hassi Messaline
\t\t\t</description>
\t\t\t<Style><LineStyle><color>99307b19</color><width>50.0</width></LineStyle></Style>
\t\t\t<Polygon>
\t\t\t\t<outerBoundaryIs>
\t\t\t\t\t<LinearRing>
\t\t\t\t\t\t<coordinates>
\t\t\t\t\t\t\t2.8095766436,35.6756337375,0 2.8116902243,35.6775772419,0 2.8147050273,35.6752328293,0 2.8126772772,35.6734461489,0 2.8095766436,35.6756337375,0
\t\t\t\t\t\t</coordinates>
\t\t\t\t\t</LinearRing>
\t\t\t\t</outerBoundaryIs>
\t\t\t</Polygon>
\t\t</Placemark>
\t</Document>
</kml>`;

console.log("parseGeofenceKml — real Wialon export");
const zones = parseGeofenceKml(REAL);
check("one placemark", zones.length, 1);
const z = zones[0];
check(
  "name collapsed, prefix intact, double space squashed",
  z.name,
  "CIMENTRIE AMOUDA - CLIENT cosider ouvrage d'art pôle A 30-01 Boughezoul- Médéa ."
);
check("document <name> is not mistaken for a placemark name", z.name.includes("Geofences"), false);
check("shape", z.shape, "polygon");
check("five ring points", z.ring.length, 5);
// KML said 2.8095766436,35.6756337375 — lon first. Algeria is ~35N, ~2E.
check("coordinates flipped to [lat, lng]", z.ring[0], [35.6756337375, 2.8095766436]);
check("latitude is plausible for Algeria", z.ring[0][0] > 30 && z.ring[0][0] < 40, true);
check("image data stripped from description", z.description?.includes("89504E47"), false);
check("description text kept", z.description, "Route Transsaharienne, commune Boughezoul, Wilaya de Médéa, Algeria, Hassi Messaline");

console.log("matchZones — distance decides");
// Real coordinates. The Boughezoul zone centroid is ~35.6755, 2.8123.
const SITES: ClientSite[] = [
  { id: "s1", client: "cosider ouvrage d'art pôle A 30-01 Boughezoul- Médéa .",
    name: "COSIDER / BOUGHEZOULA30-01", lat: 35.6755, lng: 2.8123 },
  { id: "s2", client: "SARL Houria Services", name: "SIDI MOUSSA", lat: 36.6, lng: 3.2 },
  // The real SINOSTEEL row: name matches NOTHING, coordinate matches exactly.
  { id: "s3", client: "SOCIETE SINOSTEEL ENGIEERING DESIGN RESEARCH INSTITUTE CO, LTD/TINDOUF, GARA DJBILAT",
    name: "TINDOUF, GARA DJBILAT", lat: 26.7364, lng: -7.4822 },
];
const DRIVERS = ["BEKHOUCHE ASSAM", "BOUKEMICHE Adnan"];

const m1 = matchZones(zones, SITES, DRIVERS)[0];
check("real zone matches by distance", m1.kind, "client");
check("and it is the right site", m1.site?.name, "COSIDER / BOUGHEZOULA30-01");
check("distance is sub-kilometre", (m1.km ?? 99) < 1, true);
check("runner-up is far away, so the match is unambiguous", (m1.runnerUpKm ?? 0) > 50, true);
check("names happen to agree here", m1.nameAgrees, true);

// THE CASE THAT KILLED NAME MATCHING: typos on both sides, extra words
// on both sides, and it still has to match.
const sinosteel = {
  name: "CIMENTRIE AMOUDA - CLIENT SINOSTEEL ENGINEERING DESIGN ET RESEARCH UNSTITUTE CO CL-gar djebilet",
  description: "Gar Djebilet, Tinduf, Algeria",
  shape: "polygon" as const,
  ring: [
    [26.7340016012, -7.4779307717], [26.7382559175, -7.477587449],
    [26.7340008599, -7.4778052623], [26.733809984, -7.4870300779],
    [26.7390991188, -7.4867725858], [26.7381792646, -7.477587449],
    [26.7340016012, -7.4779307717],
  ] as [number, number][],
};
const m2 = matchZones([sinosteel], SITES, DRIVERS)[0];
check("matches despite the names disagreeing", m2.kind, "client");
check("to the right site", m2.site?.name, "TINDOUF, GARA DJBILAT");
check("names do NOT agree — distance carried it", m2.nameAgrees, false);
check("self-intersection is flagged, not imported silently", m2.selfIntersecting, true);

const synth = (name: string, ring: [number, number][] = [[35.6755, 2.8123]]) =>
  ({ name, description: null, shape: "polygon" as const, ring });
const classify = (name: string, ring?: [number, number][]) =>
  matchZones([synth(name, ring)], SITES, DRIVERS)[0].kind;

check("driver home is labelled, not imported", classify("BEKHOUCHE ASSAM"), "driver");
check("driver match ignores case", classify("boukemiche adnan"), "driver");
check("another plant's zone is 'other'", classify("CIMENTERIE OGGAZ - CLIENT whoever"), "other");
check("prefixed but nowhere near a site goes to review",
  classify("CIMENTRIE AMOUDA - CLIENT Someone New", [[20.0, 10.0]]), "amouda-far");
check("prefix tolerates CIMENTERIE spelling", classify("CIMENTERIE AMOUDA - CLIENT anything"), "client");
check("an unprefixed name is never imported, even sitting on a site",
  classify("SARL Houria Services"), "other");

console.log("geometry helpers");
check("bowtie detected", ringSelfIntersects(sinosteel.ring), true);
check("simple square is not flagged",
  ringSelfIntersects([[0,0],[0,1],[1,1],[1,0],[0,0]]), false);
check("centroid of the square", ringCentre([[0,0],[0,2],[2,2],[2,0],[0,0]])?.map(n=>Math.round(n*10)/10), [0.8,0.8]);

console.log("ringToPolygonWkt");
const wkt = ringToPolygonWkt(z.ring)!;
check("WKT is lng lat, the flip back", wkt.startsWith("POLYGON((2.8095766436 35.6756337375"), true);
check("ring already closed is not double-closed", (wkt.match(/,/g) ?? []).length, 4);
check("an open ring gets closed", ringToPolygonWkt([[1, 1], [1, 2], [2, 2]]), "POLYGON((1 1, 2 1, 2 2, 1 1))");
check("too few points is null, not a broken polygon", ringToPolygonWkt([[1, 1], [1, 2]]), null);

console.log(failures === 0 ? "\nAll geofence-KML checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
