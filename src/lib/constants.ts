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
