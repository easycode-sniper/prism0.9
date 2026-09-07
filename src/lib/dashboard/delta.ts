// The period-over-period change under each dashboard scorecard.
//
// A PLAIN module, like lib/dashboard/range.ts beside it and for the same
// two reasons: it is pure arithmetic with no React in it, and living
// outside the page means scripts/check-previous-range.mts can load it
// under bare node and check the numbers. Inside dashboard/page.tsx —
// 1,150 lines of client component — none of that is reachable.

export interface PeriodDelta {
  /** ▲, ▼ or =. */
  glyph: string;
  text: string;
  /** Whether the move is good news, bad news, or neither.
   *
   * NOT the same as the direction, and that is the whole point of the
   * field. On four of the five scorecards more is better, so up is good.
   * On the other two more is WORSE and the mapping inverts:
   *
   *   TOTAL VARIANCE is money against the assumed rate — positive means
   *   the fleet spent more than predicted, so a rise is an overspend.
   *
   *   AVERAGE CONSUMPTION is litres per 100km — a rise means every truck
   *   burns more fuel to cover the same ground.
   *
   * Reporting either as "up, and up is green" would put the friendliest
   * colour on the two figures that cost the most money. The owner set
   * the variance rule on 2026-09-07 and confirmed consumption follows
   * it. `null` is no news either way, which is what "=" gets. */
  tone: "good" | "bad" | null;
}

/**
 * One scorecard's period-over-period change, as a phrase.
 *
 * A PERCENTAGE WHERE A PERCENTAGE MEANS SOMETHING, and the absolute
 * change where it does not. Kilometres, litres and dinars are quantities
 * that start at zero and go up, so a percentage of them is honest. Total
 * variance is a SIGNED figure — the fleet can be under the assumed rate
 * one week and over it the next — and "up 340%" from -5,000 to +12,000
 * is arithmetically true and completely misleading. When the sign flips,
 * or the previous window was zero, the change is given in the unit
 * instead.
 *
 * Returns null when there is nothing to say: no comparison window (All
 * time), no data in it, or a figure that was null on one side.
 */
export function periodDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  unit: string,
  format: (n: number) => string,
  // Taken as an argument rather than read from a hook, on describeRange's
  // precedent: this is a plain function, and the one phrase it produces
  // that is not a number still has to speak French.
  t: (key: string) => string,
  /** True where a RISE is bad news — variance and consumption. Defaults
   *  to false, so a card has to opt in to being read backwards. */
  higherIsWorse = false,
): PeriodDelta | null {
  if (current == null || previous == null) return null;

  const diff = current - previous;
  // Not "0": these are sums of floats, and 45.68 vs 45.680000000001 is
  // not a change anybody wants reported as one.
  if (Math.abs(diff) < 0.005) return { glyph: "=", text: t("no change"), tone: null };

  const glyph = diff > 0 ? "▲" : "▼";
  const rose = diff > 0;
  const tone: "good" | "bad" = rose === higherIsWorse ? "bad" : "good";
  const sameSign = current >= 0 === previous >= 0;

  if (previous !== 0 && sameSign) {
    const pct = Math.abs(diff / previous) * 100;
    // Below 0.1% the figure is noise dressed as precision; above 999%
    // the digits stop carrying meaning and the direction is the message.
    if (pct >= 999) return { glyph, text: `${format(Math.abs(diff))} ${unit}`, tone };
    // One decimal below 10%, because 1.7 and 2.4 are different answers
    // and rounding both to 2% throws away the only precision that
    // mattered — but a trailing .0 is a digit that says nothing, so 7.0
    // prints as 7.
    const shown = pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : String(Math.round(pct));
    return { glyph, text: `${shown}%`, tone };
  }

  return { glyph, text: `${format(Math.abs(diff))} ${unit}`, tone };
}

