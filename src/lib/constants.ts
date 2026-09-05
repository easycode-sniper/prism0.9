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

/**
 * Past this, a truck that left a site and never reached the plant or the
 * parc is a tracker problem rather than an availability signal. Ageing
 * them out keeps the panel a picture of now.
 *
 * RAISED FROM 12 TO 24 on 2026-09-03, against the first full day of site
 * logging. 12 was a guess made before there was data, and the data says
 * it cut into the real distribution rather than past it. Of 22 completed
 * client-to-plant journeys, the median gap between leaving the client and
 * reaching the plant or the parc was 7.8 hours -- but three took longer
 * than 12 (17.20, 19.33, 19.43) and three more landed at ~11, just under
 * the cliff.
 *
 * The long ones are not tracker faults, they are NIGHTS. Every gap past
 * 12 hours began with an evening departure and ended the next afternoon:
 * 000100-525-35 left GREAT WALL HMD at 20:28 and reached the plant at
 * 15:48 the next day; 000093-525-35 left BOUDOUAOU ASLAN at 20:35 and got
 * back at 16:01. The driver finished, stopped for the night, and drove
 * home in the morning. That truck is free the whole time -- and at 12
 * hours it fell off the panel at 08:28, which is exactly when the
 * dispatcher starts looking at it.
 *
 * The cost is small and BOUNDED, which is why 24 rather than something
 * larger is not the interesting question: measured against live data the
 * panel showed 11 trucks at 12 hours and 13 at 24, and 13 again at 36 and
 * at 48. It cannot grow without limit, because reaching the plant or the
 * parc removes a truck whatever the clock says -- the cutoff only ever
 * decides how long a truck that has NOT come back stays listed. 24 clears
 * the longest journey actually observed (19.43h) with headroom, keeps a
 * whole night inside one window, and still catches the thing this
 * constant exists for: a truck that has been "free" for more than a day
 * is a tracker to check, not a truck to call.
 */
export const UNLOADED_MAX_AGE_HOURS = 24;

/**
 * How long after a truck LEAVES the client before it is called free.
 *
 * A confirmation delay, not a countdown. Strict containment means a
 * truck manoeuvring near a site boundary can log an exit it did not
 * really make: 000054-525-35 left EQUIPE2 BOUDOUAOU at 19:11 on the
 * first day and was back inside at 19:17. Announcing it free at 19:11
 * would have been wrong six minutes later.
 *
 * The margin is thinner than it looks — 000100-525-35 left GREAT WALL
 * HMD after 51 minutes and re-entered EXACTLY 25 minutes later, which
 * this clears by seconds. It does not, however, hide trucks behind
 * their own arrival at the plant: measured site-exit to plant-entry was
 * 79 and 199 minutes, far longer than the settle.
 *
 * The owner's rule, 2026-09-01: 25 minutes on site to count as
 * unloading, then 25 more after leaving to count as free.
 */
export const UNLOADED_SETTLE_SECONDS = 25 * 60;

// ── Accounts ─────────────────────────────────────────────────

/**
 * The shortest password an admin may set when creating an account.
 *
 * There is no self-service signup and no password-reset email in this
 * app: an admin types the password on the User Management page and
 * tells the person what it is. So this floor is the ONLY thing standing
 * between a hurried admin and a two-character password on an account
 * that can see every truck's position.
 *
 * 8 rather than Supabase's own default of 6, deliberately — the project
 * setting is the backstop, not the policy. If the Supabase policy is
 * ever raised above this, its rejection still reaches the admin
 * verbatim; the check here exists to fail fast and in our own words.
 *
 * Lives here rather than in lib/supabase/admin-actions.ts because that
 * file is "use server" and may export only async functions, and because
 * the form renders this number in its own hint — the rule and the
 * sentence explaining it must not drift apart.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Quick Track — how the trail on the map is drawn.
 *
 * TRACK_GAP_SECONDS is when the line breaks instead of continuing.
 * 40.4% of all readings over a measured 24h were `offline` — a unit that
 * has stopped reporting keeps repeating its last known position — and
 * truck_track drops those, so a silent tracker arrives here as a hole in
 * the timestamps. 15 minutes is comfortably longer than the one-minute
 * tick plus any jitter, so it only fires on a real outage, and a break
 * says "not known" rather than asserting a straight road across it.
 *
 * TRACK_STOP_SECONDS is when a stay earns an amber marker. At 5 minutes
 * a 12h trail for a working truck showed 9 stops — few enough to read,
 * and short enough to catch a delivery rather than only overnight
 * parking.
 */
export const TRACK_GAP_SECONDS = 15 * 60;
export const TRACK_STOP_SECONDS = 5 * 60;

/** The windows the Quick Track picker offers, and its default. Capped by
 *  what prune_fleet_snapshots keeps, which is 7 days. */
export const TRACK_WINDOW_HOURS = [2, 12, 24] as const;
export const TRACK_DEFAULT_HOURS = 12;
