// Does the TypeScript site-zone test agree with PostGIS on real polygons?
//
//   node --experimental-strip-types scripts/check-site-zones.mts
//
// Rapport Geo's client rows are built entirely on siteZoneAt — PostGIS
// draws the 111 site polygons but never evaluates them at tick time —
// so a disagreement between the two shows up as missing rows and wrong
// durations rather than as an error. Exactly the risk
// check-factory-zones.mts was written for, one zone kind along.
//
// Two things are under test and only the first is shared with the
// factory script:
//
//   1. The ray cast itself, against ST_Contains on real rings.
//   2. THE BOUNDING BOX, which is new here and is the part that can
//      silently lose a visit. siteZoneAt skips the cast when a point
//      falls outside a zone's box, because 112 polygons against ~40
//      trucks is 4,480 casts a minute. A box is by construction at
//      least as large as the ring inside it, so the optimisation should
//      be answer-preserving — this pins that rather than trusting the
//      argument, by running every point BOTH ways and comparing.
//
// The three zones below are real, taken from public.geofences and
// rounded to 6dp (~11cm). The 33 points are their centroids and their
// vertices nudged 2% in and 2% out along the centroid axis: the middle
// of a zone agrees trivially, the edge is where a ray-casting bug or a
// lat/lng flip actually shows. `inside` is PostGIS's own ST_Contains
// verdict, not this code's.

import { pointInPolygon } from "../src/lib/geometry/index.ts";
import { boundSiteZone, siteZoneAt, type SiteZone } from "../src/lib/fleet/siteZones.ts";

const ZONES: SiteZone[] = [
  {
    siteId: "adrar",
    name: "A81 ADRAR",
    ring: [
      [28.005334, -0.271729], [28.004832, -0.269648], [28.002615, -0.270609],
      [28.003251, -0.272807], [28.005334, -0.271729],
    ],
  },
  {
    siteId: "tiaret",
    name: "ABRAJ INJAZ, TIARET",
    ring: [
      [35.383306, 1.364012], [35.379903, 1.363916], [35.379544, 1.368465],
      [35.383043, 1.368143], [35.383306, 1.364012],
    ],
  },
  {
    siteId: "mostaganem",
    name: "ABRAJ MOSTAGANEM",
    ring: [
      [35.742767, -0.057360], [35.741975, -0.055225], [35.740146, -0.056309],
      [35.741043, -0.058454], [35.742767, -0.057360],
    ],
  },
];

/** [siteId the point belongs to, lat, lng, PostGIS ST_Contains]. */
type Row = [string, number, number, boolean];

const POINTS: Row[] = [
  ["adrar", 28.003993, -0.271197, true],
  ["adrar", 28.002643, -0.270621, true],
  ["adrar", 28.003266, -0.272775, true],
  ["adrar", 28.004815, -0.269679, true],
  ["adrar", 28.005307, -0.271718, true],
  ["adrar", 28.002587, -0.270597, false],
  ["adrar", 28.003236, -0.272839, false],
  ["adrar", 28.004849, -0.269617, false],
  ["adrar", 28.005361, -0.271740, false],
  ["tiaret", 35.381421, 1.366142, true],
  ["tiaret", 35.379582, 1.368419, true],
  ["tiaret", 35.379933, 1.363961, true],
  ["tiaret", 35.383011, 1.368103, true],
  ["tiaret", 35.383268, 1.364055, true],
  ["tiaret", 35.379506, 1.368511, false],
  ["tiaret", 35.379873, 1.363871, false],
  ["tiaret", 35.383075, 1.368183, false],
  ["tiaret", 35.383344, 1.363969, false],
  ["mostaganem", 35.741475, -0.056831, true],
  ["mostaganem", 35.740173, -0.056319, true],
  ["mostaganem", 35.741052, -0.058422, true],
  ["mostaganem", 35.741965, -0.055257, true],
  ["mostaganem", 35.742741, -0.057349, true],
  ["mostaganem", 35.740119, -0.056299, false],
  ["mostaganem", 35.741034, -0.058486, false],
  ["mostaganem", 35.741985, -0.055193, false],
  ["mostaganem", 35.742793, -0.057371, false],
];

const bounded = ZONES.map(boundSiteZone);
const ringOf = new Map(ZONES.map((z) => [z.siteId, z.ring]));

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) return;
  failures++;
  console.error(`  FAIL ${name}: ${detail}`);
}

// ── 1. The ray cast against PostGIS ───────────────────────────
for (const [siteId, lat, lng, expected] of POINTS) {
  const got = pointInPolygon([lat, lng], ringOf.get(siteId)!);
  check(
    `pointInPolygon ${siteId} ${lat},${lng}`,
    got === expected,
    `PostGIS says ${expected}, pointInPolygon says ${got}`
  );
}

// ── 2. The bounding box must not change the answer ────────────
//
// Run every point through siteZoneAt (box + cast) and through a plain
// cast over all three zones, and require the same verdict. A box that
// wrongly excludes a point makes a truck's visit vanish with nothing to
// explain it.
for (const [siteId, lat, lng] of POINTS) {
  const viaBox = siteZoneAt(lat, lng, bounded)?.siteId ?? null;

  let viaCast: string | null = null;
  for (const z of ZONES) {
    if (pointInPolygon([lat, lng], z.ring)) { viaCast = z.siteId; break; }
  }

  check(
    `bbox-preserves-answer ${siteId} ${lat},${lng}`,
    viaBox === viaCast,
    `box path says ${viaBox}, plain cast says ${viaCast}`
  );
}

// ── 3. The right zone, not merely a zone ──────────────────────
//
// All three sites are hundreds of kilometres apart, so a point inside
// one must never be attributed to another. This is what catches a
// lat/lng flip that happens to land inside some other ring: Algerian
// sites flipped land in the Gulf of Guinea, but a flipped point tested
// against a flipped ring can still agree with itself.
for (const [siteId, lat, lng, expected] of POINTS) {
  const got = siteZoneAt(lat, lng, bounded);
  check(
    `attributes-correctly ${siteId} ${lat},${lng}`,
    expected ? got?.siteId === siteId : got === null,
    `expected ${expected ? siteId : "null"}, got ${got?.siteId ?? "null"}`
  );
}

// ── 4. Overlap is broken by distance, not by row order ────────
//
// The two CSCEC Boudouaou sites are 40m apart. Two squares sharing a
// corner stand in for that here: a point in the shared region must
// resolve to the same zone whichever order the zones arrive in, which
// is what stops the report changing when a geofence row is re-inserted.
const OVERLAP_A: SiteZone = {
  siteId: "a",
  name: "A",
  ring: [[36.700, 3.430], [36.702, 3.430], [36.702, 3.432], [36.700, 3.432]],
};
const OVERLAP_B: SiteZone = {
  siteId: "b",
  name: "B",
  ring: [[36.7015, 3.4315], [36.7035, 3.4315], [36.7035, 3.4335], [36.7015, 3.4335]],
};
// Inside both, but nearer B's centroid.
const shared: [number, number] = [36.70185, 3.43185];
const forward = siteZoneAt(shared[0], shared[1], [OVERLAP_A, OVERLAP_B].map(boundSiteZone));
const reversed = siteZoneAt(shared[0], shared[1], [OVERLAP_B, OVERLAP_A].map(boundSiteZone));
check(
  "overlap-is-order-independent",
  forward?.siteId === reversed?.siteId && forward != null,
  `forward ${forward?.siteId ?? "null"}, reversed ${reversed?.siteId ?? "null"}`
);
check(
  "overlap-picks-nearest-centroid",
  forward?.siteId === "b",
  `expected b (nearer centroid), got ${forward?.siteId ?? "null"}`
);

// ── 5. A degenerate ring is not a zone ────────────────────────
//
// runSiteZoneCheck filters rings shorter than 3 points before it gets
// here, but siteZoneAt is exported and a two-point ring must not read
// as containing anything rather than throwing.
const degenerate = siteZoneAt(28.003993, -0.271197, [
  boundSiteZone({ siteId: "line", name: "line", ring: [[28.0, -0.27], [28.01, -0.27]] }),
]);
check("degenerate-ring-contains-nothing", degenerate === null, `got ${degenerate?.siteId ?? "null"}`);

console.log(
  failures === 0
    ? `check-site-zones: all ${POINTS.length * 3 + 4} checks passed`
    : `check-site-zones: ${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
