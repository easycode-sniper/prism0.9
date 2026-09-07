// The dashboard's date-range type and its all-time constant.
//
// A PLAIN module, and that is the whole reason it exists. These used to
// live in lib/supabase/dashboard.ts, which is "use server" — and a
// "use server" file may only export ASYNC FUNCTIONS. Next wraps every
// export of such a module as a server-action reference, so a plain
// object export is not merely disallowed, it is broken at runtime: the
// dashboard rendered "An error occurred in the Server Components
// render" in production with the message stripped, which is about as
// hard to diagnose as an error gets.
//
// The build did NOT catch it, which is worth knowing. The same mistake
// in lib/supabase/unloaded.ts failed the build loudly, because a client
// component imported the constant and tripped the boundary check. Here
// nothing outside dashboard.ts imported ALL_TIME — it was only a default
// argument — so no client boundary was crossed at compile time and the
// error waited until a request actually ran. Keep non-functions out of
// "use server" files even when the compiler lets you.

/**
 * An inclusive range of OPERATIONS DAYS, as YYYY-MM-DD strings.
 *
 * Days, not instants, because that is the axis the data already lives
 * on: migration 028 buckets a fill by (occurred_at AT TIME ZONE
 * 'Africa/Algiers')::date, so a fill logged at 00:12 local belongs to
 * the day the office worked it rather than to the previous UTC one.
 * Algiers does not observe DST, so an ops day is a clean 24 hours.
 *
 * That also makes "today, midnight to 23:59" trivially expressible —
 * from and to are the same date — without the caller assembling
 * timestamps or reasoning about the offset.
 *
 * null on either side means unbounded there, which is how the all-time
 * figures these panels used to show are still reachable.
 */
export interface OpsRange {
  from: string | null;
  to: string | null;
}

/** Both ends open — every fill ever, which is what the scorecards and
 *  the two variance tables silently showed before migration 047. */
export const ALL_TIME: OpsRange = { from: null, to: null };

// ── Date arithmetic on ops days ───────────────────────────────
//
// UTC throughout, deliberately: these strings are ops days in Algiers,
// already resolved, so the only job left is calendar arithmetic on
// YYYY-MM-DD. Doing it through a UTC Date keeps the machine's own
// timezone out of it — a local Date would roll a boundary differently
// depending on where the browser is, which is the one thing an ops day
// exists to prevent.
//
// RangeBar imports these rather than keeping its own copies. It had
// monthStart, monthEnd and addMonths written locally; two copies of a
// month boundary is how the presets and the comparison come to disagree
// about when a month ends.

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The last day of the month `iso` falls in. Day 0 of the NEXT month is
 *  the last of this one, and Date does the roll-over, so December needs
 *  no special case. */
export function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addMonths(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

export function addDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Inclusive day count: a range whose ends are equal is one day, not zero. */
export function daysInRange(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * The window immediately before this one, for a period-over-period
 * comparison. Null when there is nothing sensible to compare against.
 *
 * THE DEFAULT is the equally long window ending the day before this one
 * starts: today against yesterday, 7 days against the 7 before, 30
 * against the 30 before, a hand-typed range against the same span of
 * days. Same number of days on both sides, no overlap, no gap.
 *
 * A WHOLE CALENDAR MONTH is the one case the range decides on its own,
 * because it can: first to last of the same month is unambiguous, and it
 * compares to the whole month before rather than to the 28-to-31 days
 * before its first. "Last month" for March measured against 3 February
 * to 2 March is not a month anybody keeps books by.
 *
 * `calendar` IS FOR THE CASE THE RANGE CANNOT DECIDE. On the 7th of a
 * month, "This month" and "7 days" are the SAME OpsRange — 09-01 to
 * 09-07 — so nothing in the dates says which the reader picked, and the
 * two want different answers. Passing calendar:true asks for the same
 * stretch of the previous month (the 1st to the 7th) instead of the
 * trailing seven days. The dashboard passes it when the month preset is
 * the active one; a typed range gets the default.
 *
 * That branch clamps to the previous month's end, so 31 March compares
 * against 28 February rather than rolling into March. It is deliberately
 * NOT a whole previous month: a partial month against a complete one
 * reads as a collapse in the work every time, which would make the
 * figure worthless for the three weeks it is wrong.
 *
 * An open-ended range (All time, or one end left blank) returns null:
 * there is no "before all time", and a window with no start has no
 * length to step back by.
 */
export function previousRange(
  range: OpsRange,
  opts: { calendar?: boolean } = {},
): OpsRange | null {
  const { from, to } = range;
  if (!from || !to) return null;
  if (from > to) return null;

  const startsMonth = from === monthStart(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);

  if (startsMonth && sameMonth) {
    const prevMonth = addMonths(from, -1);
    const prevEnd = monthEnd(prevMonth);

    // A whole month: the whole month before it. Unambiguous, so it does
    // not wait to be asked.
    if (to === monthEnd(to)) return { from: prevMonth, to: prevEnd };

    // Month to date, but only when the caller says that is what this is.
    if (opts.calendar) {
      const candidate = addDays(prevMonth, daysInRange(from, to) - 1);
      return { from: prevMonth, to: candidate > prevEnd ? prevEnd : candidate };
    }
  }

  const length = daysInRange(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
}
