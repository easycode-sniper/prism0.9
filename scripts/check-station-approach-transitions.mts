// Checks for runBlacklistedStationApproachCheck's entry/exit transitions.
//
// Run: node --experimental-strip-types scripts/check-station-approach-transitions.mts
//
// WHY THIS SCRIPT EXISTS: the approach tier (migration 074) is the "still
// time to phone the driver" warning between the 30km ring and the 150m
// stop watch. Its single most important behaviour is ONE ALERT PER ENTRY
// — a truck lingering inside the ring must not alarm on every tick, and
// a truck that leaves and comes back must alarm again. Those guarantees
// come from the compare-and-set transition, which is exactly what tsc
// cannot see and a transition test can.
//
// The second thing tested here is the DIFFERENCE from the stop check: the
// owner's rule — ANY truck inside the ring raises, with no idle
// requirement and no heading filter. A stop alert answers "he is there
// NOW", so it may wait for the truck to be still; an approach alert
// answers "he is COMING", so it must not wait for anything.
//
// The Supabase client is a stub, exactly like check-station-transitions.mts
// — this is about which trucks the function decides entered and left.

import {
  runBlacklistedStationApproachCheck,
  type ZoneTruck,
  type BlacklistStation,
} from "../src/lib/fleet/positionCheck.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// Ring = 30,000m, the armed radius for SARL OULED DJEMILA (33.655266,
// 0.906610) that this feature exists to serve.
const RING = 30_000;

const STATION_A: BlacklistStation = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "SARL OULED DJEMILA",
  lat: 33.655266,
  lng: 0.90661,
  radiusMeters: 50,
  blacklisted: true,
  approachRadiusMeters: RING,
};
const STATION_B: BlacklistStation = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  name: "GD EL BAYADH",
  lat: 33.85,
  lng: 1.25,
  radiusMeters: 50,
  blacklisted: true,
  approachRadiusMeters: RING,
};
// No ring — the fifty-odd stations the feature is off for.
const STATION_UNARMED: BlacklistStation = {
  id: "cccccccc-0000-0000-0000-000000000003",
  name: "ORDINARY STATION",
  lat: 35.0,
  lng: 1.0,
  radiusMeters: 50,
  blacklisted: true,
  approachRadiusMeters: null,
};

interface Call { stationId: string | null; truckIds: string[] }

/** Answers the two reads the function makes, and records the writes. */
function stubClient(flags: Record<string, string | null>) {
  const calls: Call[] = [];
  const notified: string[] = [];
  const client = {
    from() {
      return {
        select() {
          return {
            in(_col: string, ids: string[]) {
              return {
                data: ids.map((id) => ({
                  truck_id: id,
                  approaching_blacklisted_station_id: flags[id] ?? null,
                })),
                error: null,
              };
            },
          };
        },
        // notifications insert
        insert(rows: { truck_id: string }[]) {
          notified.push(...rows.map((r) => r.truck_id));
          return { error: null };
        },
      };
    },
    rpc(_name: string, args: { p_truck_ids: string[]; p_station_id: string | null }) {
      calls.push({ stationId: args.p_station_id, truckIds: [...args.p_truck_ids] });
      // The real RPC is a compare-and-set returning only rows it CHANGED.
      const changed = args.p_truck_ids.filter((id) => (flags[id] ?? null) !== args.p_station_id);
      for (const id of args.p_truck_ids) flags[id] = args.p_station_id;
      return { data: changed.map((truck_id) => ({ truck_id })), error: null };
    },
  };
  return { client, calls, notified, flags };
}

const INSIDE_A = { lat: STATION_A.lat + 0.15, lng: STATION_A.lng }; // ~17km north of A
const FAR = { lat: 34.6, lng: 2.2 }; // ~200km away, outside every ring

async function run(trucks: ZoneTruck[], flags: Record<string, string | null>) {
  const s = stubClient({ ...flags });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runBlacklistedStationApproachCheck(s.client as any, trucks, [STATION_A, STATION_B, STATION_UNARMED]);
  return s;
}

console.log("\ndisarmed:");

{
  const s = stubClient({ T1: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runBlacklistedStationApproachCheck(s.client as any, [
    { truck_id: "T1", ...INSIDE_A, status: "moving" },
  ], [STATION_UNARMED]);
  check(
    "no armed ring → no reads, no writes, no alerts",
    s.calls.length === 0 && s.notified.length === 0,
    JSON.stringify({ calls: s.calls, notified: s.notified }),
  );
}

console.log("\nentry:");

{
  const s = await run([{ truck_id: "T1", ...INSIDE_A, status: "moving" }], { T1: null });
  check("a MOVING truck entering the ring alerts", s.notified.includes("T1"), JSON.stringify(s.notified));
  check("and is flagged to that station", s.flags.T1 === STATION_A.id, String(s.flags.T1));
  check("exactly ONE notification row", s.notified.length === 1, String(s.notified.length));
}

{
  const s = await run([{ truck_id: "T1", ...INSIDE_A, status: "idle" }], { T1: null });
  check(
    "an IDLE truck inside the ring also alerts — ANY truck, no idle filter",
    s.notified.includes("T1"),
    "the stop check's idle rule must not leak into the approach check",
  );
}

{
  // Already inside and already flagged: the ONE-PER-ENTRY guarantee.
  const s = await run([{ truck_id: "T1", ...INSIDE_A, status: "moving" }], { T1: STATION_A.id });
  check("a truck lingering inside the ring does NOT re-alert", s.notified.length === 0, JSON.stringify(s.notified));
  check("and nothing was written for it", s.calls.length === 0, JSON.stringify(s.calls));
}

console.log("\nexit:");

{
  const s = await run([{ truck_id: "T1", ...FAR, status: "moving" }], { T1: STATION_A.id });
  check("a truck that drove OUT of the ring is seen to leave", s.flags.T1 === null, String(s.flags.T1));
  check("leaving writes only the departure", s.calls.length === 1 && s.calls[0].stationId === null, JSON.stringify(s.calls));
}

console.log("\nre-entry:");

{
  // Leave, then come back — must alert AGAIN. This is what a stale flag
  // would silently swallow, exactly the 2026-09-07 stop-check bug.
  let flags: Record<string, string | null> = { T1: STATION_A.id };
  let s = await run([{ truck_id: "T1", ...FAR, status: "moving" }], flags);
  flags = s.flags;
  s = await run([{ truck_id: "T1", ...INSIDE_A, status: "moving" }], flags);
  check("leaving and returning alerts again", s.notified.includes("T1"), "stale flag would have suppressed this");
}

console.log("\noffline:");

{
  const s = await run([{ truck_id: "T1", ...FAR, status: "offline" }], { T1: STATION_A.id });
  check("an OFFLINE truck keeps its flag, wherever its last fix was", s.flags.T1 === STATION_A.id, String(s.flags.T1));
  check("and nothing is written for it", s.calls.length === 0, JSON.stringify(s.calls));
}

{
  const s = await run([{ truck_id: "T1", ...INSIDE_A, status: "offline" }], { T1: null });
  check("an offline truck inside the ring raises nothing", s.notified.length === 0);
}

{
  const s = await run([], { T1: STATION_A.id });
  check("a truck absent from the feed entirely keeps its flag", s.flags.T1 === STATION_A.id);
}

console.log("\nstation-to-station:");

{
  // Inside B's ring (~40km from A, far outside A's 30km), so the re-alert
  // is a true ring-to-ring transition and not merely the nearest of two.
  const atB = { lat: STATION_B.lat - 0.05, lng: STATION_B.lng + 0.05 };
  const s = await run([{ truck_id: "T1", ...atB, status: "moving" }], { T1: STATION_A.id });
  check("moving from one armed ring to another re-alerts", s.notified.includes("T1"), JSON.stringify(s.notified));
  check("and the flag follows to the new station", s.flags.T1 === STATION_B.id, String(s.flags.T1));
}

{
  // Two rings that OVERLAP must pick the nearer one deterministically.
  const overlap = await run(
    [{ truck_id: "T1", lat: STATION_A.lat + 0.05, lng: STATION_A.lng + 0.2, status: "moving" }],
    { T1: null }
  );
  check("when two rings overlap, the nearest one is flagged", overlap.flags.T1 === STATION_A.id, String(overlap.flags.T1));
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll station-approach transition checks passed.\n");