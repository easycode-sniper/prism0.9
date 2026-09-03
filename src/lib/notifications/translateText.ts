/**
 * Translate a notification's title and message at display time.
 *
 * WHY THIS IS NEEDED AT ALL. Alerts are not authored in the UI: the tick
 * writes a finished English sentence into notifications.title and
 * .message ("00033-523-35 has arrived at DJELFA ZCIGC."), and the pages
 * print the column. Translating the app therefore does nothing for them,
 * and the notifications feed and every toast stay English no matter how
 * complete the dictionary gets.
 *
 * WHY AT DISPLAY TIME rather than at write time. The alternative was to
 * store the kind plus its parameters and build the sentence in the UI,
 * which is the tidier shape. Two things decided it the other way, with
 * the owner's agreement on 2026-09-03: there were already 1241 rows
 * written the old way, and re-rendering them is the only thing that
 * translates the HISTORY as well as the next alert; and the writer runs
 * every minute against live trucks, which is not where you want a
 * migration for a cosmetic win. Nothing here touches the database.
 *
 * WHAT IS NOT TRANSLATED, deliberately: the place and vehicle names
 * inside the sentence. "DJELFA ZCIGC", "PARC OMD - Headquarters &
 * Parking" and "Zone d'attente – Usine AMOUDA Ciment" are the names of
 * real places as the operators say them, and truck IDs are identifiers.
 * They are captured and put back verbatim.
 *
 * THE PATTERNS BELOW WERE BUILT AGAINST THE LIVE TABLE, not against the
 * writer. Reading positionCheck.ts alone would have missed the title
 * "Arrived at factory" — one row, written before the wording gained its
 * "the" — and the two TEST rows. If the tick's wording ever changes,
 * these stop matching and the alert falls back to English rather than
 * breaking; scripts/check-i18n.mts cannot catch that, so change the
 * wording and the pattern together.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Every stored title, including the ones no longer written.
 *
 * A title is a whole phrase with no variable in it, so it needs matching
 * rather than parsing: t() is asked for the English and gives back the
 * French, and an unrecognised title comes back unchanged.
 */
const TITLES = [
  "Arrived at the factory",
  "Arrived at factory",
  "Arrived at headquarters",
  "Arrived at destination",
  "Arriving at client shortly",
  "Truck left assigned route",
  "Speed limit exceeded",
  "Stopped at a blacklisted station",
  "TEST — Truck reached the factory",
  "TEST — Arriving at client shortly",
  "Alert",
] as const;

/**
 * Message shapes, most specific first.
 *
 * "has arrived at" covers three different kinds — factory, parc and
 * client — because the tick writes them all the same way. That is fine:
 * the sentence is what is being translated, not the kind.
 */
const MESSAGES: { re: RegExp; key: string; vars: string[] }[] = [
  {
    re: /^(.+?) has deviated from its route to (.+) \(([\d.]+)km off\)\.$/,
    key: "{truck} has deviated from its route to {site} ({km}km off).",
    vars: ["truck", "site", "km"],
  },
  {
    // Nine rows in the table are written this way and no code produces it
    // any more: speeding used to be checked only for trucks on a dispatched
    // run, so the message could name the destination. It went fleet-wide on
    // 2026-08-28 and the wording lost the clause. Only reading the live
    // table turned this up — positionCheck.ts has no trace of it.
    re: /^(.+?) is going (\d+)km\/h on the run to (.+) \(limit (\d+)km\/h\)\.$/,
    key: "{truck} is going {speed}km/h on the run to {site} (limit {limit}km/h).",
    vars: ["truck", "speed", "site", "limit"],
  },
  {
    re: /^(.+?) is going (\d+)km\/h \(limit (\d+)km\/h\)\.$/,
    key: "{truck} is going {speed}km/h (limit {limit}km/h).",
    vars: ["truck", "speed", "limit"],
  },
  {
    re: /^(.+?) is about (.+?) from (.+)\.$/,
    key: "{truck} is about {duration} from {site}.",
    vars: ["truck", "duration", "site"],
  },
  {
    re: /^(.+?) has stopped at (.+)\.$/,
    key: "{truck} has stopped at {place}.",
    vars: ["truck", "place"],
  },
  {
    re: /^(.+?) has arrived at (.+)\.$/,
    key: "{truck} has arrived at {place}.",
    vars: ["truck", "place"],
  },
];

/** The two one-off TEST rows, which have no variables to pull out. */
const WHOLE_MESSAGES = [
  "TEST ALERT (not a real run): this is the factory arrival alert, the cue to dispatch a truck.",
  "TEST ALERT (not a real run): this is the client 5-minute alert, which was rejected by the database until now.",
] as const;

/**
 * Every key this module asks t() for.
 *
 * check-i18n.mts reads it. The keys are looked up from the tables above
 * rather than written as literals at a call site, so the scanner has no
 * way to find them on its own and would leave the whole notifications
 * feed unchecked — the one part of the UI where a missing translation is
 * least visible in the diff and most visible on screen.
 */
export const NOTIFICATION_KEYS: string[] = [
  ...TITLES,
  ...WHOLE_MESSAGES,
  ...MESSAGES.map((m) => m.key),
];

export function translateNotificationTitle(t: Translate, title: string): string {
  return (TITLES as readonly string[]).includes(title) ? t(title) : title;
}

export function translateNotificationMessage(t: Translate, message: string): string {
  if ((WHOLE_MESSAGES as readonly string[]).includes(message)) return t(message);

  for (const { re, key, vars } of MESSAGES) {
    const m = message.match(re);
    if (!m) continue;
    const filled: Record<string, string> = {};
    vars.forEach((name, i) => { filled[name] = m[i + 1]; });
    return t(key, filled);
  }
  // Unrecognised: better the English sentence the operator has been
  // reading for months than a blank or a mangled one.
  return message;
}
