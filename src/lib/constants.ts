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
