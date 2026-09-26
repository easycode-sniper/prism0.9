// Prism Intelligence: the behavioral signal behind the dashboard's
// INTELLIGENCE column.
//
// One question only — "how has this truck's consumption changed versus
// its previous comparable period?" — answered deterministically. No
// external AI, no model, no magic numbers outside this file.
//
// Pure: imports only the sibling parse module (itself import-free), so
// scripts/check-intelligence.mts exercises it under node with no DOM
// and no Supabase. (Same reason siteZones.ts imports geometry
// relatively — check scripts cannot resolve `@/`.)

import { ASSUMED_L_PER_100KM } from "./parse.ts";

export const INTEL_STABLE_PCT = 5;
export const INTEL_WATCH_PCT = 10;
export const INTEL_MIN_FILLS = 3;

/** Visual Y-axis ceiling for the consumption trend (spec §12). Display
 *  only — never a threshold, never applied to data or calculations. */
export const INTEL_CHART_CEILING = 90;

export type IntelState =
  | "stable"
  | "watch"
  | "up"
  | "improving"
  | "no_baseline"
  | "new_vehicle"
  | "insufficient";

export interface IntelPeriod {
  fills: number;
  litresPer100Km: number | null;
}

export interface IntelResult {
  state: IntelState;
  /** Signed percentage change, one-decimal precision. Null unless the
   *  state is stable/watch/up/improving. */
  pct: number | null;
}

/**
 * Classify one truck. `previous` is its row over the comparison window
 * (null when the truck has no fills there); `historyFills` is its fill
 * count over ALL history before the current range (null when unknown —
 * then nothing can be said about either, so no_baseline).
 *
 * Both windows need INTEL_MIN_FILLS fills and a real rate, otherwise the
 * figure would be one tank masquerading as behavior: INSUFFICIENT DATA.
 */
export function classifyIntel(
  current: IntelPeriod,
  previous: IntelPeriod | null,
  historyFills: number | null
): IntelResult {
  if (previous == null) {
    if (historyFills === 0) return { state: "new_vehicle", pct: null };
    return { state: "no_baseline", pct: null };
  }
  if (
    current.fills < INTEL_MIN_FILLS ||
    previous.fills < INTEL_MIN_FILLS ||
    current.litresPer100Km == null ||
    previous.litresPer100Km == null ||
    previous.litresPer100Km === 0
  ) {
    return { state: "insufficient", pct: null };
  }
  const pct =
    Math.round(((current.litresPer100Km - previous.litresPer100Km) / previous.litresPer100Km) * 1000) / 10;
  if (pct > INTEL_WATCH_PCT) return { state: "up", pct };
  if (pct > INTEL_STABLE_PCT) return { state: "watch", pct };
  if (pct < -INTEL_STABLE_PCT) return { state: "improving", pct };
  return { state: "stable", pct };
}

/** Per-fill observation behind the trend chart. A fill with no usable
 *  distance yields no rate — skipped by the chart, never zeroed. */
export function fillRate(litresFilled: number | null, distanceKm: number | null): number | null {
  if (litresFilled == null || distanceKm == null || distanceKm <= 0) return null;
  return Math.round((litresFilled * 100) / distanceKm * 100) / 100;
}

export interface FillPoint {
  occurredAt: string;
  driverName: string | null;
}

export interface DriverRun {
  /** Null where the fills carry no driver — rendered as "assignment
   *  unavailable", never guessed. */
  driver: string | null;
  /** ISO instants of the run's first and last fill: exact evidence, not
   *  an invented assignment span. */
  from: string;
  to: string;
  fills: number;
}

/**
 * Contiguous same-driver runs over date-sorted fills. A driver change
 * between two consecutive fills is where one run ends and the next
 * begins — the timeline marks exactly those boundaries, because they
 * are the only assignment facts the data states.
 */
export function deriveDriverRuns(fills: FillPoint[]): DriverRun[] {
  const runs: DriverRun[] = [];
  for (const f of fills) {
    const last = runs[runs.length - 1];
    if (last && (last.driver ?? "") === (f.driverName ?? "")) {
      last.to = f.occurredAt;
      last.fills += 1;
    } else {
      runs.push({ driver: f.driverName, from: f.occurredAt, to: f.occurredAt, fills: 1 });
    }
  }
  return runs;
}

/** Signed distance to the 45 management limit, 2dp. Positive = above.
 *  The limit itself is parse.ts's — one source of truth, never a copy. */
export function limitDelta(litresPer100Km: number, limit = ASSUMED_L_PER_100KM): number {
  return Math.round((litresPer100Km - limit) * 100) / 100;
}

// ── The driver's star rating (the "Best performing drivers" panel) ──
//
// WHY A RATING EXISTS AT ALL, since the leaderboard already ranks by the
// same number. A rank says "third of one hundred" and a reader cannot
// tell whether third is good; a rating says "4.7" and answers it without
// needing to know how many drivers there are. It is the SAME figure
// either way — there is no second opinion hiding in it.
//
// THE SCALE, and why 3.0 is the anchor rather than 2.5:
//
//   variance_da is the sheet's own écart — what was paid, less what the
//   assumed 45 L/100km says it should have cost. So a driver sitting at
//   exactly zero variance per 100km is burning precisely the rate the
//   fleet budgets for, and that is the only defensible place to put the
//   middle of the scale. Anchoring on the fleet's median instead would
//   quietly redefine "average driver" as the arithmetic middle of
//   whatever the current range happens to contain, and 3 stars would mean
//   something different every time the range changed.
//
//   One star per 100 DA/100km, because 100km is the unit the rest of the
//   app already measures fuel in, so the number under the star is the
//   same number the L/100km column reports. Anchors, all round:
//
//     5.0  at  -200 DA/100km or better   (saved 200 DA for every 100km)
//     3.0  at      0                     (exactly the assumed rate)
//     1.0  at  +200 DA/100km or worse
//
//   Clamped at both ends, so the worst driver on record cannot print
//   "-25.2 stars" and the best cannot print "34.8". Nobody reaches 5.0
//   without genuinely saving money at a scale worth naming.
//
// NOT A SCORE OUT OF A CLASS. Two things it deliberately does not do:
// weight distance into the number (the distance floor on the panel
// already decides who is eligible, and folding it in again would let one
// enormous month carry a steady driver off the table), or say anything
// about safety, punctuality or hours. It measures exactly one thing —
// fuel cost against the fleet's own assumption — and a star that meant
// "a good driver" would be claiming four things the data cannot support.

/** The rating's floor and ceiling. Never printed outside this range. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

/** The rating a driver earns by burning exactly the assumed rate. */
export const RATING_AT_LIMIT = 3;

/** One star per this many dinars of variance per 100km. */
export const RATING_DA_PER_STAR = 100;

/**
 * A driver's star rating, 1.0 to 5.0 at one decimal.
 *
 * `variancePer100Km` is the RPC's own figure — dinars of overspend per
 * 100km — and it is NULL for a driver with no fills that logged a
 * distance. Null in, null out: there is no rate, so there is nothing to
 * rate, and printing a row of dashes where a number should be would hide
 * the one case the reader needs to see.
 */
export function driverRating(variancePer100Km: number | null): number | null {
  if (variancePer100Km == null || !Number.isFinite(variancePer100Km)) return null;
  const raw = RATING_AT_LIMIT - variancePer100Km / RATING_DA_PER_STAR;
  const clamped = Math.max(RATING_MIN, Math.min(RATING_MAX, raw));
  // One decimal, and round-half-up on the scaled integer rather than
  // toFixed's float behaviour: 4.65 must not print as "4.6" because
  // 4.65 is not representable and lands just under.
  return Math.round(clamped * 10) / 10;
}

/**
 * The distance a driver must cover to appear on the leaderboard at all:
 * half the median driver's distance for the SAME range.
 *
 * WHY THE MEDIAN AND NOT A NUMBER. A fixed floor is wrong at both ends
 * of the range selector — 20,000km is a season's work on a year and
 * several lifetimes on a week — so it would have to be scaled by hand
 * and would be wrong in between. The median is already being computed
 * for the roster and moves with the range on its own.
 *
 * WHY HALF, rather than the median itself. The median keeps exactly half
 * the fleet and throws the other half away on a rule nobody would guess;
 * half the median is a floor thin enough to keep 138 of 196 drivers
 * today, which is the point — this is meant to exclude the handful of
 * three-fill samples whose rate is noise, not to crown a top ten.
 *
 * The measured reason it cannot be softer: on a 5-fill floor the
 * highest-rated driver on the sheet had covered 5,124km, while the man
 * who covered 64,838km and saved 109,610 DA rated a tenth of a star
 * lower. That inverts the panel's own criterion — it is a ranking of who
 * drove most, and the floor is what stops a short sample from winning
 * it.
 */
export function leaderboardFloorKm(medianKm: number | null): number {
  if (medianKm == null || !Number.isFinite(medianKm) || medianKm <= 0) return 0;
  return Math.round(medianKm / 2);
}

/** The table cell's reading of a result. Lives here (not the page) so
 *  the column and the detail cannot word the same state two ways. */
export function intelLabel(intel: IntelResult, t: (key: string) => string): string {
  switch (intel.state) {
    case "stable":
      return `● ${t("STABLE")}`;
    case "watch":
      return `↑ ${t("Watch")}`;
    case "up":
      return `↑ +${intel.pct!.toFixed(1)}%`;
    case "improving":
      return `↓ ${intel.pct!.toFixed(1)}%`;
    case "new_vehicle":
      return t("NEW VEHICLE");
    case "insufficient":
      return t("INSUFFICIENT DATA");
    case "no_baseline":
    default:
      return `— ${t("NO BASELINE")}`;
  }
}

/**
 * The cell's colour.
 *
 * For every state but one, the colour IS the state: a rise is red, an
 * improvement green, a watch amber. STABLE carries no direction, so it
 * has nothing to colour — and that is the trap. Dim grey on a truck
 * burning 57 L/100km reads as "nothing to see here", which is the
 * single most expensive misreading the table can make: the truck is
 * steady, which is exactly why nobody is looking at it.
 *
 * So stable is split by LEVEL, and the owner's spec says as much (§25:
 * stable behaviour at an excessive consumption level is not "normal").
 * Above the management limit it goes red; at or below it, green.
 *
 * A stable truck with NO rate keeps the dim. A truck that never logged
 * a distance cannot be measured against the limit, and colouring it
 * green would be claiming a health it has not been shown.
 *
 * The boundary is `> limit`, the same comparison the L/100km column
 * already makes (see consumptionClass), so the two cells in a row can
 * never disagree about the same number.
 *
 * `level` is optional precisely so the FLOATING WINDOW can keep
 * colouring by direction alone: there the current-consumption card
 * already states the level and the conclusion sentence carries both
 * facts, so a red "STABLE" beside a red consumption would say it twice
 * — and a behaviour row going red while the word reads STABLE is the
 * misreading this whole function exists to prevent.
 */
export function intelClass(state: IntelState, level?: number | null): string {
  if (state === "stable" && level != null) {
    return level > ASSUMED_L_PER_100KM ? "c-red" : "c-green";
  }
  switch (state) {
    case "up":
      return "c-red";
    case "improving":
      return "c-green";
    case "watch":
      return "c-amber";
    case "new_vehicle":
      return "t-primary";
    default:
      return "t-dim";
  }
}

export interface ConclusionSegment {
  /** Translation key; values carry pre-formatted numbers. */
  key: string;
  vars: Record<string, string>;
}

/**
 * The factual conclusion (§8–9): behavioral change AND limit status,
 * generated from the numbers. Cases with a comparison produce one
 * sentence; without one, the insufficiency plus whatever IS known
 * (current figure, limit status). Never causation — the vocabulary
 * here is improved/increased/stable/remains, never caused/responsible.
 */
export function buildConclusion(
  current: number | null,
  previous: number | null,
  pct: number | null,
  state: IntelState,
  limit = ASSUMED_L_PER_100KM
): ConclusionSegment[] {
  const abs = pct == null ? "" : Math.abs(pct).toFixed(1);
  const cur = current == null ? "" : current.toFixed(2);
  if (
    current != null &&
    previous != null &&
    pct != null &&
    (state === "stable" || state === "watch" || state === "up" || state === "improving")
  ) {
    const above = current > limit;
    if (state === "improving") {
      return [
        {
          key: above
            ? "Conclusion improved above limit."
            : "Conclusion improved within limit.",
          vars: { x: abs },
        },
      ];
    }
    if (state === "stable") {
      return [
        {
          key: above ? "Conclusion stable above limit." : "Conclusion stable within limit.",
          vars: {},
        },
      ];
    }
    return [
      {
        key: above ? "Conclusion worsened above limit." : "Conclusion worsened within limit.",
        vars: { x: abs },
      },
    ];
  }
  const segments: ConclusionSegment[] = [{ key: "Conclusion no baseline.", vars: {} }];
  if (current != null) {
    segments.push({ key: "Conclusion current is.", vars: { x: cur } });
    if (current > limit) segments.push({ key: "Conclusion current above limit.", vars: {} });
  }
  return segments;
}
