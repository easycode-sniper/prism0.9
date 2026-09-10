// Does the Drivers page's union hold together?
//
// Since migration 059 listDrivers() returns Wialon drivers PLUS directory
// rows that matched none of them, so that a driver added on the page is
// visible at all. That union has one way to go quietly wrong: emitting a
// directory row as its own card when a Wialon driver already claimed it,
// which puts the same person on screen twice with the same phone number.
//
// The fixture is real data, not invented names. Every Wialon spelling
// below is a distinct value taken from dispatches.driver_name /
// zone_visits.driver_name in production on 2026-09-10, and the pair
// BELDJOUHER KAMEL / BELDJOUHEUR KAMEL is the live example of one man
// typed two ways — the case the dedup exists for.
//
// No database and no Wialon: matchDirectory is pure, so this reproduces
// the union in a few lines rather than mocking a fleet API. Run with
//   node --experimental-strip-types scripts/check-driver-union.mts

import { matchDirectory, type DirectoryEntry } from "../src/lib/drivers/match.ts";

interface Card {
  name: string;
  phone: string | null;
  inWialon: boolean;
  inDirectory: boolean;
}

/** The union exactly as listDrivers() builds it. Kept in step by hand;
 *  if that function changes shape, change this with it. */
function buildCards(wialonNames: string[], directory: DirectoryEntry[]): Card[] {
  const claimed = new Set<string>();
  const cards: Card[] = wialonNames.map((n) => {
    const entry = matchDirectory(n, directory)?.entry;
    if (entry) claimed.add(entry.fullName);
    return {
      name: n.trim(),
      phone: entry?.phone ?? null,
      inWialon: true,
      inDirectory: Boolean(entry),
    };
  });
  for (const entry of directory) {
    if (claimed.has(entry.fullName)) continue;
    cards.push({
      name: entry.fullName.trim(),
      phone: entry.phone,
      inWialon: false,
      inDirectory: true,
    });
  }
  return cards;
}

const row = (fullName: string, phone: string | null): DirectoryEntry => ({
  fullName,
  phone,
  address: null,
  hiredOn: null,
});

const wialon = [
  "BELDJOUHER KAMEL",   // same man, two spellings in the live data
  "BELDJOUHEUR KAMEL",
  "HALLA Abderrezak",   // directory drifts to HALLA ABDERRAZAK
  "AMROUCHE Taher",     // directory has AMROUCHE TAHAR
  "ZERRARKA HAMZA",     // no directory row at all
];

const directory = [
  row("BELDJOUHER KAMEL", "0770 00 00 01"),
  row("HALLA ABDERRAZAK", "0770 00 00 02"),
  row("AMROUCHE TAHAR", "0770 00 00 03"),
  row("NEWLY ADDED PERSON", "0770 00 00 04"), // added on the page, no Wialon driver
];

const cards = buildCards(wialon, directory);

let failures = 0;
function check(name: string, pass: boolean, detail: string) {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : ` — ${detail}`}`);
}

// 1. Nobody appears twice. This is the whole point of `claimed`.
const counts = new Map<string, number>();
for (const c of cards) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
const dupes = [...counts.entries()].filter(([, n]) => n > 1);
check("no duplicate cards", dupes.length === 0, `duplicated: ${dupes.map(([n]) => n).join(", ")}`);

// 2. A directory row claimed by a Wialon driver is NOT re-emitted as an
//    orphan. Both Kamel spellings resolve to the one row, so there must
//    be no "not in Wialon" card carrying his phone number.
const kamelOrphan = cards.find((c) => !c.inWialon && c.phone === "0770 00 00 01");
check("claimed row is not also an orphan", kamelOrphan === undefined, "BELDJOUHER KAMEL emitted twice");

// 3. Two Wialon spellings of one man each keep his phone (they both
//    match the same row — that is matching working, not a duplicate row).
const kamels = cards.filter((c) => c.name.startsWith("BELDJOUH"));
check(
  "both spellings resolve to the one directory row",
  kamels.length === 2 && kamels.every((c) => c.phone === "0770 00 00 01"),
  `got ${kamels.map((c) => `${c.name}=${c.phone}`).join(", ")}`
);

// 4. The added-on-the-page row shows up, flagged as not in Wialon.
const added = cards.find((c) => c.name === "NEWLY ADDED PERSON");
check(
  "added driver appears, flagged not-in-Wialon",
  added !== undefined && added.inWialon === false && added.inDirectory === true,
  added ? `inWialon=${added.inWialon}` : "missing entirely — the pre-059 bug"
);

// 5. A Wialon driver with no directory row still renders, with no phone.
const orphanDriver = cards.find((c) => c.name === "ZERRARKA HAMZA");
check(
  "Wialon driver with no directory row still renders",
  orphanDriver !== undefined && orphanDriver.inWialon === true && orphanDriver.phone === null,
  orphanDriver ? `phone=${orphanDriver.phone}` : "missing"
);

// 6. Fuzzy matches still land, so the union did not cost us the join.
const halla = cards.find((c) => c.name === "HALLA Abderrezak");
const amrouche = cards.find((c) => c.name === "AMROUCHE Taher");
check(
  "fuzzy matches still attach their phone",
  halla?.phone === "0770 00 00 02" && amrouche?.phone === "0770 00 00 03",
  `halla=${halla?.phone} amrouche=${amrouche?.phone}`
);

// 7. Card count is exactly Wialon drivers + unclaimed rows.
check("card count adds up", cards.length === 5 + 1, `expected 6, got ${cards.length}`);

console.log(
  failures === 0
    ? `\nAll checks passed (${cards.length} cards: 5 from Wialon, 1 added here).`
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
