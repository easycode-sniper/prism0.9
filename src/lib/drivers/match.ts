// Matching Wialon driver names against the HR directory.
//
// The two sides are typed by different people and neither is canonical.
// Wialon has "AMROUCHE Taher"; the directory has "AMROUCHE TAHAR". Wialon
// has "AMIR SMARA"; the directory has the same two words the other way
// round. Casing is inconsistent on both sides. So an equality test on the
// raw strings matches almost nothing useful, and this does the work in
// three widening passes instead — stopping at the first one that hits, so
// a confident match is never overridden by a fuzzy one.

/** A name reduced to something comparable: unaccented, uppercase, letters
 *  and single spaces only. Keeps digits out, which is what makes entries
 *  like "TEST 2" collapse onto "TEST". */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(raw: string): string[] {
  const n = normalizeName(raw);
  return n ? n.split(" ") : [];
}

/** Levenshtein, capped: returns `max + 1` as soon as it's clear the real
 *  distance exceeds `max`, so the common "obviously different" case costs
 *  a length check rather than a full matrix. */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/** How much spelling drift to forgive on one token. Short tokens get none:
 *  at 4 letters a single edit is the difference between two real and
 *  distinct Algerian surnames, so tolerating one there invents matches. */
function tolerance(len: number): number {
  if (len <= 4) return 0;
  if (len <= 7) return 1;
  return 2;
}

export type MatchConfidence = "exact" | "reordered" | "contained" | "fuzzy";

export interface DirectoryEntry {
  fullName: string;
  phone: string | null;
  address: string | null;
  hiredOn: string | null;
}

export interface NameMatch<T extends DirectoryEntry> {
  entry: T;
  confidence: MatchConfidence;
}

/**
 * Resolve one Wialon name against the directory.
 *
 * Pass 1 — the normalized strings are identical.
 * Pass 2 — same tokens, any order ("AMIR SMARA" / "SMARA AMIR").
 * Pass 3 — same token count, every token within its spelling tolerance,
 *          and at least one token identical. That last condition is the
 *          guard rail: without it two 8-letter surnames sharing a rough
 *          shape can pair up on nothing but slop.
 *
 * Returns null rather than a best guess when nothing clears pass 3 — an
 * unmatched driver renders as "n/a", which is honest, whereas a wrong
 * match puts another man's home address on the card.
 */
export function matchDirectory<T extends DirectoryEntry>(
  wialonName: string,
  directory: T[]
): NameMatch<T> | null {
  const target = normalizeName(wialonName);
  if (!target) return null;

  for (const entry of directory) {
    if (normalizeName(entry.fullName) === target) {
      return { entry, confidence: "exact" };
    }
  }

  const targetTokens = tokens(wialonName);
  const targetSorted = [...targetTokens].sort().join(" ");
  for (const entry of directory) {
    const entryTokens = tokens(entry.fullName);
    if (entryTokens.length !== targetTokens.length) continue;
    if ([...entryTokens].sort().join(" ") === targetSorted) {
      return { entry, confidence: "reordered" };
    }
  }

  // Pass 3 — one side carries an extra given name: Wialon's "HACHEMI
  // Mohamed elamine" against the directory's "hachemi mohamed". Requires
  // two identical tokens, so a shared given name alone can't trigger it,
  // and bails when two directory rows both qualify — an ambiguous match
  // is worth less than an honest "n/a".
  const targetSet = new Set(targetTokens);
  const contained: T[] = [];
  for (const entry of directory) {
    const entryTokens = tokens(entry.fullName);
    if (entryTokens.length === targetTokens.length) continue;

    const [shortSide, longSet] =
      entryTokens.length < targetTokens.length
        ? [entryTokens, targetSet]
        : [targetTokens, new Set(entryTokens)];

    if (shortSide.length < 2) continue;
    if (shortSide.every((t) => longSet.has(t))) contained.push(entry);
  }
  if (contained.length === 1) return { entry: contained[0], confidence: "contained" };

  // Pass 4 — same token count, every token within its spelling tolerance.
  // Two ways to clear it, because both failure modes are real:
  //
  //   anchored ("HALLA Abderrezak" / "HALLA ABDERRAZAK") — one token is
  //     identical, and that shared surname is enough to trust the pair.
  //     Lowest total edit cost wins if several qualify.
  //
  //   unanchored ("MEGHMOUL NABIL" / "magmoul nabile") — both tokens
  //     drifted, so there is no anchor. The only thing between this and
  //     an invented match is that exactly one directory row qualifies at
  //     all. Two candidates means we genuinely cannot tell, and n/a beats
  //     a coin flip when the payload is a man's home address.
  const anchored: { entry: T; cost: number }[] = [];
  const unanchored: { entry: T; cost: number }[] = [];

  for (const entry of directory) {
    const entryTokens = tokens(entry.fullName);
    if (entryTokens.length !== targetTokens.length) continue;

    // Sorted copies, so a name that is both reordered and misspelled
    // still lines its tokens up.
    const a = [...targetTokens].sort();
    const b = [...entryTokens].sort();

    let cost = 0;
    let anyExact = false;
    let ok = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) {
        anyExact = true;
        continue;
      }
      const allowed = tolerance(Math.max(a[i].length, b[i].length));
      const d = editDistance(a[i], b[i], allowed);
      if (d > allowed) {
        ok = false;
        break;
      }
      cost += d;
    }

    if (!ok) continue;
    (anyExact ? anchored : unanchored).push({ entry, cost });
  }

  if (anchored.length > 0) {
    const best = anchored.reduce((lo, c) => (c.cost < lo.cost ? c : lo));
    return { entry: best.entry, confidence: "fuzzy" };
  }
  if (unanchored.length === 1) {
    return { entry: unanchored[0].entry, confidence: "fuzzy" };
  }

  return null;
}
