// Run: node --experimental-strip-types scripts/check-breakdown.mts
//
// The two rail rings: what the fleet's driver variance looks like as a
// whole, and what state the trucks are in.
//
// WHY THIS SCRIPT EXISTS. A ring has no failure mode you can see. A bar
// chart that drops a row draws a shorter bar; a doughnut that drops a
// row draws the SAME ring with the arc quietly resized, and every
// percentage on the panel becomes wrong by an amount nobody can point
// at. So the properties that matter here are not arithmetic — they are
// EXHAUSTIVENESS and ADDITIVITY:
//
//   1. Every state classifyIntel can emit maps to a named band. A new
//      state that nobody added here is a truck that vanishes from the
//      ring while still being listed in the table above it.
//   2. The bands sum to the number of rows. Always, for every input,
//      including the empty list and a list of pure noise.
//   3. A zero band is still PRESENT in the result, because the ring
//      takes its colours from the array index and a missing middle band
//      repaints every slice after it.
//
// The one that is arithmetic — which side of zero a driver falls on —
// is checked too, because it is banded on the raw figure rather than
// the rounded string, and that is a decision rather than an accident.

import { strict as assert } from "node:assert";
import {
  countBands,
  intelBand,
  varianceBand,
  INTEL_BANDS,
  VARIANCE_BANDS,
} from "../src/lib/dashboard/breakdown.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Variance bands ──

check("money saved is the saving band", varianceBand(-31720) === "saving");
check("money lost is the losing band", varianceBand(+31720) === "losing");
check("exactly zero is neither saved nor lost", varianceBand(0) === "atLimit");

// The rounding trap. The table prints whole dinars, so -0.4 DA reads
// "-0 DA" — and banding on the printed string would file this driver
// under "at the limit", inflating the middle slice with drivers who are
// not on it. Banded on the raw figure, they are in `saving`.
check("a fraction under the rate still counts as saving", varianceBand(-0.4) === "saving");
check("a fraction over the rate still counts as losing", varianceBand(0.4) === "losing");

// No rate is not a middle band. Dropping these would make the ring's
// percentages describe a smaller fleet than the roster lists.
check("a driver with no variance is unrated, not at the limit", varianceBand(null) === "unrated");
check("undefined is unrated too", varianceBand(undefined) === "unrated");
check("NaN is unrated, not silently zero", varianceBand(NaN) === "unrated");

// ── Intel bands ──

check("improving is its own band", intelBand("improving") === "improving");
check("stable is its own band", intelBand("stable") === "stable");
check("watch is its own band", intelBand("watch") === "watch");
check("up is its own band", intelBand("up") === "up");

// The three states that are not judgements fold together, because each
// on its own would be a 2px arc of the same absence.
for (const s of ["new_vehicle", "insufficient", "no_baseline"]) {
  check(`${s} folds into unclassified`, intelBand(s) === "unclassified");
}
check("a missing state is unclassified", intelBand(null) === "unclassified");
check("an undefined state is unclassified", intelBand(undefined) === "unclassified");

// THE POINT OF THE WHOLE SCRIPT. classifyIntel is the thing most likely
// to grow a state. If a new one is not added to intelBand, the truck
// must still land somewhere — never nowhere.
check(
  "a state nobody has heard of still lands in a band",
  intelBand("brand_new_state_from_next_release") === "unclassified",
  "a new state with no band would delete trucks from the ring"
);

// ── countBands ──
//
// A shape, not a transcript. An earlier draft of this file claimed these
// were the live figures and they were not: the tally that produced them
// counted every 5-cell row on the page, which swept in the seven rows of
// the leaderboard sitting directly above the roster. The leaderboard's
// rows are all savings by construction — it is sorted by the rate — so
// they inflated "saving" by exactly seven. The assertions below are
// about ADDITIVITY and that does not depend on the numbers being real;
// these are a plausible fleet, not a recorded one, and the comment says
// so rather than implying a measurement that never happened.

const DRIVERS = [
  ...Array(51).fill(-31720), // saving
  ...Array(7).fill(0), // at the limit
  ...Array(38).fill(+40408), // losing
];
const bands = countBands(DRIVERS, (v) => varianceBand(v), VARIANCE_BANDS);

check("51 drivers are saving", bands.saving === 51, String(bands.saving));
check("7 are exactly at the limit", bands.atLimit === 7, String(bands.atLimit));
check("38 are losing", bands.losing === 38, String(bands.losing));
check(
  "the bands sum to the roster",
  Object.values(bands).reduce((a, b) => a + b, 0) === DRIVERS.length,
  "a ring whose slices do not sum to the row count is lying"
);

// Every band present even at zero. The ring reads its colours off the
// array index, so a missing middle band would paint `losing` with the
// hue `atLimit` owns.
const sparse = countBands([-100, +100], (v) => varianceBand(v), VARIANCE_BANDS);
check("an empty band is still a key", "atLimit" in sparse);
check("and it is zero, not absent", sparse.atLimit === 0);
check("the rest still count", sparse.saving === 1 && sparse.losing === 1);
check(
  "an empty list gives every band zero, not no bands",
  Object.keys(countBands([], varianceBand, VARIANCE_BANDS)).length === VARIANCE_BANDS.length
);

// Noise in, still adds up.
const noisy = countBands(
  [null, undefined, NaN, 0, -1, 1] as (number | null | undefined)[],
  varianceBand,
  VARIANCE_BANDS
);
check(
  "nulls, NaN and both signs still sum to the input length",
  Object.values(noisy).reduce((a, b) => a + b, 0) === 6,
  JSON.stringify(noisy)
);
check("and the nulls went to unrated, not at the limit", noisy.unrated === 3, JSON.stringify(noisy));

// A 77-truck shape, likewise illustrative. What matters is that the
// state nobody has heard of is counted rather than dropped.
const TRUCKS = [
  ...Array(36).fill("improving"),
  ...Array(23).fill("stable"),
  ...Array(7).fill("watch"),
  ...Array(5).fill("up"),
  ...Array(3).fill("no_baseline"),
  ...Array(2).fill("new_vehicle"),
  "insufficient" as string,
  "a_state_from_the_future" as string,
];
const states = countBands(TRUCKS, intelBand, INTEL_BANDS);
check("36 trucks improving", states.improving === 36, String(states.improving));
check("23 steady", states.stable === 23, String(states.stable));
check("7 on watch", states.watch === 7, String(states.watch));
check("5 rising", states.up === 5, String(states.up));
// Seven, not six: three no-baseline, two new vehicles, one insufficient
// data, and the one state nobody has heard of — which is the one this
// assertion is really about. It is counted here rather than left out of
// the fixture so that dropping it would fail the total check below.
check("the seven with no verdict share one arc", states.unclassified === 7, String(states.unclassified));
check(
  "and the fleet still totals",
  Object.values(states).reduce((a, b) => a + b, 0) === TRUCKS.length,
  "the unknown state was dropped"
);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll breakdown checks passed.\n");
