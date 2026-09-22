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
  classifyIntel,
  deriveDriverRuns,
  fillRate,
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
