import { normalizeName } from "./match";

// Wialon's driver library doubles as a scratchpad. Alongside real people
// it holds vehicle-state placeholders someone assigns to a truck when it
// is out of service, plus test entries. These aren't drivers and they
// dominate the list, so they never reach the page.
//
// Matched on whole normalized tokens rather than substrings: a substring
// test on "TEST" would also swallow a real surname containing those four
// letters, and the point of this list is to remove noise, not people.
const JUNK_TOKENS = new Set([
  "TEST",
  "PANNE",
  "PANNES",
  "ANDERSON",
  "PLATEAU",
  "PLATEAUX",
]);

/** True when the name is a placeholder rather than a person. */
export function isJunkDriverName(raw: string): boolean {
  const normalized = normalizeName(raw);
  if (!normalized) return true;

  const parts = normalized.split(" ");
  // Every token is junk — "PANNE", "TEST 2", "PLATEAU PLATEAU". A real
  // name that merely contains one of these words as one token among
  // several is kept.
  return parts.every((p) => JUNK_TOKENS.has(p));
}
