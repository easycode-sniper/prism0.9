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
