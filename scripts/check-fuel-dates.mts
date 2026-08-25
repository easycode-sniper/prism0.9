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
import { parseSheetDateTime } from "../src/lib/fuel/parse.ts";

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

console.log("all serial date checks passed");
