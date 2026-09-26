/**
 * Axis bounds derived from the data, for the daily series.
 *
 * WHY. On 2026-09-26 the "Consumption per day" chart was unreadable over
 * All time, and the cause was one row: sheet row 9, a 10,000 DA prepaid
 * fill on 2 January recorded as 322.58 litres against 51km, which is
 * 632 L/100km for that day. The daily series is real, the row is real —
 * it is a bulk purchase measured over the distance since the last fill,
 * not a tank top-up — and the app's rule is that no figure is ever
 * adjusted to look better. So the AXIS gives way instead: 259 days of
 * genuine signal live between 40 and 53 L/100km, and one day was
 * stretching the plot to 800 and flattening all of them into the
 * bottom 5% of the chart.
 *
 * WHAT THIS DOES AND DOES NOT DO. It moves the axis in. The outlier does
 * not vanish — it is drawn running off the top edge, which is visible
 * and is the point. An alternative was to aggregate to weekly, which
 * would have hidden the day entirely and made the same panel mean two
 * different things depending on the range selector. Clipping the axis
 * keeps one meaning and loses one mark; aggregating loses the mark and
 * the meaning.
 *
 * NOTHING HAPPENS ON A SHORT RANGE. A 7-day or 30-day view has no
 * outlier to clip, so the returned bounds are the data's own and the
 * chart is byte-for-byte what it was before this existed. That is a
 * property worth asserting rather than hoping for, and check-series-bounds
 * .mts does assert it.
 */

/** How many points before clipping is allowed to start. Below this the
 *  percentiles are the data's own min and max anyway — `percentile_disc`
 *  of 98% over seven values IS the largest — so clipping at that size
 *  would be a no-op with extra steps, and a hard cap on top would hide a
 *  real reading for the sake of tidiness. */
export const MIN_POINTS_TO_CLIP = 8;

/** The default tail, as a fraction. Two percent of 259 days is five, so
 *  the five genuinely quietest and five genuinely loudest days clip and
 *  the other 249 are all on screen. */
export const DEFAULT_TAIL = 0.02;

export interface BoundsOptions {
  /** Pin the floor to zero, for a count or an amount where zero is
   *  meaningful. Off for a rate, which lives in a narrow band above
   *  zero and would be flattened by the anchor. */
  beginAtZero?: boolean;
  /** A ceiling that holds however the data is shaped. The L/100km axes
   *  pass INTEL_CHART_CEILING for this: with a small sample the 98th
   *  percentile can still be the maximum, and one 632 reading must not
   *  be able to set a scale even then. */
  hardMax?: number;
  /** Overridable so the checks can pin a known small sample. */
  minPoints?: number;
  /** Overridable for the same reason. */
  tail?: number;
}

export interface AxisBounds {
  min: number;
  max: number;
}

/**
 * The first value whose 1-based position is at least `fraction` of the
 * count — `percentile_disc`, deliberately, so this and the SQL used to
 * measure the distribution cannot be compared and found to disagree.
 * Returns the input untouched when there is nothing to pick from.
 */
export function percentileDisc(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return NaN;
  const at = Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length)));
  return sorted[at - 1];
}

/**
 * A "nice" axis step at or below `rough`: 1, 2 or 5 times a power of
 * ten. Chart.js picks its own ticks inside whatever max and min it is
 * given, so the only job here is to make sure it is handed round numbers
 * and never a 40.7.
 */
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Round a floor DOWN and a ceiling UP to the nearest nice step, so no
 * data point inside the band is clipped by the rounding itself.
 */
function roundOutward(min: number, max: number): AxisBounds {
  const step = niceStep((max - min) / 5);
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
  };
}

/**
 * The axis a daily series should be drawn on, or null to leave it alone.
 *
 * Null is the honest answer in three cases and is not an error: no
 * usable values, a single value, or every value identical. In each of
 * those a computed axis is worse than Chart.js's own, which at least
 * produces something visible.
 */
export function seriesBounds(
  values: readonly (number | null | undefined)[],
  opts: BoundsOptions = {}
): AxisBounds | null {
  const { beginAtZero = false, hardMax, minPoints = MIN_POINTS_TO_CLIP, tail = DEFAULT_TAIL } = opts;

  const clean = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (clean.length === 0) return null;

  const dataMin = clean[0];
  const dataMax = clean[clean.length - 1];
  if (dataMin === dataMax) return null;

  // Below the clipping threshold the percentiles are just the extremes,
  // so take the extremes and skip the machinery — INCLUDING the hard cap.
  // That word matters and the check script exists because it was wrong
  // the first time: with `hardMax` applied unconditionally, a 7-day view
  // containing one 632 reading had its axis capped at 90 and the reading
  // vanished, which is the exact failure the threshold exists to
  // prevent. A cap is a defence against a bad PERCENTILE; on a sample
  // too small to have one, it is just a way of losing data.
  const mayClip = clean.length >= minPoints;
  const lo = mayClip ? percentileDisc(clean, tail) : dataMin;
  const hi = mayClip ? percentileDisc(clean, 1 - tail) : dataMax;

  // Degenerate input, e.g. a hardMax BELOW the floor. Fall back to the
  // data rather than return an axis that cannot be drawn.
  if (hi <= lo) return { min: dataMin, max: dataMax };

  const bounds = roundOutward(beginAtZero ? 0 : lo, hi);
  if (mayClip && hardMax != null && bounds.max > hardMax) bounds.max = hardMax;
  if (bounds.max <= bounds.min) return { min: dataMin, max: dataMax };
  return bounds;
}
