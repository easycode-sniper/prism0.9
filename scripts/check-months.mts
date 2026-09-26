// Run: node --experimental-strip-types scripts/check-months.mts
//
// The "Variance by month" panel (migration 078).
//
// WHAT THIS IS FOR. The panel is four labels and a bar chart, and every
// rule that makes it correct is one that fails SILENTLY:
//
//   - The RPC sorts its months NEWEST first, because that is what makes
//     `LIMIT 24` keep the twenty-four months a reader is looking at. The
//     axis wants the other end. A dropped `.reverse()` renders nine
//     correct numbers from September back to January, and no type
//     checker, linter or test in the build would ever say so.
//   - The current month is drawn pale rather than dropped or coloured
//     like a finished one, because it is 24 days of fills against a
//     neighbour's 31.
//   - A month that SAVED money is green, and one that merely broke even
//     is not.
//
// None of those are arithmetic, so none of them are hard to get wrong
// once, and all of them are invisible afterwards. Hence this.
//
// WHY A PLAIN MODULE. lib/fuel/months.ts imports nothing — no React, no
// Supabase, no "@/" alias, nothing that reads an env var — so it runs
// under bare node the way check-fuel-dates.mts does. Putting the logic in
// the dashboard page would have made every one of these untestable.
//
// The SQL is not covered here and cannot be: it lives in the database.
// What is pinned is that the numbers arriving from it are mapped and
// ordered correctly on this side of the wire.

import { strict as assert } from "node:assert";
import {
  isCurrentMonth,
  monthAxisLabel,
  monthBarColour,
  monthFullLabel,
  monthKey,
  toMonthlyVariance,
  totalVariance,
} from "../src/lib/fuel/months.ts";

// ── The key ──
//
// PostgREST hands a DATE back as "YYYY-MM-DD"; the RPC's own month is
// the first of the month, but nothing guarantees a caller passed a real
// date, so the key is a slice and the panel's guards work off it.

assert.equal(monthKey("2026-08-01"), "2026-08");
assert.equal(monthKey("2026-08"), "2026-08", "a key is already a key");
assert.equal(monthKey(""), "", "an absent month has no key, and does not throw");

// ── The labels ──
//
// en-GB, because every other label on the dashboard is en-GB. "Aug" on the
// axis, "August 2026" under the cursor.

assert.equal(monthAxisLabel("2026-08-01"), "Aug");
assert.equal(monthAxisLabel("2026-01-01"), "Jan", "not zero-indexed");
assert.equal(monthAxisLabel("2026-12-01"), "Dec");
assert.equal(monthAxisLabel("2026-08"), "Aug", "a key is a valid month to label");

assert.equal(monthFullLabel("2026-08-01"), "August 2026");
assert.equal(monthFullLabel("2025-08-01"), "August 2025", "the YEAR is the point of the long form");

// The two must not agree, or the tooltip bought nothing: it exists
// because the axis drops the year.
assert.notEqual(
  monthFullLabel("2026-08-01"),
  monthAxisLabel("2026-08-01"),
  "the long form has to carry more than the axis"
);

// Noon UTC in, UTC out. A month read as an instant at local midnight
// would label September as October for a server west of Greenwich; the
// whole reason the value is a month rather than a date is that nobody
// should have to think about that here.
assert.equal(monthAxisLabel("2026-01-01"), "Jan", "the first of the year does not slide");
assert.equal(monthAxisLabel("2026-03-01"), "Mar", "the month after a leap February");

// ── "Still counting" ──
//
// The sub-line says it, and only while it is true. Passed the
// operations-timezone day, because the panel's months are in the
// operations timezone too.

assert.equal(isCurrentMonth("2026-09-01", "2026-09-26"), true, "mid-month");
assert.equal(isCurrentMonth("2026-09-01", "2026-09-01"), true, "on the first");
assert.equal(isCurrentMonth("2026-08-01", "2026-08-31"), true, "on the last day of the month");
assert.equal(isCurrentMonth("2026-08-01", "2026-09-01"), false, "yesterday's month stops counting");
assert.equal(isCurrentMonth("2025-09-01", "2026-09-26"), false, "the same month, a YEAR ago");
assert.equal(isCurrentMonth("", "2026-09-26"), false, "no data is not still counting");

// ── The bar colours ──
//
// Red is money lost, green is money saved, and the current month is the
// same hue at half the strength. The exact rgba values are pinned
// because they are the panel's whole visual argument.

assert.equal(monthBarColour(251621, false), "rgba(255, 45, 63, 0.45)", "a loss is red");
assert.equal(monthBarColour(-12000, false), "rgba(0, 255, 123, 0.45)", "a saving is green");
assert.equal(monthBarColour(0, false), "rgba(255, 45, 63, 0.45)", "breaking even is not a saving");
assert.equal(monthBarColour(74395, true), "rgba(255, 45, 63, 0.22)", "the partial month is pale red");
assert.equal(monthBarColour(-74395, true), "rgba(0, 255, 123, 0.22)", "a pale month that saved is still green");

// The pale wash must be the SAME hue, not a different colour: a reader
// must not have to learn a second vocabulary for the same month.
const [redHue] = monthBarColour(100, true).match(/[\d.]+/g)!;
const [solidHue] = monthBarColour(100, false).match(/[\d.]+/g)!;
assert.equal(redHue, solidHue, "pale and solid share a hue");
const [partialAlpha] = monthBarColour(100, true).match(/[\d.]+/g)!.slice(3);
const [solidAlpha] = monthBarColour(100, false).match(/[\d.]+/g)!.slice(3);
assert.ok(
  Number(partialAlpha) < Number(solidAlpha),
  `the partial month must be fainter (${partialAlpha} vs ${solidAlpha})`
);

// ── The rows, as the RPC sends them ──
//
// Newest first, with NUMERIC columns arriving as strings — which is what
// PostgREST does, and the reason this cannot be `data as MonthlyVariance[]`.

const raw = [
  { month: "2026-09-01", paired_fills: "1191", fills: "1310", km: "749059.0", litres: "339470.0", amount_da: "10621887.00", variance_da: "74395.00", litres_per_100km: 45.32 },
  { month: "2026-08-01", paired_fills: "1393", fills: "1512", km: "826061.0", litres: "396509.0", amount_da: "12412996.00", variance_da: "773680.00", litres_per_100km: 48.02 },
  { month: "2026-07-01", paired_fills: "1653", fills: "1790", km: "1026380.0", litres: "472139.0", amount_da: "14790233.00", variance_da: "329325.00", litres_per_100km: 46.03 },
];

const months = toMonthlyVariance(raw);

assert.deepEqual(
  months.map((m) => m.month),
  ["2026-07-01", "2026-08-01", "2026-09-01"],
  "OLDEST FIRST — the axis runs the way a time series reads"
);

assert.deepEqual(
  months.map((m) => m.litresPer100Km),
  [46.03, 48.02, 45.32],
  "the rate follows its month, not the row it arrived in"
);
assert.equal(months[1].pairedFills, 1393, "NUMERIC columns arrive as strings and become numbers");
assert.equal(months[1].litresPer100Km, 48.02, "August is the bad month, 48.02 against a ~46 norm");
assert.equal(months[0].varianceDa, 329325, "July");

// A month with no rate at all — no paired fill, so no denominator — must
// stay null rather than becoming 0. A zero would draw a point at the
// floor of the right axis and read as "the fleet burned nothing".
const noRate = toMonthlyVariance([
  { month: "2026-05-01", variance_da: "0", litres_per_100km: null },
]);
assert.equal(noRate[0].litresPer100Km, null, "no rate is null, never zero");
assert.equal(noRate[0].varianceDa, 0, "and the money coalesces to zero rather than NaN");

// SQL COALESCEs the sums, but a null column must not become the string
// "null" either.
const nulls = toMonthlyVariance([{ month: "2026-05-01" }]);
assert.equal(nulls[0].varianceDa, 0);
assert.equal(nulls[0].km, 0);
assert.equal(nulls[0].litresPer100Km, null);

// A row with no usable month cannot be placed on an axis, so it is
// dropped rather than rendered as "Invalid Date" in a tooltip.
const junk = toMonthlyVariance([
  { month: null, variance_da: "10" },
  { month: "", variance_da: "20" },
  { month: "not a date", variance_da: "30" },
  { month: "2026-05-01", variance_da: "40" },
]);
assert.deepEqual(junk.map((m) => m.month), ["2026-05-01"], "an unplaceable month is dropped");
assert.deepEqual(toMonthlyVariance([]), [], "an empty sheet is an empty panel, not an error");

// ── The headline total ──
//
// 74395 + 773680 + 329325, from the three months above.

assert.equal(totalVariance(months), 1177400, "the panel's top-right figure");
assert.equal(totalVariance([]), 0, "no months, no total");

console.log("all month key checks passed");
console.log("all month label checks passed");
console.log("all still-counting checks passed");
console.log("all bar colour checks passed");
console.log("all month row-mapping checks passed");
console.log("all month total checks passed");
