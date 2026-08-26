"use server";

import { createClient } from "@/lib/supabase/server";

// Everything the redesigned dashboard reads, in one module so the page
// makes one round trip per section rather than a query per tile.
//
// Every figure here is measured. Nothing on this page is derived from an
// assumed rate or a placeholder: a dashboard that mixes real numbers with
// plausible ones is worse than a smaller dashboard, because nothing on it
// can be trusted without knowing which is which.

// ── The fuel sheet, summed ────────────────────────────────────

export interface FuelPeriodStats {
  /** What the sheet's own date cells say the first and last fill were,
   *  as written. Taken in sheet-row order rather than by date, which is
   *  what makes them correct regardless of how the column is formatted —
   *  the source was mixed month/day and day/month until it was
   *  normalised, and resolveOccurredAt still guards against a batch
   *  arriving that way again. */
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

// Both figures below are summed in Postgres, not here — see migration
// 028. Selecting the rows to add them up in JS has a ceiling nobody sees
// coming: PostgREST caps a response at 1000 rows and does NOT error when
// it truncates, so the month totals were quietly summing 1000 fills of
// 1147, and the 30-day series was already past the cap the day it
// shipped. Paging only moves the ceiling; at ~46 fills a day a year is
// 17,000 rows, and dragging those over the wire to add them is the wrong
// shape however well it fits. An aggregate is one row at any size.

export async function getFuelPeriodStats(): Promise<{ stats?: FuelPeriodStats; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  const { data, error } = await supabase.rpc("fuel_period_stats").single();
  if (error) return { error: error.message };
  if (!data) return { error: "No fuel data" };

  const r = data as Record<string, unknown>;
  const num = (v: unknown) => (v == null ? 0 : Number(v));

  return {
    stats: {
      firstRaw: (r.first_raw as string | null) ?? null,
      lastRaw: (r.last_raw as string | null) ?? null,
      fills: num(r.fills),
      km: num(r.km),
      litres: num(r.litres),
      amountDa: num(r.amount_da),
      litresPer100Km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
      varianceDa: num(r.variance_da),
      unpairedLitres: num(r.unpaired_litres),
      unpairedFills: num(r.unpaired_fills),
      unpairedAmountDa: num(r.unpaired_amount_da),
    },
  };
}

// ── Daily series ──────────────────────────────────────────────

export interface DayPoint {
  /** ISO date, YYYY-MM-DD, in the operations day. */
  day: string;
  /** Null where the day has no value to report, which is not the same as
   *  zero. Consumption on a day with no fill yet is unknown; litres
   *  bought on that day really is zero. Charts draw a gap for null. */
  value: number | null;
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

export async function getDashboardSeries(
  days = 30
): Promise<{ series?: DashboardSeries; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  // The RPC returns one row per day, already dense and already bucketed
  // to the Africa/Algiers operations day — so a fill logged at 00:12
  // local counts against the day the office worked it. At most 90 rows
  // however many fills sit behind them.
  const { data, error } = await supabase.rpc("dashboard_daily_series", { p_days: days });
  if (error) return { error: error.message };

  const rows = (data ?? []) as { day: string; km: string | number; litres: string | number;
                                 consumption: string | number | null; alerts: string | number }[];
  const point = (r: typeof rows[number], field: "km" | "litres" | "consumption" | "alerts") => ({
    day: r.day,
    // Null is carried through rather than floored to zero — see DayPoint.
    value: r[field] == null ? null : Number(r[field]),
  });

  return {
    series: {
      km: rows.map((r) => point(r, "km")),
      alerts: rows.map((r) => point(r, "alerts")),
      litres: rows.map((r) => point(r, "litres")),
      consumption: rows.map((r) => point(r, "consumption")),
      // Days that actually carry a distance reading, so the panel can say
      // how much history is really behind a 30-day frame.
      daysAvailable: rows.filter((r) => Number(r.km ?? 0) > 0).length,
    },
  };
}

// ── Where the variance comes from ─────────────────────────────

export interface DriverVariance {
  driverName: string;
  fills: number;
  km: number;
  litresPer100Km: number | null;
  varianceDa: number;
  /** Dinars of overspend per 100km. The total says who cost the most;
   *  this says who is actually heavy on fuel, and in the current data
   *  they are two different drivers. */
  variancePer100Km: number | null;
}

export async function getDriverVariance(
  limit = 6
): Promise<{ drivers?: DriverVariance[]; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  const { data, error } = await supabase.rpc("driver_variance_leaders", { p_limit: limit });
  if (error) return { error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    drivers: rows.map((r) => ({
      driverName: String(r.driver_name ?? "—"),
      fills: Number(r.fills ?? 0),
      km: Number(r.km ?? 0),
      litresPer100Km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
      varianceDa: Number(r.variance_da ?? 0),
      variancePer100Km: r.variance_per_100km == null ? null : Number(r.variance_per_100km),
    })),
  };
}
