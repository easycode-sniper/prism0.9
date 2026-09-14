// How healthy is the live fleet feed, really?
//
// WHY THIS EXISTS. On 2026-09-13 the Wialon token expired at 16:53 and
// the fleet feed stopped dead. The operations strip showed a green
// "Live tracking active" for the next seventeen hours, sitting directly
// beside a "Last update" of 16:53. Nobody noticed until the following
// morning, and then only because the Drivers page happened to surface
// Wialon's own error.
//
// The old rule was `lastUpdated != null && !error`. Both halves were
// true throughout: the browser was reading the database perfectly well,
// and the database had a snapshot in it. What neither half asked was HOW
// OLD that snapshot was. A liveness indicator that never looks at the
// clock is not a liveness indicator.
//
// A PLAIN MODULE, deliberately: no React, no Supabase, no Date.now()
// hidden inside. `now` is passed in, which is what lets the whole thing
// be asserted offline — see scripts/check-feed-health.mts.

// RELATIVE ".ts", not "@/": bare node cannot resolve tsconfig paths, and
// scripts/check-feed-health.mts imports this module directly. Same reason
// positionCheck.ts and siteZones.ts spell their imports this way.
import { FEED_STALE_SECONDS, FEED_DOWN_SECONDS } from "../constants.ts";

export type FeedHealth =
  /** Reading the feed itself failed — the database said no. */
  | "error"
  /** Nothing has ever arrived. A fresh database, or the tick has never run. */
  | "paused"
  /** Fresh enough to trust. */
  | "live"
  /** Older than a few ticks. Probably a blip; worth a second look. */
  | "stale"
  /** Old enough that something is genuinely broken. */
  | "down";

/** Seconds since the newest snapshot, or null when there is none. Never
 *  negative: a clock skewed a little ahead of the server should read as
 *  "just now", not as a feed from the future. */
export function feedAgeSeconds(lastUpdated: Date | null, now: Date): number | null {
  if (!lastUpdated) return null;
  return Math.max(0, Math.round((now.getTime() - lastUpdated.getTime()) / 1000));
}

/**
 * Classify the feed.
 *
 * Order matters. An outright read error beats everything — it is the
 * most specific thing we know. Then "never arrived". Only then does age
 * decide, and it decides from the OLDEST band down, so a feed that is
 * both stale and down reads as down.
 */
export function feedHealth(
  lastUpdated: Date | null,
  error: string | null,
  now: Date
): FeedHealth {
  if (error) return "error";
  const age = feedAgeSeconds(lastUpdated, now);
  if (age == null) return "paused";
  if (age >= FEED_DOWN_SECONDS) return "down";
  if (age >= FEED_STALE_SECONDS) return "stale";
  return "live";
}

/** Whether the feed is anything other than healthy — the one question
 *  most callers actually have. */
export function isFeedUnhealthy(health: FeedHealth): boolean {
  return health !== "live";
}
