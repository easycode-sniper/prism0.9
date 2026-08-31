// Does the TypeScript zone test agree with PostGIS on real fixes?
//
//   node --experimental-strip-types scripts/check-factory-zones.mts
//
// The factory report is built entirely on isWithinGeofence — PostGIS
// draws the polygons but never evaluates them at tick time — so an
// disagreement between the two would show up as wrong durations rather
// than as an error. These 40 points are real truck fixes from the 24
// hours before the zones went in, chosen because they sit CLOSE TO A
// BOUNDARY: the middle of a zone agrees trivially, the edge is where a
// ray-casting bug or a lat/lng flip actually shows.
//
// Each row is [lat, lng, inBay, metresFromBayEdge, inWaiting,
// metresFromWaitingEdge] with the last four measured by PostGIS.

import { isWithinGeofence, pointInPolygon } from "../src/lib/geometry/index.ts";

// The two zones as the app loads them: [lat, lng], flipped from the
// WKT's lng-lat. Rounded to 6dp (~11cm) from the stored polygons, which
// is far below the 50m buffer under test.
const BAY: [number, number][] = [
  [34.443103, 2.055258], [34.438927, 2.048993], [34.430645, 2.057361],
  [34.434574, 2.063326], [34.443103, 2.055258],
];
const WAITING: [number, number][] = [
  [34.450535, 2.063326], [34.438201, 2.045668], [34.425388, 2.060087],
  [34.437511, 2.078475], [34.450535, 2.063326],
];

// As positionCheck.ts uses them: the waiting area is buffered, the bay
// is strict containment. See THE QUEUE LANE below for why.
const WAITING_BUFFER = 150;
const BAY_BUFFER = 0;

type Row = [number, number, boolean, number, boolean, number];
const FIXES: Row[] = [
  [34.4325183, 2.0602033, true, 0.1, true, 547.2],
  [34.4326033, 2.0603366, false, 0.2, true, 562.6],
  [34.4325866, 2.0603116, false, 0.2, true, 559.6],
  [34.43252, 2.0602116, false, 0.2, true, 547.9],
  [34.4325766, 2.06031, false, 0.9, true, 558.8],
  [34.4325666, 2.060295, false, 1, true, 557],
  [34.4325083, 2.0602099, false, 1.2, true, 546.9],
  [34.4324983, 2.0602099, false, 2, true, 546.1],
  [34.4325133, 2.0601316, true, 3.8, true, 542],
  [34.4352333, 2.0627566, false, 3.9, true, 701.8],
  [34.4324816, 2.0602249, false, 4.3, true, 545.8],
  [34.43521, 2.0627866, false, 4.5, true, 698.1],
  [34.4325599, 2.0601783, true, 5.1, true, 548.6],
  [34.4324849, 2.0602466, false, 5.3, true, 547.6],
  [34.4325866, 2.0602083, true, 5.7, true, 552.7],
  [34.43258, 2.0601966, true, 5.8, true, 551.4],
  [34.432555, 2.0601566, true, 6, true, 546.8],
  [34.4326233, 2.060255, true, 6.3, true, 558.6],
  [34.43258, 2.0601833, true, 6.6, true, 550.5],
  [34.4325866, 2.06019, true, 6.8, true, 551.4],
  [34.4325216, 2.0603316, false, 7, true, 556],
  [34.4325533, 2.0601333, true, 7.1, true, 545.1],
  [34.4411883, 2.0742, false, 1239.8, false, 0.1],
  [34.4411799, 2.0742283, false, 1241.4, false, 1.3],
  [34.4411716, 2.0740616, false, 1228.5, true, 10.4],
  [34.441255, 2.0744133, false, 1260, false, 19.3],
  [34.4413366, 2.07448, false, 1270.3, false, 30],
  [34.4409816, 2.0738833, false, 1202.8, true, 36.8],
  [34.4409883, 2.0738699, false, 1202.2, true, 37.2],
  [34.441435, 2.074505, false, 1278.6, false, 39.2],
  [34.4414199, 2.0745266, false, 1279.2, false, 39.5],
  [34.4409216, 2.0737949, false, 1192.3, true, 47.3],
  [34.4414416, 2.0746416, false, 1289.2, false, 48.8],
  [34.44152, 2.0747866, false, 1305.1, false, 64.4],
  [34.44081, 2.0735783, false, 1168.9, true, 70.2],
  [34.4408183, 2.0734983, false, 1163.6, true, 74.9],
  [34.4417016, 2.074895, false, 1325, false, 85.6],
  [34.4406966, 2.073385, false, 1147.2, true, 91.7],
  [34.44065, 2.0733666, false, 1142.8, true, 96.5],
  [34.4418833, 2.0754433, false, 1377.6, false, 135.8],
];

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  failures++;
  console.error(`  FAIL ${name}\n       expected ${JSON.stringify(expected)}  actual ${JSON.stringify(actual)}`);
}

console.log("pointInPolygon agrees with ST_Contains on 40 near-boundary fixes");
// Knife-edge points are excluded from the raw containment comparison:
// within a metre of the edge the two implementations can legitimately
// disagree, since the ring here is rounded to ~11cm. The buffered test
// below is the one the app actually runs, and it covers them.
let compared = 0;
for (const [lat, lng, inBay, bayEdge, inWait, waitEdge] of FIXES) {
  if (bayEdge > 1) { check(`bay ${lat},${lng}`, pointInPolygon([lat, lng], BAY), inBay); compared++; }
  if (waitEdge > 1) { check(`waiting ${lat},${lng}`, pointInPolygon([lat, lng], WAITING), inWait); compared++; }
}
console.log(`  ${compared} containment comparisons`);

console.log("isWithinGeofence matches inside-or-within-buffer");
for (const [lat, lng, inBay, bayEdge, inWait, waitEdge] of FIXES) {
  check(`bay@${BAY_BUFFER}m ${lat},${lng}`,
    isWithinGeofence([lat, lng], BAY, BAY_BUFFER), inBay || bayEdge <= BAY_BUFFER);
  check(`waiting@${WAITING_BUFFER}m ${lat},${lng}`,
    isWithinGeofence([lat, lng], WAITING, WAITING_BUFFER), inWait || waitEdge <= WAITING_BUFFER);
}

// The bay is drawn inside the waiting area, and the whole report rests
// on that: queue time is the gap between the two entries, which is
// meaningless if a truck can be in the bay without being at the plant.
console.log("the bay is nested inside the waiting area");
for (const [lat, lng] of BAY) {
  check(`bay corner ${lat},${lng} is inside the waiting area`,
    pointInPolygon([lat, lng], WAITING), true);
}

// The single easiest mistake in this file: WKT is "lng lat" and this
// codebase is [lat, lng]. A flip puts Algeria in the Indian Ocean, and
// every zone test would simply return false forever — silently.
console.log("coordinates are [lat, lng], not flipped");
for (const ring of [BAY, WAITING])
  for (const [lat, lng] of ring)
    check(`${lat},${lng} is in Algeria`, lat > 30 && lat < 38 && lng > -1 && lng < 6, true);

// ── THE QUEUE LANE ────────────────────────────────────────────
//
// The regression that matters most, and the one no amount of reasoning
// about the code would have found. Trucks queue at 34.43521, 2.06286 —
// TEN METRES outside the bay boundary — for hours. Any edge buffer at
// all swallows that spot and reports the whole queue as loading.
//
// Measured against the owner's own Wialon report for 00018-523-35 on
// 2026-08-31 (loading 09:50:11 → 10:25:41, 0:35:30, one visit):
//
//   strict      09:51:01 → 10:25:02   0:34:00   1 visit   ✓
//   50m buffer  06:35:02 → 09:13:02   2:38:00   3 visits  ✗
//
// So the assertion is not "the buffer is small enough" but "the queue
// spot is outside the zone", which is the fact the report rests on.
console.log("the queue lane is NOT inside the bay");
const QUEUE_SPOT: [number, number] = [34.43521, 2.06286];
check("a queueing truck is not loading", pointInPolygon(QUEUE_SPOT, BAY), false);
check("but it IS at the plant", pointInPolygon(QUEUE_SPOT, WAITING), true);
check("and any buffer would have swallowed it", isWithinGeofence(QUEUE_SPOT, BAY, 50), true);
check("which is why the bay takes none", isWithinGeofence(QUEUE_SPOT, BAY, BAY_BUFFER), false);

// Two fixes from inside the real loading window, which must still count.
for (const p of [[34.43505, 2.06092], [34.43451, 2.06063]] as [number, number][])
  check(`a truck actually loading at ${p} is inside`, pointInPolygon(p, BAY), true);

console.log(failures === 0 ? "\nAll factory-zone checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
