// Does the dashboard's cache serve the right answer, and drop the right ones?
//
// This backs a performance fix, and a performance fix that returns the
// WRONG numbers is worse than the slow page it replaced. The assertions
// that matter most here are the ones about identity: a key must not
// collide across ranges or scopes, because a hit is painted immediately
// and without question.
//
// Relative ".ts" imports, not "@/": bare node cannot resolve tsconfig
// paths. Same as the other check scripts here.

import { makeCache, isFresh, FRESH_MS, MAX_ENTRIES } from "../src/lib/dashboard/cache.ts";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` — ${detail}`}`);
}

const T0 = 1_757_000_000_000;

console.log("\nstoring and reading back:");
{
  const c = makeCache<string>();
  check("a miss is null", c.get("a", T0) === null);
  c.set("a", "first", T0);
  const hit = c.get("a", T0);
  check("a hit returns the value", hit?.value === "first", `got ${hit?.value}`);
  check("a hit just stored has age 0", hit?.ageMs === 0, `got ${hit?.ageMs}`);
  check("age is measured from the store time", c.get("a", T0 + 5_000)?.ageMs === 5_000);
  check("a rewrite replaces the value", (c.set("a", "second", T0 + 1), c.get("a", T0 + 1)?.value === "second"));
  check("a rewrite resets the age", c.get("a", T0 + 1)?.ageMs === 0);
}

console.log("\nkeys must not collide — a hit is painted without question:");
{
  const c = makeCache<string>();
  c.set("2026-08-01|2026-08-31|", "august fleet", T0);
  c.set("2026-09-01|2026-09-14|", "september fleet", T0);
  c.set("2026-08-01|2026-08-31|?truck=T-1", "august one truck", T0);
  check("two ranges are two entries", c.get("2026-08-01|2026-08-31|", T0)?.value === "august fleet");
  check("the other range is untouched", c.get("2026-09-01|2026-09-14|", T0)?.value === "september fleet");
  check("scope is part of the key", c.get("2026-08-01|2026-08-31|?truck=T-1", T0)?.value === "august one truck");
  check("three distinct keys stored three entries", c.size() === 3, `${c.size()}`);
}

console.log("\nfreshness:");
check("just stored is fresh", isFresh(0));
check("one second under the line is fresh", isFresh(FRESH_MS - 1));
check("exactly the line is NOT fresh", !isFresh(FRESH_MS));
check("well past the line is not fresh", !isFresh(FRESH_MS * 10));
// A stale entry is still SERVED — it is only the skipping of the request
// that freshness governs. That is the whole stale-while-revalidate rule.
{
  const c = makeCache<string>();
  c.set("a", "old", T0);
  const hit = c.get("a", T0 + FRESH_MS * 5);
  check("a stale entry is still returned, not dropped", hit?.value === "old");
  check("and it reports itself as stale", !isFresh(hit!.ageMs));
}

console.log("\neviction stays bounded:");
{
  const c = makeCache<number>(3);
  for (let i = 0; i < 10; i++) c.set(`k${i}`, i, T0 + i);
  check("never grows past its bound", c.size() === 3, `${c.size()}`);
  check("the newest survive", c.get("k9", T0)?.value === 9);
  check("the oldest are gone", c.get("k0", T0) === null);
}
{
  // The bug this guards: a Map keeps INSERTION order, so an entry
  // written once and refreshed forever would still be evicted as "the
  // oldest" unless the rewrite moves it to the end.
  const c = makeCache<string>(3);
  c.set("hot", "v1", T0);
  c.set("b", "b", T0 + 1);
  c.set("c", "c", T0 + 2);
  c.set("hot", "v2", T0 + 3);   // refreshed — must move to the end
  c.set("d", "d", T0 + 4);      // evicts one; it must be "b", not "hot"
  check("a refreshed entry is not evicted as the oldest", c.get("hot", T0)?.value === "v2");
  check("the genuinely oldest went instead", c.get("b", T0) === null);
  check("default bound is the documented one", makeCache<number>().size() === 0 && MAX_ENTRIES === 12);
}

console.log("\nedges:");
{
  const c = makeCache<string>();
  c.set("a", "v", T0);
  // A browser clock that jumps backwards must not produce an entry from
  // the future that can never go stale. Same guard feedAgeSeconds makes.
  check("a clock jumping backwards reads as just-stored",
    c.get("a", T0 - 60_000)?.ageMs === 0, `${c.get("a", T0 - 60_000)?.ageMs}`);
  c.clear();
  check("clear empties it", c.size() === 0 && c.get("a", T0) === null);
}
{
  // undefined is a legitimate value to cache (a bundle with no options),
  // so a hit must be distinguishable from a miss by the WRAPPER, not by
  // the value being falsy.
  const c = makeCache<string | undefined>();
  c.set("a", undefined, T0);
  check("caching undefined is still a hit", c.get("a", T0) !== null);
  check("and it yields undefined", c.get("a", T0)!.value === undefined);
}

console.log(
  failures === 0
    ? `\nAll dashboard-cache checks passed.\n`
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
