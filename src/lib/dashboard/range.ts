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
