// What the dashboard already knows, kept between visits.
//
// WHY THIS EXISTS. The owner, 2026-09-14: "I want fluid movement, it
// literally takes forever to go from dispatch to dashboard… I figured
// since it syncs every 15 min why does it need to load every time you
// look at it". He is right. The figures on that page come from a fuel
// sheet synced every fifteen minutes and a metrics table refreshed every
// five; re-asking for them the instant someone navigates back buys
// nothing and costs the whole wait.
//
// So the page keeps its last answers and paints them immediately, then
// refreshes behind the scenes. Stale-while-revalidate, in about forty
// lines and with no dependency.
//
// A PLAIN MODULE, deliberately — no React, no Supabase, and `now` is
// passed in rather than read from the clock inside. That is what lets
// the whole thing be asserted offline; see scripts/check-dash-cache.mts.
// Same reasoning as freshness.ts.
//
// SCOPE AND LIFETIME. The instance lives at the module level of the
// dashboard page, so it survives navigating away and back (the module
// stays loaded) and dies with the tab. It is therefore per-user and
// per-session by construction: nothing here is shared between two people
// the way a server-side cache would be, which matters because these
// figures are read under the caller's own RLS.

/** How long an entry may be served without even checking for a newer
 *  one. Under this, a revisit costs no network at all.
 *
 *  Sixty seconds is well inside what the data can actually change in:
 *  the fuel sheet syncs every fifteen minutes and fleet_day_metrics
 *  every five, so nothing served from here is staler than the pipeline
 *  behind it already was. Past this the entry is still shown at once —
 *  it is refreshed underneath, not waited for. */
export const FRESH_MS = 60_000;

/** Entries kept before the oldest is dropped. A range and a scope make a
 *  key, and someone comparing months can generate them faster than they
 *  can read them, so this is a bound rather than a target. */
export const MAX_ENTRIES = 12;

export interface CacheHit<T> {
  value: T;
  /** How long ago this was stored. The caller decides what to do about
   *  it — see `isFresh`. */
  ageMs: number;
}

export interface Cache<T> {
  get(key: string, now: number): CacheHit<T> | null;
  set(key: string, value: T, now: number): void;
  /** For assertions, and for a caller that needs to drop everything. */
  size(): number;
  clear(): void;
}

// Every cache made here, so that signing out can empty all of them
// without the sign-out button having to know what they hold.
//
// The dashboard's figures are fleet-wide and every signed-in user reads
// exactly the same rows, so a cache surviving a user swap would show the
// next person nothing they could not fetch themselves. This is a guard
// against that staying true rather than a fix for a leak today: RLS
// could grow a per-user rule, and the day it does, nobody will remember
// there is a Map in a module holding the last answers.
const registry = new Set<{ clear(): void }>();

/** Empty every cache. Called when the session ends. */
export function clearAllCaches(): void {
  for (const c of registry) c.clear();
}

export function makeCache<T>(max = MAX_ENTRIES): Cache<T> {
  // Insertion-ordered, which is what makes the eviction below a
  // one-liner: the first key a Map yields is the oldest written.
  const store = new Map<string, { value: T; storedAt: number }>();

  const api: Cache<T> = {
    get(key, now) {
      const hit = store.get(key);
      if (!hit) return null;
      // Never negative: a clock that jumped backwards should read as
      // "just stored", not as an entry from the future that can never
      // go stale. Same guard feedAgeSeconds makes.
      return { value: hit.value, ageMs: Math.max(0, now - hit.storedAt) };
    },
    set(key, value, now) {
      // Delete first so a rewrite moves the key to the END of the
      // insertion order. Without this, an entry written once and then
      // refreshed forever would still be evicted as "the oldest".
      store.delete(key);
      store.set(key, { value, storedAt: now });
      while (store.size > max) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
    size: () => store.size,
    clear: () => store.clear(),
  };
  registry.add(api);
  return api;
}

/** Whether an entry can be served without checking for a newer one. */
export function isFresh(ageMs: number, freshMs = FRESH_MS): boolean {
  return ageMs < freshMs;
}
