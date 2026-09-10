// Print normalizeDriverKey() for every name in the shared sample list.
//
// Alone this proves nothing — it is one half of a comparison.
// scripts/check-dashboard-scope.sh runs the SAME list through migration
// 060's public.norm_driver_name() and diffs the two outputs.
//
// WHY THE RULE IS WRITTEN TWICE. Postgres has to know it, because that
// is where the scoped aggregates filter. The client has to know it,
// because the dashboard's two variance tables are narrowed from a list
// the page is already holding rather than by two more round trips. A
// rule implemented twice and checked nowhere is a rule that will drift,
// and the way it would drift here is silent: one man's fuel under his
// name and his deliveries under nobody's.
//
// Relative ".ts" import, not "@/": bare node cannot resolve tsconfig
// paths. Same trick as check-station-transitions.mts.

import { normalizeDriverKey } from "../src/lib/dashboard/scope.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const names = readFileSync(join(here, "sql", "driver-name-samples.txt"), "utf8")
  .split("\n")
  // A trailing newline is not a name. Nothing else is trimmed — leading
  // and internal whitespace are part of what is being tested.
  .filter((l) => l !== "");

for (const name of names) {
  // Tab-separated so the shell side can diff it against psql's unaligned
  // output without either side having to quote anything.
  console.log(`${name}\t${normalizeDriverKey(name)}`);
}
