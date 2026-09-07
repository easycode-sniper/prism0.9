// Checks for previousRange() in src/lib/dashboard/range.ts.
//
// Run: node --experimental-strip-types scripts/check-previous-range.mts
//
// WHY THIS SCRIPT EXISTS: every one of these answers is a date, and a
// date that is wrong by one day or one month is still a date — it
// renders, it looks plausible, and tsc has no opinion. The dashboard
// would simply show the fleet down 40% against a window that is not the
// one the label claims, which is worse than showing nothing.
//
// The month cases are the ones worth the file. A month-to-date compared
// against a WHOLE previous month reads as a collapse in the work for the
// first three weeks of every month, and 31 March has no 31 February to
// compare against.

import {
  previousRange,
  daysInRange,
  monthStart,
  monthEnd,
  addDays,
  addMonths,
} from "../src/lib/dashboard/range.ts";
import { periodDelta } from "../src/lib/dashboard/delta.ts";

// The delta helper takes t so its one non-numeric phrase can speak
// French; here it is the identity.
const t = (k: string) => k;
const nf = (n: number) => Math.round(n).toLocaleString("en-GB");

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eq(label: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(label, g === w, `got ${g}, want ${w}`);
}

console.log("\nhelpers:");
eq("daysInRange is inclusive", daysInRange("2026-09-07", "2026-09-07"), 1);
eq("daysInRange spans a week", daysInRange("2026-09-01", "2026-09-07"), 7);
eq("daysInRange crosses a month", daysInRange("2026-08-30", "2026-09-02"), 4);
eq("addDays crosses a month backwards", addDays("2026-09-01", -1), "2026-08-31");
eq("addDays crosses a year backwards", addDays("2026-01-01", -1), "2025-12-31");
eq("monthEnd knows 30-day months", monthEnd("2026-09-15"), "2026-09-30");
eq("monthEnd knows February", monthEnd("2026-02-10"), "2026-02-28");
eq("monthEnd knows a leap February", monthEnd("2028-02-10"), "2028-02-29");
eq("monthEnd knows December", monthEnd("2026-12-01"), "2026-12-31");
eq("addMonths rolls the year", addMonths("2026-01-15", -1), "2025-12-01");
eq("monthStart", monthStart("2026-09-07"), "2026-09-01");

console.log("\nthe simple windows:");
// Today -> yesterday. The case the owner named first.
eq("today compares to yesterday",
  previousRange({ from: "2026-09-07", to: "2026-09-07" }),
  { from: "2026-09-06", to: "2026-09-06" });

eq("yesterday compares to the day before",
  previousRange({ from: "2026-09-06", to: "2026-09-06" }),
  { from: "2026-09-05", to: "2026-09-05" });

// 7 days = 01..07 -> 25 Aug..31 Aug. Seven days each side, no overlap,
// no gap: the previous window must END the day before this one starts.
eq("7 days compares to the 7 before it",
  previousRange({ from: "2026-09-01", to: "2026-09-07" }),
  { from: "2026-08-25", to: "2026-08-31" });

eq("30 days compares to the 30 before it",
  previousRange({ from: "2026-08-09", to: "2026-09-07" }),
  { from: "2026-07-10", to: "2026-08-08" });

{
  const r = { from: "2026-09-01", to: "2026-09-07" };
  const p = previousRange(r)!;
  check("both windows are the same length",
    daysInRange(p.from!, p.to!) === daysInRange(r.from!, r.to!),
    `${daysInRange(p.from!, p.to!)} vs ${daysInRange(r.from!, r.to!)}`);
  check("they do not overlap", p.to! < r.from!, `${p.to} vs ${r.from}`);
  check("they leave no gap", addDays(p.to!, 1) === r.from!);
}

console.log("\nwhole months:");
eq("a whole month compares to the whole month before",
  previousRange({ from: "2026-08-01", to: "2026-08-31" }),
  { from: "2026-07-01", to: "2026-07-31" });

// 31 days back from 1 March is 29 January — not a month. This is the
// case that makes the calendar branch necessary.
eq("March compares to February, not to 31 days",
  previousRange({ from: "2026-03-01", to: "2026-03-31" }),
  { from: "2026-02-01", to: "2026-02-28" });

eq("January compares across the year boundary",
  previousRange({ from: "2026-01-01", to: "2026-01-31" }),
  { from: "2025-12-01", to: "2025-12-31" });

console.log("\nmonth to date:");
// The 7th of the month against the 1st-7th of the previous one. NOT
// against all of last month, which would read as a collapse every time.
// THE AMBIGUITY THAT MADE `calendar` NECESSARY. On the 7th of a month
// "This month" and "7 days" are the same OpsRange, so the dates alone
// cannot say which was clicked — and the two want different answers.
eq("the same range without the flag is a trailing window",
  previousRange({ from: "2026-09-01", to: "2026-09-07" }),
  { from: "2026-08-25", to: "2026-08-31" });

eq("...and with it, the same stretch of last month",
  previousRange({ from: "2026-09-01", to: "2026-09-07" }, { calendar: true }),
  { from: "2026-08-01", to: "2026-08-07" });

eq("a mid-month MTD compares to the same days last month",
  previousRange({ from: "2026-09-01", to: "2026-09-20" }, { calendar: true }),
  { from: "2026-08-01", to: "2026-08-20" });

// 31 March has no 31 February. Clamped rather than rolled into March.
eq("MTD clamps to a shorter previous month",
  previousRange({ from: "2026-03-01", to: "2026-03-30" }, { calendar: true }),
  { from: "2026-02-01", to: "2026-02-28" });

// A whole month needs no flag — first-to-last is unambiguous.
eq("a whole month ignores the flag, both ways",
  previousRange({ from: "2026-08-01", to: "2026-08-31" }),
  previousRange({ from: "2026-08-01", to: "2026-08-31" }, { calendar: true }));

{
  const p = previousRange({ from: "2026-03-01", to: "2026-03-30" }, { calendar: true })!;
  check("the clamp never spills into the current month", p.to! < "2026-03-01", String(p.to));
}

console.log("\nnothing to compare:");
eq("all time has no previous", previousRange({ from: null, to: null }), null);
eq("an open start has no previous", previousRange({ from: null, to: "2026-09-07" }), null);
eq("an open end has no previous", previousRange({ from: "2026-09-01", to: null }), null);
eq("a backwards range has no previous", previousRange({ from: "2026-09-07", to: "2026-09-01" }), null);

console.log("\ndeltas — against the real 7-day numbers:");
// Straight from fuel_period_stats on 2026-09-07:
//   current  01-07 Sep   km 209370  L 96601  DA 3017267  45.81  var 52670
//   previous 25-31 Aug   km 225094  L 105266 DA 3281855  46.62  var 113194
eq("kilometres down 7%",
  periodDelta(209370, 225094, "km", nf, t), { glyph: "▼", text: "7%", tone: "bad" });
eq("litres down 8.2%",
  periodDelta(96601, 105266, "L", nf, t), { glyph: "▼", text: "8.2%", tone: "bad" });
eq("amount down 8.1%",
  periodDelta(3017267, 3281855, "DA", nf, t), { glyph: "▼", text: "8.1%", tone: "bad" });
// Under 10% keeps a decimal — 1.7 and 2.4 are different answers and
// rounding both to 2% throws away the only precision that mattered.
// 6.985% rounds to 7.0 and prints as 7 — a trailing zero is a digit
// that says nothing.
eq("a whole percentage drops its trailing zero",
  periodDelta(209370, 225094, "km", nf, t), { glyph: "▼", text: "7%", tone: "bad" });
eq("consumption down 1.7%",
  periodDelta(45.81, 46.62, "L/100km", (n) => n.toFixed(2), t, true), { glyph: "▼", text: "1.7%", tone: "good" });
eq("variance down 53%",
  periodDelta(52670, 113194, "DA", nf, t, true), { glyph: "▼", text: "53%", tone: "good" });

console.log("\ndeltas — the cases a percentage would lie about:");
// THE REASON variance is not always a percentage. A fleet that was 5,000
// UNDER the assumed rate and is now 12,000 OVER has not improved by
// 340%; it has swung by 17,000 DA and the sign is the story.
eq("a sign flip is reported in the unit, not as a percentage",
  periodDelta(12000, -5000, "DA", nf, t, true), { glyph: "▲", text: "17,000 DA", tone: "bad" });
eq("a flip the other way too",
  periodDelta(-5000, 12000, "DA", nf, t, true), { glyph: "▼", text: "17,000 DA", tone: "good" });
// Both negative is a real comparison: deeper under the rate is still a
// like-for-like move.
eq("both under the rate compares normally",
  periodDelta(-12000, -6000, "DA", nf, t, true), { glyph: "▼", text: "100%", tone: "good" });
eq("dividing by a zero previous falls back to the unit",
  periodDelta(4200, 0, "km", nf, t), { glyph: "▲", text: "4,200 km", tone: "good" });
eq("an absurd multiple falls back to the unit",
  periodDelta(500000, 100, "km", nf, t), { glyph: "▲", text: "499,900 km", tone: "good" });

console.log("\ntone — green good, red bad, and it is NOT the arrow:");
// The whole point of the flag. The SAME movement is good news on four
// cards and bad news on the two where more means worse.
eq("kilometres rising is good news",
  periodDelta(110, 100, "km", nf, t), { glyph: "▲", text: "10%", tone: "good" });
eq("the same rise in consumption is bad news",
  periodDelta(110, 100, "L/100km", nf, t, true), { glyph: "▲", text: "10%", tone: "bad" });
eq("variance rising is money lost",
  periodDelta(110, 100, "DA", nf, t, true), { glyph: "▲", text: "10%", tone: "bad" });
eq("variance falling is money saved",
  periodDelta(90, 100, "DA", nf, t, true), { glyph: "▼", text: "10%", tone: "good" });
// A truck fleet that drove less is doing less work — down is bad on the
// four normal cards, which is what makes the arrow alone insufficient.
eq("kilometres falling is bad news",
  periodDelta(90, 100, "km", nf, t), { glyph: "▼", text: "10%", tone: "bad" });

{
  const up = periodDelta(110, 100, "km", nf, t)!;
  const down = periodDelta(110, 100, "L/100km", nf, t, true)!;
  check("two cards can share an arrow and disagree about the colour",
    up.glyph === down.glyph && up.tone !== down.tone,
    `${up.glyph}/${up.tone} vs ${down.glyph}/${down.tone}`);
}

console.log("\ndeltas — nothing to say:");
eq("no previous window means no line", periodDelta(100, null, "km", nf, t), null);
eq("no current figure means no line", periodDelta(null, 100, "km", nf, t), null);
// litresPer100Km is null when no fill in the window logged a distance.
eq("a null average on either side means no line",
  periodDelta(null, null, "L/100km", nf, t), null);
eq("identical figures read as no change",
  periodDelta(1000, 1000, "km", nf, t), { glyph: "=", text: "no change", tone: null });
// Float sums: 45.68 and 45.680000000001 are the same number.
eq("float noise is not a change",
  periodDelta(45.68, 45.680000000001, "L/100km", nf, t, true), { glyph: "=", text: "no change", tone: null });

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll range and delta checks passed.\n");
