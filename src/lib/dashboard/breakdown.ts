/**
 * The two ring breakdowns in the right rail: what the fleet's driver
 * variance looks like as a whole, and what state the trucks are in.
 *
 * WHY THIS IS A MODULE AND NOT TWO REDUCES IN THE PAGE. Both rings
 * answer a question with a denominator, and the failure that matters in
 * a ring is not a wrong slice — it is a MISSING one. Chart.js draws
 * whatever array it is handed, so a state this file does not know about
 * would not appear as an error: the truck would quietly vanish, the
 * slices would stop summing to the number of trucks, and every
 * percentage on the panel would be quietly wrong. `intelBand` therefore
 * has a total fallback rather than a union return, and
 * check-breakdown.mts asserts that every state classifyIntel can emit
 * is named here.
 *
 * A bar chart would survive the same bug by drawing a shorter bar. A
 * ring cannot, which is the whole reason this file exists.
 *
 * COLOUR IS NOT DECIDED HERE. Each caller maps a band to a token, so
 * this module stays free of the taxonomy and the two rings cannot drift
 * apart on what a "watch" truck is.
 */

/** Where a driver's fuel spend fell against the sheet's assumed rate. */
export type VarianceBand = "saving" | "atLimit" | "losing" | "unrated";

/** The order the ring reads in: best news to worst, then no news. */
export const VARIANCE_BANDS: readonly VarianceBand[] = [
  "saving",
  "atLimit",
  "losing",
  "unrated",
] as const;

/**
 * Which band a driver's variance falls in.
 *
 * Banded on the RAW figure, not on the rounded string the table prints.
 * A driver 0.4 DA under the rate is saving money and is counted as such
 * even though the column reads "-0 DA"; banding on the rendered text
 * would round them into "at the limit" and quietly inflate the middle
 * slice with drivers who are not on it.
 *
 * Null is `unrated` rather than excluded. A driver with no fill that
 * logged a distance has no variance to band, and dropping them would
 * make the ring's percentages describe a smaller fleet than the roster
 * above it lists. They get a grey slice and the tooltip says why.
 */
export function varianceBand(varianceDa: number | null | undefined): VarianceBand {
  if (varianceDa == null || !Number.isFinite(varianceDa)) return "unrated";
  if (varianceDa < 0) return "saving";
  if (varianceDa > 0) return "losing";
  return "atLimit";
}

/** The truck states this rail ring draws, worst news last. */
export type IntelBand = "improving" | "stable" | "watch" | "up" | "unclassified";

/** Good news first: the ring then reads as a gradient rather than a
 *  category list, and the reader's eye lands on the same arc the
 *  intelligence column's own colours would lead them to. */
export const INTEL_BANDS: readonly IntelBand[] = [
  "improving",
  "stable",
  "watch",
  "up",
  "unclassified",
] as const;

/**
 * Which band a truck's Prism Intelligence state falls in.
 *
 * The three states that are not judgements are folded together into
 * `unclassified`: NEW VEHICLE, INSUFFICIENT DATA and NO BASELINE all
 * mean "this app has nothing to say about this truck yet", and giving
 * each its own 2px arc would be three ways of drawing the same absence.
 * They stay separate in the intelligence column, where the difference
 * matters to the person reading that one row.
 *
 * `unknown` is a TOTAL bucket, deliberately. classifyIntel is the thing
 * most likely to grow a state, and if a new one appeared and were not
 * added here the ring would quietly under-count the fleet. Falling
 * through to `unclassified` means a new state shows up as a slightly
 * bigger grey slice — visible, harmless, and impossible to miss in a
 * diff — instead of trucks disappearing.
 */
export function intelBand(state: string | null | undefined): IntelBand {
  switch (state) {
    case "improving":
      return "improving";
    case "stable":
      return "stable";
    case "watch":
      return "watch";
    case "up":
      return "up";
    default:
      return "unclassified";
  }
}

/**
 * Count a list into ordered bands.
 *
 * Returns EVERY band, including the ones with a count of zero, because a
 * ring drawn from a sparse array gets its colours from the array index:
 * dropping the empty middle band would put `losing` on the slot `atLimit`
 * is painted. A zero slice draws nothing, so keeping it costs nothing on
 * screen and removes a whole class of off-by-one.
 */
export function countBands<T, B extends string>(
  items: readonly T[],
  bandOf: (item: T) => B,
  order: readonly B[],
): Record<B, number> {
  const out = Object.fromEntries(order.map((b) => [b, 0])) as Record<B, number>;
  for (const item of items) out[bandOf(item)] += 1;
  return out;
}
