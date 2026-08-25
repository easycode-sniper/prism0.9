// Run: node --experimental-strip-types scripts/check-fuel-dates.mts
//
// The one check behind the date fix. Sheets hands this app a date as a
// serial — a day count from an 1899 epoch with the time as its fraction
// — and the conversion back to an instant has three ways to be quietly
// wrong: the epoch, the rounding, and the timezone it is stamped with.
// None of them fail loudly; they move a fuel fill to the wrong day.
//
// No framework, by design: node --experimental-strip-types runs this
// against the real module with nothing installed.
import { strict as assert } from "node:assert";
import { parseSheetDateTime, resolveOccurredAt } from "../src/lib/fuel/parse.ts";

// Sheets anchor everyone knows: serial 1 is 1899-12-31, serial 2 is 1900-01-01.
assert.equal(parseSheetDateTime(2), "1899-12-31T23:00:00.000Z", "epoch anchor (+01:00 => 23:00 prev day UTC)");

// A whole-day serial for 2026-08-13. Days from 1899-12-30 to 2026-08-13:
const days = Math.round((Date.UTC(2026, 7, 13) - Date.UTC(1899, 11, 30)) / 86400000);
assert.equal(parseSheetDateTime(days), "2026-08-12T23:00:00.000Z", "midnight local = 23:00 previous day UTC");

// 16:42:07 local on that day -> 15:42:07Z
const frac = (16 * 3600 + 42 * 60 + 7) / 86400;
assert.equal(parseSheetDateTime(days + frac), "2026-08-13T15:42:07.000Z", "time fraction");

// Float noise must not shave a second off.
assert.equal(parseSheetDateTime(days + 0.9583333329), "2026-08-13T22:00:00.000Z", "23:00 local survives rounding");

// Numeric string form.
assert.equal(parseSheetDateTime(String(days + frac)), "2026-08-13T15:42:07.000Z", "serial as string");

// Text fallback stays day-first and REFUSES an impossible month rather
// than swapping to make it fit.
assert.equal(parseSheetDateTime("13/08/2026 16:42:07"), "2026-08-13T15:42:07.000Z", "text day-first");
assert.equal(parseSheetDateTime("08/13/2026 16:42:07"), null, "month 13 rejected, not swapped");

// Junk.
for (const bad of ["", "   ", "not a date", 0, -5, NaN, null, undefined, {}]) {
  assert.equal(parseSheetDateTime(bad as unknown), null, `rejects ${JSON.stringify(bad)}`);
}

// ── resolveOccurredAt: the column read as a sequence ──
//
// A single cell cannot say whether "8/1/2026" is 1 August or 8 January.
// The sheet's row order can, because it is append-only. These are the
// real shapes from the connected sheet.

// The resolver returns a UTC instant, and the sheet's times are +01:00,
// so a fill at 00:12 local is 23:12 the previous day in UTC. Compare on
// the local calendar day, which is the one the office means.
const day = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10) : null;

// The actual format boundary: rows 510 and 511, twelve August into
// thirteen August. Read naively the first is 12 December.
assert.deepEqual(
  resolveOccurredAt(["8/12/2026 23:18:51", "13/8/2026 08:11:50"]).map(day),
  ["2026-08-12", "2026-08-13"],
  "the row 510/511 boundary"
);

// Rows 54 and 55, fifteen minutes apart in the log. Day-first would put
// a month between them.
assert.deepEqual(
  resolveOccurredAt(["8/1/2026 23:57:06", "8/2/2026 00:12:38", "13/8/2026 08:11:50"]).map(day),
  ["2026-08-01", "2026-08-02", "2026-08-13"],
  "consecutive fills stay consecutive"
);

// A sheet already normalised to day-first must come back untouched —
// this is what the office is moving to, and the resolver has to be a
// no-op on it rather than "helpfully" reinterpreting anything.
assert.deepEqual(
  resolveOccurredAt(["1/8/2026 10:00:00", "8/8/2026 10:00:00", "13/8/2026 10:00:00", "25/8/2026 10:00:00"]).map(day),
  ["2026-08-01", "2026-08-08", "2026-08-13", "2026-08-25"],
  "an already day-first column is left alone"
);

// Anchored below the ambiguous rows, so resolution has to walk backwards
// as well as forwards.
assert.deepEqual(
  resolveOccurredAt(["8/3/2026 08:00:00", "8/4/2026 08:00:00", "20/8/2026 08:00:00"]).map(day),
  ["2026-08-03", "2026-08-04", "2026-08-20"],
  "walks backwards from the anchor"
);

// Nothing unambiguous anywhere: every reading is as defensible as any
// other, so it falls back to day-first rather than inventing a rule.
assert.deepEqual(
  resolveOccurredAt(["5/6/2026 08:00:00", "6/6/2026 08:00:00"]).map(day),
  ["2026-06-05", "2026-06-06"],
  "falls back to day-first with no anchor"
);

// A junk cell resolves to null and leaves its neighbours alone.
assert.deepEqual(
  resolveOccurredAt(["8/1/2026 23:57:06", "#VALUE!", "13/8/2026 08:11:50"]).map(day),
  ["2026-08-01", null, "2026-08-13"],
  "a bad cell does not disturb the sequence"
);

// An impossible day is not a candidate at all.
assert.deepEqual(resolveOccurredAt(["31/2/2026 08:00:00"]).map(day), [null], "31 February is rejected");

console.log("all serial date checks passed");
console.log("all column-resolution checks passed");
