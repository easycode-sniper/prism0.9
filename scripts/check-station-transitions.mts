// Checks for runBlacklistedStationCheck's arrival/departure transitions.
//
// Run: node --experimental-strip-types scripts/check-station-transitions.mts
//
// WHY THIS SCRIPT EXISTS: on 2026-09-07 the live database held
// 00032-523-35 flagged as being at GD YOUB DAOUD while the truck was
// 49km away and moving. The tick passed only IDLE trucks to this check,
// so a truck that drove away was never in the list the departure branch
// loops over — it was never seen to leave. A flagged truck returning to
// the same station then hits the `now?.id === before` guard and raises
// nothing, which is a missed alert AND, now, a missed email.
//
// tsc cannot see any of that: the types were correct throughout. Only
// the transitions are wrong, so the transitions are what this tests.
//
// The Supabase client is a stub. This is deliberately NOT a database
// test — it is about which trucks the function decides have arrived and
// departed, which is pure logic once the reads are answered.

import { runBlacklistedStationCheck, type ZoneTruck, type BlacklistStation } from "../src/lib/fleet/positionCheck.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const STATION_A: BlacklistStation = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "GD YOUB DAOUD",
  lat: 35.0, lng: 1.0, radiusMeters: 50, blacklisted: true,
};
const STATION_B: BlacklistStation = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  name: "BELLOULA SACI",
  lat: 36.0, lng: 2.0, radiusMeters: 50, blacklisted: true,
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
                data: ids.map((id) => ({ truck_id: id, at_blacklisted_station_id: flags[id] ?? null })),
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

const AT_A = { lat: STATION_A.lat, lng: STATION_A.lng };
const FAR = { lat: 35.5, lng: 1.5 }; // ~65km from A, far outside any watch radius

async function run(trucks: ZoneTruck[], flags: Record<string, string | null>) {
  const s = stubClient({ ...flags });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await runBlacklistedStationCheck(s.client as any, trucks, [STATION_A, STATION_B]);
  return s;
}

console.log("\narrival:");

{
  const s = await run([{ truck_id: "T1", ...AT_A, status: "idle" }], { T1: null });
  check("an idle truck at a blacklisted station alerts", s.notified.includes("T1"), JSON.stringify(s.notified));
  check("and is flagged to that station", s.flags.T1 === STATION_A.id);
}

{
  const s = await run([{ truck_id: "T1", ...AT_A, status: "moving" }], { T1: null });
  check("a truck DRIVING THROUGH raises nothing", s.notified.length === 0, JSON.stringify(s.notified));
  check("and is not flagged, so a later stop still alerts", s.flags.T1 === null, String(s.flags.T1));
}

{
  const s = await run([{ truck_id: "T1", ...AT_A, status: "idle" }], { T1: STATION_A.id });
  check("a truck already parked there does not re-alert", s.notified.length === 0);
}

console.log("\ndeparture — the 2026-09-07 bug:");

{
  // The exact live case: flagged at A, now moving, far away.
  const s = await run([{ truck_id: "T1", ...FAR, status: "moving" }], { T1: STATION_A.id });
  check(
    "a truck that DROVE AWAY is seen to leave",
    s.flags.T1 === null,
    `flag is ${s.flags.T1}, expected null — this is the bug`,
  );
}

{
  const s = await run([{ truck_id: "T1", ...FAR, status: "idle" }], { T1: STATION_A.id });
  check("a truck idle elsewhere is also seen to leave", s.flags.T1 === null);
}

{
  // Leaving and returning, without ever stopping in between — the miss
  // the stale flag caused.
  let flags: Record<string, string | null> = { T1: STATION_A.id };
  let s = await run([{ truck_id: "T1", ...FAR, status: "moving" }], flags);
  flags = s.flags;
  s = await run([{ truck_id: "T1", ...AT_A, status: "idle" }], flags);
  check(
    "leaving and coming back to the SAME station alerts again",
    s.notified.includes("T1"),
    "this is what the stale flag silently suppressed",
  );
}

console.log("\noffline:");

{
  // THE REGRESSION GUARD. The original bug was a status filter at the
  // CALL SITE, where no test could see it; the rule now lives in the
  // function, so it can be tested. An offline truck must not be treated
  // as departed — it has not been seen to leave, and clearing its flag
  // would re-alert the moment its tracker came back.
  const s = await run([{ truck_id: "T1", ...FAR, status: "offline" }], { T1: STATION_A.id });
  check("an OFFLINE truck keeps its flag, wherever its last fix was", s.flags.T1 === STATION_A.id, String(s.flags.T1));
  check("and nothing is written for it", s.calls.length === 0, JSON.stringify(s.calls));
}

{
  const s = await run([{ truck_id: "T1", ...AT_A, status: "offline" }], { T1: null });
  check("an offline truck at a station raises nothing", s.notified.length === 0);
}

{
  const s = await run([], { T1: STATION_A.id });
  check("a truck absent from the feed entirely keeps its flag", s.flags.T1 === STATION_A.id);
}

console.log("\nstation-to-station:");

{
  const s = await run([{ truck_id: "T1", lat: STATION_B.lat, lng: STATION_B.lng, status: "idle" }], {
    T1: STATION_A.id,
  });
  check("moving between two blacklisted stations re-alerts", s.notified.includes("T1"));
  check("and the flag follows to the new station", s.flags.T1 === STATION_B.id);
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll station-transition checks passed.\n");
