/**
 * The "Variance by month" panel's pure logic (migration 078).
 *
 * WHY A MODULE FOR FOUR LABELS. Three of the rules below are decisions
 * that fail SILENTLY, which is the only kind worth a test: the RPC hands
 * its months back newest-first so its LIMIT keeps recent months, and the
 * chart needs them oldest-first, so a dropped `.reverse()` renders a
 * correct set of numbers along a right-to-left axis and no type checker
 * or linter will ever mention it. The same goes for the current month
 * being drawn as a pale wash rather than dropped, and for a month that
 * SAVED money not being painted as a loss. The arithmetic here is
 * trivial; what is expensive is finding out in March that the bars have
 * been backwards since September.
 *
 * It lives in lib rather than in the page so it can be imported with
 * `node --experimental-strip-types` — no React, no Supabase, no
 * `@/` alias, and therefore no DOM. See scripts/check-months.mts.
 */

/** One calendar month's totals, as the RPC returns them. */
export interface MonthlyVariance {
  /** The month, YYYY-MM-01, in the operations timezone. */
  month: string;
  /** Fills that logged a distance — the denominator for km and the rate. */
  pairedFills: number;
  fills: number;
  km: number;
  litres: number;
  amountDa: number;
  varianceDa: number;
  litresPer100Km: number | null;
}

/**
 * "2026-08-01" -> "2026-08".
 *
 * The month as a COMPARABLE key. The full date is what the RPC and
 * PostgREST speak; everything a decision needs here — is this the month
 * we are in, is it the same month as last year — is a question about the
 * seven characters, and comparing dates for it would put a timezone
 * conversion in the middle of a boolean.
 */
export function monthKey(month: string): string {
  return month.slice(0, 7);
}

/** "2026-08-01" -> "Aug", for an axis that has to fit up to sixty of them. */
export function monthAxisLabel(month: string): string {
  // Noon UTC, formatted in UTC: the value is a month, and reading it as
  // an instant could land the label in the month before it when the
  // server is west of Greenwich.
  return new Date(`${monthKey(month)}-01T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * "2026-08-01" -> "August 2026", for the tooltip title, where there is
 * room for what the axis abbreviates. A bar labelled "Aug" invites being
 * compared with a bar labelled "Sep" without noticing the year is the
 * same, and the year is the half of the label that changes.
 */
export function monthFullLabel(month: string): string {
  return new Date(`${monthKey(month)}-01T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Is this the month we are in? The panel draws it differently, so the
 * comparison is on the key and not on a range: `opsToday` is the
 * operations-timezone day, and the month is in the operations timezone
 * too, so their first seven characters are the same calendar.
 */
export function isCurrentMonth(month: string, opsToday: string): boolean {
  return monthKey(month) === monthKey(opsToday);
}

/** The headline figure in the panel's top-right corner. */
export function totalVariance(months: readonly MonthlyVariance[]): number {
  return months.reduce((sum, m) => sum + m.varianceDa, 0);
}

/**
 * The bar's fill.
 *
 * RED IS MONEY LOST, which is what the variance columns already mean, so
 * this reuses CHART_COLORS.red rather than BAR_SERIES' cream — a cream
 * bar beside a cream line would leave the reader to work out which is
 * which, and this panel's line is the consumption rate, not a second
 * measure of the same thing. Green is a month that came in UNDER the
 * assumed 45, which is the one thing the sheet can report that is good
 * news; zero counts as red, because a month that merely broke even is
 * not a saving and must not be painted like one.
 *
 * `partial` is the current month: 24 days of fills against August's 31,
 * so its bar is low for that reason alone, and at half the strength it
 * reads as provisional rather than as a recovery that is still moving.
 * A partial month that SAVED stays green, at the same reduced strength.
 */
export function monthBarColour(varianceDa: number, partial: boolean): string {
  const alpha = partial ? 0.22 : 0.45;
  return varianceDa >= 0
    ? `rgba(255, 45, 63, ${alpha})` // CHART_COLORS.red
    : `rgba(0, 255, 123, ${alpha})`; // CHART_COLORS.green
}

/**
 * The RPC's rows, as the panel wants them: oldest month first.
 *
 * The ORDER IS THE POINT of the reverse. `fuel_variance_by_month` sorts
 * DESC because that is what makes `LIMIT 24` keep the twenty-four months
 * a reader is looking at rather than the twenty-four that preceded the
 * founding of the company. A time series wants the other end.
 */
export function toMonthlyVariance(
  rows: readonly Record<string, unknown>[]
): MonthlyVariance[] {
  const num = (v: unknown) => (v == null ? 0 : Number(v));
  return rows
    .map((r) => ({
      month: String(r.month ?? "").slice(0, 10),
      pairedFills: num(r.paired_fills),
      fills: num(r.fills),
      km: num(r.km),
      litres: num(r.litres),
      amountDa: num(r.amount_da),
      varianceDa: num(r.variance_da),
      litresPer100Km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
    }))
    // A row with no month cannot be placed on the axis, and a bar with
    // no label is a bar nobody can read. Dropping it here is better than
    // rendering "Invalid Date" into a tooltip.
    .filter((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.month))
    .reverse();
}
