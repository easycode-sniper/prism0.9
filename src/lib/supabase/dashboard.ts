"use server";

import { createClient } from "@/lib/supabase/server";
import { opsToday, OPS_UTC_OFFSET } from "@/lib/format";

// Everything the redesigned dashboard reads, in one module so the page
// makes one round trip per section rather than a query per tile.
//
// Every figure here is measured. Nothing on this page is derived from an
// assumed rate or a placeholder: a dashboard that mixes real numbers with
// plausible ones is worse than a smaller dashboard, because nothing on it
// can be trusted without knowing which is which.

// ── The fuel sheet, summed ────────────────────────────────────

export interface FuelPeriodStats {
  /** What the sheet's own date cells say the first and last fill were.
   *  Raw text, not a parsed date — the sheet's date column mixes
   *  month/day and day/month between hand-pasted batches, so these are
   *  shown as written rather than reformatted into a lie. */
  firstRaw: string | null;
  lastRaw: string | null;
  fills: number;
  /** Distance covered between fills, summed. */
  km: number;
  litres: number;
  amountDa: number;
  /** SUM(litres) * 100 / SUM(km), counting only fills that carry a
   *  variance. A fill with no variance is one the sheet could not price
   *  against a distance, which means no kilometres were logged for it —
   *  overwhelmingly a Vh Service vehicle (71 of the 76), plus a handful
   *  of first-ever truck fills with no previous odometer to measure
   *  from. Their litres in the numerator with no distance in the
   *  denominator would overstate what the fleet actually burns, so they
   *  are left out of this figure and counted only in the totals above.
   *
   *  Keyed on variance rather than distance deliberately: the two are
   *  the same set (verified — zero rows have one without the other),
   *  and "the sheet could not compute an écart for this fill" is the
   *  condition that actually means "no kilometres here". */
  litresPer100Km: number | null;
  /** The sheet's écart: what was paid, less what the assumed rate says
   *  the distance should have cost. Positive means the fleet spent more
   *  than the assumption predicted. */
  varianceDa: number;
  /** Litres on fills excluded from the average, and how many there
   *  were. Surfaced rather than hidden: it is the error bar on the
   *  figure above, and the office should be able to see how much of the
   *  month it covers. */
  unpairedLitres: number;
  unpairedFills: number;
  /** What those excluded fills cost. They have no distance, so amount is
   *  the only thing they contribute. */
  unpairedAmountDa: number;
}

// The sheet holds roughly a month of fills (1142 rows at the time of
// writing). Aggregating those in JS costs one round trip and no
// migration; an RPC would be faster and is worth it only once this is
// several months deep.
const FUEL_ROW_CAP = 5000;

export async function getFuelPeriodStats(): Promise<{ stats?: FuelPeriodStats; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  // Ordered by sheet position, which is chronological because the sheet
  // is append-only — and unlike occurred_at, it is not affected by the
  // date column's mixed formats.
  const { data, error } = await supabase
    .from("fuel_transactions")
    .select("distance_km, litres_filled, amount_da, variance_da, occurred_raw, sheet_row")
    .order("sheet_row", { ascending: true, nullsFirst: false })
    .limit(FUEL_ROW_CAP);

  if (error) return { error: error.message };

  const rows = data ?? [];
  let km = 0;
  let litres = 0;
  let amountDa = 0;
  let varianceDa = 0;
  let pairedLitres = 0;
  let unpairedLitres = 0;
  let unpairedFills = 0;
  let unpairedAmountDa = 0;

  for (const r of rows) {
    const l = r.litres_filled != null ? Number(r.litres_filled) : 0;
    const amount = r.amount_da != null ? Number(r.amount_da) : 0;
    // No variance means the sheet had no distance to price this fill
    // against — a staff vehicle, or a truck's first fill. It counts
    // towards what was bought, never towards what the fleet burns.
    const counted = r.variance_da != null;

    amountDa += amount;
    litres += l;

    if (counted) {
      varianceDa += Number(r.variance_da);
      km += r.distance_km != null ? Number(r.distance_km) : 0;
      pairedLitres += l;
    } else {
      unpairedLitres += l;
      unpairedFills += 1;
      unpairedAmountDa += amount;
    }
  }

  return {
    stats: {
      firstRaw: (rows[0]?.occurred_raw as string | null) ?? null,
      lastRaw: (rows[rows.length - 1]?.occurred_raw as string | null) ?? null,
      fills: rows.length,
      km,
      litres,
      amountDa,
      litresPer100Km: km > 0 ? (pairedLitres * 100) / km : null,
      varianceDa,
      unpairedLitres,
      unpairedFills,
      unpairedAmountDa,
    },
  };
}

// ── Daily series ──────────────────────────────────────────────

export interface DayPoint {
  /** ISO date, YYYY-MM-DD, in the operations day. */
  day: string;
  value: number;
}

export interface DashboardSeries {
  /** Kilometres per operations day, from the table pg_cron writes. */
  km: DayPoint[];
  /** Alerts raised per day — off-route, speeding, arrivals. */
  alerts: DayPoint[];
  /** Litres bought per day, summed from the pump transactions. */
  litres: DayPoint[];
  /** Litres per 100km per day, on the same rule the headline figure
   *  uses: only fills carrying a variance, because a fill without one
   *  had no distance logged against it. A day with no such fill has no
   *  consumption to report and comes back as 0. */
  consumption: DayPoint[];
  /** How many days of history actually exist behind the longest series,
   *  so the page can show a range control that does not promise more
   *  than it has. */
  daysAvailable: number;
}

/** Fills a day-keyed count map into a dense, ascending series so a gap in
 *  the data reads as a zero rather than as a shorter chart. */
function densify(counts: Map<string, number>, days: number): DayPoint[] {
  const out: DayPoint[] = [];
  const today = new Date(`${opsToday()}T12:00:00${OPS_UTC_OFFSET}`);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: counts.get(key) ?? 0 });
  }
  return out;
}

export async function getDashboardSeries(
  days = 30
): Promise<{ series?: DashboardSeries; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  const span = Math.min(Math.max(days, 1), 90);
  const from = new Date(`${opsToday()}T12:00:00${OPS_UTC_OFFSET}`);
  from.setUTCDate(from.getUTCDate() - (span - 1));
  const fromDay = from.toISOString().slice(0, 10);
  const fromInstant = `${fromDay}T00:00:00${OPS_UTC_OFFSET}`;

  const [metrics, alerts, fuel] = await Promise.all([
    supabase
      .from("fleet_day_metrics")
      .select("ops_day, km")
      .gte("ops_day", fromDay)
      .order("ops_day", { ascending: true }),
    supabase
      .from("notifications")
      .select("created_at")
      .gte("created_at", fromInstant),
    // Safe to filter on occurred_at now that the sheet's date column is
    // day-first throughout and resolveOccurredAt guards what arrives
    // after. It was not before: half the rows sat in the wrong month.
    supabase
      .from("fuel_transactions")
      .select("occurred_at, litres_filled, distance_km, variance_da")
      .gte("occurred_at", fromInstant),
  ]);

  if (metrics.error) return { error: metrics.error.message };

  // Bucketed at +01:00 rather than UTC, so a fill logged at 00:30 local
  // counts against the day the office worked it, not the previous one.
  const bucket = (rows: { [k: string]: unknown }[] | null, field: string) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const raw = r[field];
      if (typeof raw !== "string") continue;
      const local = new Date(raw);
      if (Number.isNaN(local.getTime())) continue;
      const key = new Date(local.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  };

  const kmByDay = new Map<string, number>();
  for (const r of metrics.data ?? []) {
    kmByDay.set(String(r.ops_day), Number(r.km ?? 0));
  }

  // Litres and consumption share one pass. Consumption needs its own
  // numerator — only the litres on fills that logged a distance — while
  // the litres line counts every drop bought, so they cannot be derived
  // from each other.
  const litresByDay = new Map<string, number>();
  const pairedLitresByDay = new Map<string, number>();
  const pumpKmByDay = new Map<string, number>();

  for (const r of fuel.data ?? []) {
    const raw = r.occurred_at;
    if (typeof raw !== "string") continue;
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) continue;
    const key = new Date(at.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

    const l = r.litres_filled != null ? Number(r.litres_filled) : 0;
    litresByDay.set(key, (litresByDay.get(key) ?? 0) + l);

    if (r.variance_da != null) {
      pairedLitresByDay.set(key, (pairedLitresByDay.get(key) ?? 0) + l);
      pumpKmByDay.set(key, (pumpKmByDay.get(key) ?? 0) + (r.distance_km != null ? Number(r.distance_km) : 0));
    }
  }

  const consumptionByDay = new Map<string, number>();
  for (const [day, dist] of pumpKmByDay) {
    if (dist <= 0) continue;
    consumptionByDay.set(day, ((pairedLitresByDay.get(day) ?? 0) * 100) / dist);
  }

  return {
    series: {
      km: densify(kmByDay, span),
      alerts: densify(bucket(alerts.data, "created_at"), span),
      litres: densify(litresByDay, span),
      consumption: densify(consumptionByDay, span),
      daysAvailable: kmByDay.size,
    },
  };
}
