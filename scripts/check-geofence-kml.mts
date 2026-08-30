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

console.log("matchZones");
const SITES: ClientSite[] = [
  { id: "s1", client: "cosider ouvrage d'art pôle A 30-01 Boughezoul- Médéa .", name: "COSIDER / BOUGHEZOULA30-01" },
  { id: "s2", client: "SARL Houria Services", name: "SIDI MOUSSA" },
];
const DRIVERS = ["BEKHOUCHE ASSAM", "BOUKEMICHE Adnan"];

check("real zone matches its client exactly", matchZones(zones, SITES, DRIVERS)[0].kind, "client");
check("and carries the site", matchZones(zones, SITES, DRIVERS)[0].site?.name, "COSIDER / BOUGHEZOULA30-01");

const synth = (name: string) => ({ name, description: null, shape: "point" as const, ring: [] as [number, number][] });
const classify = (name: string) => matchZones([synth(name)], SITES, DRIVERS)[0].kind;

check("driver home is labelled, not imported", classify("BEKHOUCHE ASSAM"), "driver");
check("driver match ignores case", classify("boukemiche adnan"), "driver");
check("another plant's zone is 'other'", classify("CIMENTERIE OGGAZ - CLIENT whoever"), "other");
check("prefixed but unknown client goes to review", classify("CIMENTRIE AMOUDA - CLIENT Someone New"), "amouda-unknown");
check("prefix tolerates CIMENTERIE spelling", classify("CIMENTERIE AMOUDA - CLIENT SARL Houria Services"), "client");
check("prefix tolerates loose spacing and case", classify("cimentrie amouda-client SARL Houria Services"), "client");
check("an unprefixed client name is NOT imported", classify("SARL Houria Services"), "other");

console.log("ringToPolygonWkt");
const wkt = ringToPolygonWkt(z.ring)!;
check("WKT is lng lat, the flip back", wkt.startsWith("POLYGON((2.8095766436 35.6756337375"), true);
check("ring already closed is not double-closed", (wkt.match(/,/g) ?? []).length, 4);
check("an open ring gets closed", ringToPolygonWkt([[1, 1], [1, 2], [2, 2]]), "POLYGON((1 1, 2 1, 2 2, 1 1))");
check("too few points is null, not a broken polygon", ringToPolygonWkt([[1, 1], [1, 2]]), null);

console.log(failures === 0 ? "\nAll geofence-KML checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
