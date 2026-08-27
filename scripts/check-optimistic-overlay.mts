// Checks for src/lib/optimisticOverlay.ts.
//
// Run: node --experimental-strip-types scripts/check-optimistic-overlay.mts
//
// These are worth having because the whole reason the overlays exist is
// a RACE — a refetch that was already in flight when the write went out —
// and a race is exactly what does not show up when you click around a
// working app. Every case below is one that would look fine by hand and
// be wrong in production.

import { applyFieldOverlay, applyRemovalOverlay } from "../src/lib/optimisticOverlay.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
  }
}

type Notif = { id: string; read: boolean };
const id = (r: { id: string }) => r.id;

console.log("applyFieldOverlay");
{
  // The race the overlay exists for: the user marks n1 read, and a
  // refetch that started BEFORE the write lands still carrying read:false.
  const overlay = new Map<string, boolean>([["n1", true]]);
  const stale: Notif[] = [{ id: "n1", read: false }, { id: "n2", read: false }];
  check(
    "stale refetch does not undo the patch",
    applyFieldOverlay(stale, overlay, "read", id),
    [{ id: "n1", read: true }, { id: "n2", read: false }]
  );
  check("overlay still held while the server disagrees", overlay.size, 1);

  // Now the server has caught up.
  const fresh: Notif[] = [{ id: "n1", read: true }, { id: "n2", read: false }];
  check(
    "confirmed row passes through untouched",
    applyFieldOverlay(fresh, overlay, "read", id),
    fresh
  );
  check("overlay settles once the server agrees", overlay.size, 0);
}
{
  // A notification that ages out of the 24h feed can never confirm, so
  // the entry has to go or it accumulates for the life of the tab.
  const overlay = new Map<string, boolean>([["gone", true]]);
  applyFieldOverlay([{ id: "n2", read: false }], overlay, "read", id);
  check("entry for a row that vanished is dropped", overlay.size, 0);
}
{
  const overlay = new Map<string, boolean>();
  const rows: Notif[] = [{ id: "n1", read: false }];
  check("empty overlay returns the same array identity", applyFieldOverlay(rows, overlay, "read", id) === rows, true);
}
{
  // Rollback writes the opposite value, not a deletion — it has to beat
  // an in-flight refetch too.
  const overlay = new Map<string, boolean>([["s1", false]]);
  check(
    "overlay can hold a value back to false",
    applyFieldOverlay([{ id: "s1", blacklisted: true }], overlay, "blacklisted", id),
    [{ id: "s1", blacklisted: false }]
  );
}
{
  const overlay = new Map<string, boolean>([["n1", true]]);
  const rows: Notif[] = [{ id: "n1", read: false }];
  const out = applyFieldOverlay(rows, overlay, "read", id);
  check("patched row is a copy, source untouched", rows[0].read, false);
  check("patched row carries the new value", out[0].read, true);
}

console.log("applyRemovalOverlay");
{
  // A stopped run: the write succeeded, but listActiveDispatches was
  // already in flight and still returns it as active.
  const overlay = new Set<string>(["d1"]);
  check(
    "stale refetch does not bring the stopped run back",
    applyRemovalOverlay([{ id: "d1" }, { id: "d2" }], overlay, id),
    [{ id: "d2" }]
  );
  check("overlay still held while the run is still returned", overlay.size, 1);

  // Absence IS the confirmation here — the opposite rule to a field
  // overlay, and getting it backwards would hide d2 forever.
  check("confirmed removal passes through", applyRemovalOverlay([{ id: "d2" }], overlay, id), [{ id: "d2" }]);
  check("overlay settles once the row stops being returned", overlay.size, 0);
}
{
  const overlay = new Set<string>();
  const rows = [{ id: "d1" }];
  check("empty overlay returns the same array identity", applyRemovalOverlay(rows, overlay, id) === rows, true);
}
{
  // Two stops in a row, one confirmed and one not.
  const overlay = new Set<string>(["d1", "d2"]);
  check(
    "independent entries settle independently",
    applyRemovalOverlay([{ id: "d2" }, { id: "d3" }], overlay, id),
    [{ id: "d3" }]
  );
  check("only the confirmed one is dropped", [...overlay], ["d2"]);
}

console.log(failures === 0 ? "\nAll overlay checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
