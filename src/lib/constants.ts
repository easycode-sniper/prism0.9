// Usine Amouda Ciment, El Baida — verified via Google Places. The fleet's
// only factory, so this is used both as a routing origin and as the
// factory-arrival geofence fallback.
export const FACTORY_LAT = 34.4368063;
export const FACTORY_LNG = 2.058655;
export const FACTORY_NAME = "Usine Amouda Ciment";

// The speed a truck must not exceed, in km/h. Lives here rather than in
// positionCheck.ts because two very different callers need it and only
// one of them can import that module: the tick raises the alert from it,
// and the dashboard has to name the threshold it is reporting against.
// positionCheck.ts pulls in the Supabase geofence types, so a client
// component importing it would drag server code into the browser bundle.
export const SPEED_LIMIT_KMH = 90;

/**
 * How far back the notifications feed reaches. A rolling day, because that is what an
 * operations feed is for — nobody scrolls to last Tuesday's parc
 * arrival, and the user asked for exactly this.
 *
 * It is also what keeps the page HONEST. Every count on the
 * notifications page — the group chips, the section headings, "N unread"
 * — is a .filter() over whatever this returned. Bounding by TIME rather
 * than by row count means those numbers describe a window the page can
 * name, instead of silently becoming "within the newest 300" the day the
 * feed outgrows the limit.
 *
 * The row cap below is a guard, not a page size, and the two have to be
 * read together: fleet-wide speeding took the feed to roughly 145 alerts
 * a day, so a day's window is ~145 rows against a 500 cap — 3x headroom,
 * and well under the 1000 rows PostgREST truncates at without erroring.
 * If the window is ever widened, check that product again.
 */
// Here rather than in lib/supabase/history.ts beside the query: that
// module is "use server", and a "use server" file may export ONLY async
// functions. Exporting a const from one fails the BUILD, not the
// typecheck — tsc and eslint both pass and only `next build` catches it.
export const NOTIFICATION_FEED_HOURS = 24;

// ── Fuel stations ────────────────────────────────────────────
//
// The forecourt radius a station is watched at. 50m was checked against
// 24h of snapshots before being chosen: at 50m, 29 trucks were caught
// stopped at 13 of the 51 stations, so it is tight enough to mean "at
// the pumps" without GPS noise losing real stops.
export const STATION_RADIUS_METERS = 50;

// A blacklisted station is watched WIDER on purpose. The alert exists so
// the office can phone the driver before money changes hands, and 50m
// only catches him once he is already on the forecourt; 150m picks him
// up on the approach apron and in the queue.
export const BLACKLIST_WATCH_RADIUS_METERS = 150;

/**
 * The radius a station is actually watched at.
 *
 * DERIVED, never stored: writing the wider radius back into
 * gas_stations.radius_meters would leave a station stuck at 150m after
 * it was un-blacklisted. GREATEST means an admin who deliberately set a
 * wider radius keeps it rather than having it shrunk to 150.
 *
 * public.station_watch_radius(radius, blacklisted) in migration 035 is
 * the same rule in SQL, for querying. If this changes, change that too —
 * they are kept in step by hand, like chartTheme.ts and globals.css.
 */
export function stationWatchRadius(radiusMeters: number | null | undefined, blacklisted: boolean): number {
  const base = radiusMeters ?? STATION_RADIUS_METERS;
  return blacklisted ? Math.max(base, BLACKLIST_WATCH_RADIUS_METERS) : base;
}

/**
 * How long a truck must sit inside a client site before leaving it
 * counts as "finished unloading".
 *
 * THIS IS THE WHOLE DESIGN OF THE DÉCHARGÉS PANEL, not a tuning knob.
 * Site visits are logged with STRICT containment and no edge buffer
 * (see fleet/siteZones.ts for why), so a public road clipping a site
 * polygon logs a truck that merely drove past. On the first day of site
 * logging, 2 of 5 closed visits were exactly that:
 *
 *   real unloading stops   50, 95, 103 minutes
 *   drive-throughs          1, 2 minutes
 *
 * A list that calls a 60-second pass "finished unloading" is worse than
 * no list — a dispatcher burned once stops believing the rest of it.
 * 25 minutes is the owner's number, chosen 2026-09-01 against that
 * spread: well above every drive-through observed, under half the
 * shortest real stop.
 *
 * Lives here rather than in lib/supabase/unloaded.ts because that file
 * is "use server" and may only export async functions — and because the
 * panel renders this number in its own subtitle, so the rule and the
 * sentence explaining it cannot drift apart.
 */
export const UNLOADED_MIN_SECONDS = 25 * 60;

/** Past this, a truck that left a site and never reached the plant is a
 *  tracker problem rather than an availability signal. Ageing them out
 *  keeps the panel a picture of now. */
export const UNLOADED_MAX_AGE_HOURS = 12;
