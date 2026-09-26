// Checks for Prism Intelligence's pure logic: the behavioral classifier,
// per-fill rates, and driver-run derivation.
//
// Run: node --experimental-strip-types scripts/check-intelligence.mts
//
// WHY THIS SCRIPT EXISTS: the INTELLIGENCE column turns two aggregate
// rows into a management signal — a boundary off by a point, or a
// one-tank "trend", reads as a false accusation against a truck. tsc
// cannot see that +10.04 must be "up" and +9.96 "watch", so the
// boundaries are pinned here. Same for the driver timeline: runs must
// join only contiguous same-driver fills, because a merged timeline
// would invent an assignment the data never stated.

import {
  buildConclusion,
  classifyIntel,
  deriveDriverRuns,
  fillRate,
  intelClass,
  limitDelta,
  INTEL_CHART_CEILING,
  INTEL_MIN_FILLS,
  INTEL_STABLE_PCT,
  INTEL_WATCH_PCT,
} from "../src/lib/fuel/intelligence.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("thresholds:");

{
  check("stable band is ±5", INTEL_STABLE_PCT === 5);
  check("watch ceiling is +10", INTEL_WATCH_PCT === 10);
  check("minimum fills is 3 per period", INTEL_MIN_FILLS === 3);
}

console.log("\nclassifier:");

{
  // The spec's own example: 42.1 → 48.9 = +16.15% → +16.2, up.
  const r = classifyIntel({ fills: 8, litresPer100Km: 48.9 }, { fills: 7, litresPer100Km: 42.1 }, 40);
  check("spec example classifies up at +16.2", r.state === "up" && r.pct === 16.2, JSON.stringify(r));
}

{
  const at = (pct: number) => ({ fills: 5, litresPer100Km: 100 + pct });
  const base = { fills: 5, litresPer100Km: 100 };
  check("+5.0 is stable (boundary inclusive)", classifyIntel(at(5), base, 9).state === "stable");
  check("+5.1 is watch", classifyIntel(at(5.1), base, 9).state === "watch");
  check("+10.0 is watch (boundary inclusive)", classifyIntel(at(10), base, 9).state === "watch");
  check("+10.1 is up", classifyIntel(at(10.1), base, 9).state === "up");
  check("-5.0 is stable (boundary inclusive)", classifyIntel(at(-5), base, 9).state === "stable");
  check("-5.1 is improving", classifyIntel(at(-5.1), base, 9).state === "improving");
  check("pct carries one decimal", classifyIntel(at(-8.35), base, 9).pct === -8.3 ||
    classifyIntel(at(-8.35), base, 9).pct === -8.4);
}

{
  const cur = { fills: 6, litresPer100Km: 50 };
  check("no previous + history → no_baseline", classifyIntel(cur, null, 12).state === "no_baseline");
  check("no previous + zero history → new_vehicle", classifyIntel(cur, null, 0).state === "new_vehicle");
  check("no previous + unknown history → no_baseline", classifyIntel(cur, null, null).state === "no_baseline");
  check(
    "thin current sample → insufficient",
    classifyIntel({ fills: 2, litresPer100Km: 60 }, { fills: 9, litresPer100Km: 45 }, 20).state === "insufficient"
  );
  check(
    "thin previous sample → insufficient",
    classifyIntel({ fills: 9, litresPer100Km: 60 }, { fills: 1, litresPer100Km: 45 }, 20).state === "insufficient"
  );
  check(
    "missing current rate → insufficient",
    classifyIntel({ fills: 9, litresPer100Km: null }, { fills: 9, litresPer100Km: 45 }, 20).state === "insufficient"
  );
  check(
    "missing previous rate → insufficient",
    classifyIntel({ fills: 9, litresPer100Km: 60 }, { fills: 9, litresPer100Km: null }, 20).state === "insufficient"
  );
  check(
    "zero previous rate → insufficient, never a divide-by-zero",
    classifyIntel({ fills: 9, litresPer100Km: 60 }, { fills: 9, litresPer100Km: 0 }, 20).state === "insufficient"
  );
}

console.log("\ncell colour:");

{
  // Direction states keep their colour whether or not a level is passed:
  // the split below applies to STABLE alone, because STABLE is the only
  // state whose colour would otherwise be saying nothing at all.
  check("up is red, level or not", intelClass("up") === "c-red" && intelClass("up", 30) === "c-red");
  check("watch is amber, level or not", intelClass("watch") === "c-amber" && intelClass("watch", 60) === "c-amber");
  check("improving is green, level or not", intelClass("improving") === "c-green" && intelClass("improving", 60) === "c-green");

  // The split the owner asked for (spec §25): steady must not read as
  // fine when the level is excessive. 50.48 is the real case.
  check("stable above 45 is red", intelClass("stable", 50.48) === "c-red", intelClass("stable", 50.48));
  check("stable below 45 is green", intelClass("stable", 44.9) === "c-green", intelClass("stable", 44.9));
  // Same boundary the L/100km column already draws, so the two cells
  // in a row can never disagree about the same number.
  check("stable exactly at 45 is green (boundary matches consumptionClass)", intelClass("stable", 45) === "c-green");
  check("stable just above 45 is red", intelClass("stable", 45.01) === "c-red");

  // A truck that never logged a distance has no rate to measure against
  // the limit. Green would be a claim of health nobody showed.
  check("stable with no rate stays dim", intelClass("stable", null) === "t-dim", intelClass("stable", null));
  check("stable with no level argument stays dim (the window's rule)", intelClass("stable") === "t-dim");

  // No-data states are never dressed in a level colour.
  check("no_baseline stays dim", intelClass("no_baseline", 60) === "t-dim");
  check("insufficient stays dim", intelClass("insufficient", 60) === "t-dim");
  check("new_vehicle is primary, not a status hue", intelClass("new_vehicle", 60) === "t-primary");
}

console.log("\nlimit + ceiling:");

{
  check("chart ceiling is a display-only 90", INTEL_CHART_CEILING === 90);
  check("50.48 vs 45 reads +5.48 above", limitDelta(50.48) === 5.48, String(limitDelta(50.48)));
  check("43 vs 45 reads −2 below", limitDelta(43) === -2);
  check("exactly 45 reads zero", limitDelta(45) === 0);
}

console.log("\nconclusion:");

{
  // Spec §9 case 1: improved but still above.
  const c1 = buildConclusion(50.0, 55.0, -9.1, "improving");
  check("case 1 keys improved-above", c1.length === 1 && c1[0].key === "Conclusion improved above limit." && c1[0].vars.x === "9.1", JSON.stringify(c1));
  // Case 2: worsened and above.
  const c2 = buildConclusion(57.0, 50.0, 14.0, "up");
  check("case 2 keys worsened-above", c2.length === 1 && c2[0].key === "Conclusion worsened above limit." && c2[0].vars.x === "14.0", JSON.stringify(c2));
  // Case 3: stable but above.
  const c3 = buildConclusion(57.0, 56.0, 1.8, "stable");
  check("case 3 keys stable-above with no vars", c3.length === 1 && c3[0].key === "Conclusion stable above limit.", JSON.stringify(c3));
  // Case 4: improved and now within.
  const c4 = buildConclusion(43.0, 48.0, -10.4, "improving");
  check("case 4 keys improved-within", c4.length === 1 && c4[0].key === "Conclusion improved within limit.", JSON.stringify(c4));
  // Case 5: worsened but still below.
  const c5 = buildConclusion(43.0, 40.0, 7.5, "watch");
  check("case 5 keys worsened-within", c5.length === 1 && c5[0].key === "Conclusion worsened within limit.", JSON.stringify(c5));
  // Stable below (derived symmetric): within, no alarm.
  const c5b = buildConclusion(41.0, 40.5, 1.2, "stable");
  check("stable-below keys stable-within", c5b.length === 1 && c5b[0].key === "Conclusion stable within limit.", JSON.stringify(c5b));
  // Case 6: no baseline, current known and above.
  const c6 = buildConclusion(50.48, null, null, "no_baseline");
  check(
    "case 6 stacks insufficiency + current + above-limit",
    c6.length === 3 &&
      c6[0].key === "Conclusion no baseline." &&
      c6[1].key === "Conclusion current is." && c6[1].vars.x === "50.48" &&
      c6[2].key === "Conclusion current above limit.",
    JSON.stringify(c6)
  );
  // No baseline, current below: no above-limit tail.
  const c6b = buildConclusion(43.0, null, null, "insufficient");
  check("below-limit tail is omitted when within", c6b.length === 2, JSON.stringify(c6b));
  // Nothing known at all: insufficiency alone.
  const c6c = buildConclusion(null, null, null, "no_baseline");
  check("unknown current yields insufficiency alone", c6c.length === 1, JSON.stringify(c6c));
}

console.log("\nper-fill rates:");

{
  check("500L over 1000km is 50.00", fillRate(500, 1000) === 50);
  check("no distance yields no rate, never zero", fillRate(500, null) === null);
  check("zero distance yields no rate", fillRate(500, 0) === null);
  check("no litres yields no rate", fillRate(null, 1000) === null);
}

console.log("\ndriver runs:");

{
  const runs = deriveDriverRuns([
    { occurredAt: "2026-08-10T08:00:00Z", driverName: "A" },
    { occurredAt: "2026-08-20T08:00:00Z", driverName: "A" },
    { occurredAt: "2026-09-01T08:00:00Z", driverName: "B" },
    { occurredAt: "2026-09-10T08:00:00Z", driverName: "B" },
    { occurredAt: "2026-09-20T08:00:00Z", driverName: "A" },
  ]);
  check("A,A,B,B,A makes three runs", runs.length === 3, JSON.stringify(runs));
  check(
    "runs carry exact first/last fill dates and counts",
    runs[0].driver === "A" &&
      runs[0].from === "2026-08-10T08:00:00Z" &&
      runs[0].to === "2026-08-20T08:00:00Z" &&
      runs[0].fills === 2 &&
      runs[1].driver === "B" &&
      runs[1].fills === 2 &&
      runs[2].driver === "A" &&
      runs[2].fills === 1,
    JSON.stringify(runs)
  );
}

{
  const runs = deriveDriverRuns([
    { occurredAt: "2026-09-01T08:00:00Z", driverName: null },
    { occurredAt: "2026-09-02T08:00:00Z", driverName: null },
  ]);
  check("driverless fills form one unknown run, not zero", runs.length === 1 && runs[0].driver === null);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll intelligence checks passed.\n");
