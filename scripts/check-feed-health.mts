// Does the live-tracking indicator tell the truth about the feed's age?
//
// This is a regression test for a real outage. On 2026-09-13 the Wialon
// token expired at 16:53 and the fleet feed stopped. The strip showed a
// green "Live tracking active" for the next seventeen hours, because the
// rule it used — `lastUpdated != null && !error` — never asked how old
// the snapshot was. The first assertion below is that exact moment.
//
// Relative ".ts" imports, not "@/": bare node cannot resolve tsconfig
// paths. Same as the other check scripts here.

import { feedHealth, feedAgeSeconds, isFeedUnhealthy } from "../src/lib/fleet/freshness.ts";
import { FEED_STALE_SECONDS, FEED_DOWN_SECONDS } from "../src/lib/constants.ts";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` — ${detail}`}`);
}

const NOW = new Date("2026-09-14T10:14:00+01:00");
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

console.log("\nthe 2026-09-13 outage, which used to read as healthy:");
{
  // The real numbers: last snapshot 2026-09-13 16:53:04, seen the next
  // morning. No read error the whole time — the database was fine, it
  // was the feed INTO the database that had stopped.
  const lastUpdated = new Date("2026-09-13T16:53:04+01:00");
  const health = feedHealth(lastUpdated, null, NOW);
  check("a 17-hour-old feed is NOT live", health !== "live", `got "${health}"`);
  check("a 17-hour-old feed reads as down", health === "down", `got "${health}"`);
  const age = feedAgeSeconds(lastUpdated, NOW)!;
  check("the age is about 17 hours", age > 17 * 3600 && age < 18 * 3600, `${age}s`);
}

console.log("\nthe bands:");
check("just arrived is live", feedHealth(ago(0), null, NOW) === "live");
check("one missed tick is still live", feedHealth(ago(70), null, NOW) === "live");
// A healthy reading can be one tick plus one poll old. This must not alarm.
check("tick + poll latency is still live", feedHealth(ago(119), null, NOW) === "live");
check("one second under the stale line is live",
  feedHealth(ago(FEED_STALE_SECONDS - 1), null, NOW) === "live");
check("exactly the stale line is stale",
  feedHealth(ago(FEED_STALE_SECONDS), null, NOW) === "stale");
check("one second under the down line is stale",
  feedHealth(ago(FEED_DOWN_SECONDS - 1), null, NOW) === "stale");
check("exactly the down line is down",
  feedHealth(ago(FEED_DOWN_SECONDS), null, NOW) === "down");
check("a day old is down", feedHealth(ago(86_400), null, NOW) === "down");

console.log("\nthe states that are not about age:");
check("a read error beats any age",
  feedHealth(ago(0), "connection refused", NOW) === "error", "fresh but failing must say error");
check("a read error beats a stale age",
  feedHealth(ago(86_400), "connection refused", NOW) === "error");
check("nothing ever received is paused", feedHealth(null, null, NOW) === "paused");
check("no age for a feed that never ran", feedAgeSeconds(null, NOW) === null);

console.log("\nedges:");
// A browser clock a little ahead of the server must not render a feed
// "from the future" as some huge negative age.
check("a clock skewed ahead reads as just-now, not negative",
  feedAgeSeconds(new Date(NOW.getTime() + 30_000), NOW) === 0);
check("a skewed-ahead clock is still live",
  feedHealth(new Date(NOW.getTime() + 30_000), null, NOW) === "live");
check("an empty-string error is not an error",
  feedHealth(ago(0), "", NOW) === "live", "falsy error must not trip the error state");

console.log("\nisFeedUnhealthy:");
check("live is healthy", isFeedUnhealthy("live") === false);
for (const bad of ["stale", "down", "error", "paused"] as const) {
  check(`${bad} is unhealthy`, isFeedUnhealthy(bad) === true);
}

console.log(
  failures === 0
    ? `\nAll feed-health checks passed.\n`
    : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
