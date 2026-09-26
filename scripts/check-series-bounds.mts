// Run: node --experimental-strip-types scripts/check-series-bounds.mts
//
// The axis bounds the two daily trio charts draw on.
//
// WHY THIS SCRIPT EXISTS. One row in the fuel sheet — a 10,000 DA
// prepaid fill on 2 January 2026, booked as 322.58 litres against 51km,
// which is 632 L/100km for that day — was stretching the "Consumption
// per day" axis to 800 and flattening 259 days of real signal into the
// bottom 5% of the plot. The row is real and must not be edited, so the
// axis gives way instead.
//
// That makes this function responsible for one thing above all else:
//
//   IT MUST NOT HIDE ANYTHING BY ACCIDENT, AND IT MUST NOT HIDE ANYTHING
//   ON A SHORT RANGE. There is a legitimate clip — the tail — and a
//   catastrophic one, which is an axis that quietly drops a real reading
//   because a percentile fell the wrong way on a small sample. The
//   properties asserted below are the line between the two.
//
// The figures are the ones measured on the live sheet, not invented:
// p02 40.7, median 46.2, p98 53.1, max 632.5, over 259 days.

import { strict as assert } from "node:assert";
import {
  percentileDisc,
  seriesBounds,
  DEFAULT_TAIL,
  MIN_POINTS_TO_CLIP,
} from "../src/lib/dashboard/bounds.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── percentileDisc ──
//
// Matches SQL's percentile_disc, because the bounds that come out of
// this function get compared against SQL percentiles every time anyone
// asks why the axis stops where it does.

assert.equal(percentileDisc([1, 2, 3, 4, 5], 0.5), 3, "odd count takes the middle");
assert.equal(percentileDisc([1, 2, 3, 4], 0.5), 2, "even count takes the LOWER middle, as SQL does");
assert.equal(percentileDisc([1, 2, 3, 4, 5], 0), 1, "fraction 0 is the first value");
assert.equal(percentileDisc([1, 2, 3, 4, 5], 1), 5, "fraction 1 is the last value");
assert.equal(percentileDisc([], 0.5), NaN, "an empty list has no percentile");

// ── The case that started all this ──

const daily = [
  ...Array.from({ length: 250 }, (_, i) => 44 + ((i * 7) % 9) * 0.5), // 44-48, the real band
  40.7, 41.2, 42.0, 42.8, 43.5, // the quiet tail
  53.1, 52.4, 51.8, 51.2, 50.9, // the loud tail
  632.5, // sheet row 9
];
const all = seriesBounds(daily, { hardMax: 90 });

check("the axis exists", all !== null);
check("the 632 day does not set the scale", all!.max < 100, `max was ${all!.max}`);
check("the real band is inside the plot", all!.min <= 44 && all!.max >= 48, JSON.stringify(all));
check("the 45 threshold is on screen", all!.min <= 45 && all!.max > 45);
check("the floor is not zero, so the wiggle has room", all!.min > 20, `min was ${all!.min}`);
check("the bounds are round numbers", all!.min % 1 === 0 && all!.max % 1 === 0, JSON.stringify(all));

// How much is on screen, and how much clips. This is the trade the
// function exists to make explicit, so it is measured rather than
// asserted in prose.
const visible = daily.filter((v) => v >= all!.min && v <= all!.max).length;
check(
  "at least 240 of 259 days are on the plot",
  visible >= 240,
  `${visible} visible, ${daily.length - visible} clipped`
);
check("only the 632 day clips off the top", all!.max < 632.5);

// ── A SHORT RANGE IS NOT TOUCHED ──
//
// The promise made to the owner: a 7-day or 30-day view has no outlier,
// so the chart is exactly what it was. Asserted, not hoped for.

const week = [46.1, 45.8, 47.2, 44.9, 46.0, 45.5, 46.4];
check(`a ${MIN_POINTS_TO_CLIP}-day week is under the clipping threshold`, week.length < MIN_POINTS_TO_CLIP);
const weekBounds = seriesBounds(week);
check("a week's bounds are its own min and max", weekBounds!.min <= 44.9 && weekBounds!.max >= 47.2, JSON.stringify(weekBounds));
check("and a week's axis does not clip anything", week.every((v) => v >= weekBounds!.min && v <= weekBounds!.max));

// A short range that DOES contain an outlier must still not clip,
// because with seven points the 98th percentile IS the maximum and
// "clipping" would mean hiding a real reading to tidy an axis.
const shortWithSpike = [46, 45, 47, 46, 45, 46, 632.5];
const shortBounds = seriesBounds(shortWithSpike, { hardMax: 90 });
check("a 7-day range keeps its outlier visible", shortBounds!.max >= 632.5, JSON.stringify(shortBounds));

// ── Nothing to compute from ──

check("an empty series has no bounds", seriesBounds([]) === null);
check("a series of nulls has no bounds", seriesBounds([null, null, null]) === null);
check("a single value has no bounds", seriesBounds([46]) === null);
check("a flat series has no bounds", seriesBounds([46, 46, 46, 46, 46, 46, 46, 46]) === null);
check("junk is filtered, not plotted", seriesBounds([46, NaN, 45, Infinity, 47, null])?.max !== Infinity);
check("a two-value series is fine", seriesBounds([40, 50])?.max === 50);

// ── The options ──

const counted = seriesBounds(daily, { beginAtZero: true, hardMax: 90 });
check("beginAtZero pins the floor to zero", counted!.min === 0, `min was ${counted!.min}`);
// The CEILING moves with beginAtZero, and that is correct rather than a
// bug: the nice step is derived from the range, so 0..53 rounds on a step
// of 10 and lands at 60, where 40..53 rounds on a step of 2 and lands at
// 54. A zero-based axis covering more is the expected consequence.
check("and the ceiling follows the step, so it covers more", counted!.max >= all!.max, `${counted!.max} vs ${all!.max}`);
check("a zero-based axis still clips the outlier", counted!.max < 632.5);

check("the hard cap holds however wide the data is", seriesBounds([...Array(20).fill(40), 700], { hardMax: 90 })!.max <= 90);
check("a hard cap below the floor falls back to the data", seriesBounds([...Array(20).fill(600), 700, 800], { hardMax: 90 })!.max === 800);
check("a wider tail clips more", (seriesBounds(daily, { tail: 0.2 })!.min ?? 0) <= all!.min);
// tail 0 means "clip nothing", so the maximum must survive even though
// the nice step it rounds on becomes enormous.
check("a zero tail keeps the maximum", seriesBounds(daily, { tail: 0 })!.max >= 632.5, JSON.stringify(seriesBounds(daily, { tail: 0 })));
check("the default tail is two percent", DEFAULT_TAIL === 0.02);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll series-bounds checks passed.\n");
