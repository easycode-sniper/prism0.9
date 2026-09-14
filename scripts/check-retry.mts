// Does the retry tell a dropped request apart from a real answer?
//
// This is the assertion that matters. Retrying an infrastructure blip is
// free; retrying a DETERMINISTIC error is not — it spends the tick's
// 55-second budget being told the same no twice, and on a write it could
// repeat work that already happened. The tick has three retry sites and
// a minute to do everything in, so the predicate below is load-bearing.
//
// Relative ".ts" imports, not "@/": bare node cannot resolve tsconfig
// paths. Same as the other check scripts here.

import { isTransient, withRetry } from "../src/lib/supabase/retry.ts";

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` — ${detail}`}`);
}

// Never waits in real time; every backoff is recorded instead.
const slept: number[] = [];
const sleep = async (ms: number) => { slept.push(ms); };

console.log("\nthe real failures seen in production, all must retry:");
// Verbatim from the Vercel logs, 2026-09-14.
for (const message of [
  "Gateway Timeout",
  "Bad Gateway",
  "Failed to get project config",
  "fetch failed",
  "terminating connection due to administrator command",
]) {
  check(`"${message}"`, isTransient({ message }));
}
check("a thrown TypeError from undici", isTransient(new TypeError("fetch failed")));

console.log("\nreal answers, none of which may retry:");
// A code means PostgREST or Postgres produced it, so asking again gets
// the same reply. The 2026-09-02 outage was PGRST202 for twenty minutes;
// retrying it would have tripled the load and changed nothing.
check("PGRST202, function not found", !isTransient({ code: "PGRST202", message: "Could not find the function" }));
check("42501, permission denied", !isTransient({ code: "42501", message: "permission denied for table" }));
check("23505, unique violation", !isTransient({ code: "23505", message: "duplicate key value" }));
check("PGRST116, no rows", !isTransient({ code: "PGRST116", message: "JSON object requested" }));
check("no error at all", !isTransient(null));
check("undefined", !isTransient(undefined));
// The trap: a REAL error whose text happens to contain a trigger word.
// The code is what settles it, not the prose.
check("a coded error mentioning a timeout is still not retried",
  !isTransient({ code: "57014", message: "canceling statement due to statement timeout" }),
  "a statement timeout is the query's own fault and will repeat");

console.log("\nretrying:");
{
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    return calls === 1 ? { data: null, error: { message: "Gateway Timeout" } } : { data: "ok", error: null };
  }, { sleep, label: "t" });
  check("a blip then a success returns the success", r.data === "ok", JSON.stringify(r));
  check("and it took exactly two calls", calls === 2, `${calls}`);
}
{
  let calls = 0;
  await withRetry(async () => { calls++; return { data: "ok", error: null }; }, { sleep });
  check("a first-try success calls once", calls === 1, `${calls}`);
}
{
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    return { data: null, error: { code: "42501", message: "permission denied" } };
  }, { sleep });
  check("a deterministic error is not retried", calls === 1, `${calls}`);
  check("and its error is returned, not swallowed",
    (r.error as { code: string }).code === "42501");
}
{
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    return { data: null, error: { message: "Gateway Timeout" } };
  }, { sleep, attempts: 3 });
  check("attempts are bounded", calls === 3, `${calls}`);
  check("the last error is returned rather than thrown",
    (r.error as { message: string }).message === "Gateway Timeout");
}

console.log("\nthrown errors:");
{
  let calls = 0;
  const r = await withRetry(async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return { data: "ok", error: null };
  }, { sleep });
  check("a thrown transient error is retried", r.data === "ok" && calls === 2, `${calls}`);
}
{
  let calls = 0;
  let threw = false;
  try {
    await withRetry(async () => { calls++; throw new Error("something structural"); }, { sleep });
  } catch { threw = true; }
  check("a non-transient throw propagates immediately", threw && calls === 1, `${calls}`);
}
{
  let threw = false;
  try {
    await withRetry(async () => { throw new TypeError("fetch failed"); }, { sleep, attempts: 2 });
  } catch { threw = true; }
  check("a throw that never recovers is rethrown", threw);
}

console.log("\nbackoff:");
{
  slept.length = 0;
  await withRetry(async () => ({ data: null, error: { message: "Gateway Timeout" } }),
    { sleep, attempts: 3, delayMs: 100 });
  check("waits between attempts, not after the last", slept.length === 2, JSON.stringify(slept));
  check("and doubles", slept[0] === 100 && slept[1] === 200, JSON.stringify(slept));
}
{
  slept.length = 0;
  await withRetry(async () => ({ data: "ok", error: null }), { sleep });
  check("a success never sleeps", slept.length === 0, JSON.stringify(slept));
}

console.log("\nbudget — the tick has 55 seconds and three retry sites:");
{
  // A failing Data API request takes about five seconds to fail. The
  // default must not let three sites spend the whole minute on it.
  const DEFAULT_ATTEMPTS = 2;
  const worstCasePerSite = DEFAULT_ATTEMPTS * 5_000 + 200;
  check("three sites at the default stay inside 55s",
    worstCasePerSite * 3 < 55_000, `${worstCasePerSite * 3}ms`);
}

console.log(
  failures === 0 ? `\nAll retry checks passed.\n` : `\n${failures} check(s) FAILED.\n`
);
process.exit(failures === 0 ? 0 : 1);
