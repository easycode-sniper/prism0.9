// Prism Intelligence: the behavioral signal behind the dashboard's
// INTELLIGENCE column.
//
// One question only — "how has this truck's consumption changed versus
// its previous comparable period?" — answered deterministically. No
// external AI, no model, no magic numbers outside this file.
//
// Pure: no imports at all, so scripts/check-intelligence.mts exercises
// it under node with no DOM and no Supabase. (Same reason siteZones.ts
// imports geometry relatively — check scripts cannot resolve `@/`.)

export const INTEL_STABLE_PCT = 5;
export const INTEL_WATCH_PCT = 10;
export const INTEL_MIN_FILLS = 3;

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
