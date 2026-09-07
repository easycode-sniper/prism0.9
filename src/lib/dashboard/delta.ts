// The period-over-period change under each dashboard scorecard.
//
// A PLAIN module, like lib/dashboard/range.ts beside it and for the same
// two reasons: it is pure arithmetic with no React in it, and living
// outside the page means scripts/check-previous-range.mts can load it
// under bare node and check the numbers. Inside dashboard/page.tsx —
// 1,150 lines of client component — none of that is reachable.

export interface PeriodDelta {
  /** ▲, ▼ or =. Carries the direction, because the line is achromatic:
   *  green and red are spoken for by the truck-state taxonomy. */
  glyph: string;
  text: string;
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
): PeriodDelta | null {
  if (current == null || previous == null) return null;

  const diff = current - previous;
  // Not "0": these are sums of floats, and 45.68 vs 45.680000000001 is
  // not a change anybody wants reported as one.
  if (Math.abs(diff) < 0.005) return { glyph: "=", text: t("no change") };

  const glyph = diff > 0 ? "▲" : "▼";
  const sameSign = current >= 0 === previous >= 0;

  if (previous !== 0 && sameSign) {
    const pct = Math.abs(diff / previous) * 100;
    // Below 0.1% the figure is noise dressed as precision; above 999%
    // the digits stop carrying meaning and the direction is the message.
    if (pct >= 999) return { glyph, text: `${format(Math.abs(diff))} ${unit}` };
    // One decimal below 10%, because 1.7 and 2.4 are different answers
    // and rounding both to 2% throws away the only precision that
    // mattered — but a trailing .0 is a digit that says nothing, so 7.0
    // prints as 7.
    const shown = pct < 10 ? pct.toFixed(1).replace(/\.0$/, "") : String(Math.round(pct));
    return { glyph, text: `${shown}%` };
  }

  return { glyph, text: `${format(Math.abs(diff))} ${unit}` };
}

