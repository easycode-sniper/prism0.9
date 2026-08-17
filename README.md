# Prism — OMD Fleet Route Verification

Fleet dispatch and route-compliance monitoring for OMD Transport (Amouda cement line).
Dispatchers assign trucks to construction sites, and the app tracks each run against
its planned road route — flagging deviations, speeding, and arrivals as they happen.

Live vehicle positions come from **Wialon**; everything else (users, dispatches,
geofences, notifications, history) lives in **Supabase**.

## Stack

| Layer | What |
|---|---|
| Framework | Next.js 15 (App Router, React 19, Server Actions) |
| Language | TypeScript, Tailwind CSS v4 |
| Database / auth | Supabase (Postgres + PostGIS, RLS, Realtime) |
| Maps | Leaflet 1.9 + `leaflet.markercluster` |
| Charts | Chart.js via `react-chartjs-2` |
| Telemetry source | Wialon Remote API, through a Cloudflare Worker relay |
| Routing | OSRM public demo server |

## How it works

`FleetProvider` (`src/components/providers/FleetProvider.tsx`) is the heart of the app.
It mounts once in the authenticated layout and, every 60 seconds:

1. Fetches the whole fleet from Wialon in one shot — one login, then units and the
   driver library in parallel (`src/lib/wialon/config.ts`).
2. Writes a `fleet_snapshots` row for history.
3. Runs a position check for every active dispatch: projects the truck onto its
   stored OSRM route geometry, computes deviation and ETA, and fires a notification
   on each `false → true` transition (off-route, speeding, site arrival, factory
   arrival). Transition flags on the `dispatches` row are what keep it from
   re-notifying on every poll.
4. Checks the whole fleet against the HQ geofence for arrivals at PARC OMD.

Every page reads fleet data, dispatches, geofences, stations and notifications from
this one provider rather than fetching its own copy. Notifications additionally
arrive over Supabase Realtime, which drives an in-browser alert tone
(`src/lib/sound.ts`).

The Wialon API token is never bundled into client JS — `src/lib/wialon/config.ts` and
everything under `src/lib/supabase/` are `"use server"` modules, so the browser calls
them as Server Actions.

## Getting started

### Prerequisites

- Node.js 20+
- A Supabase project with the `postgis` and `uuid-ossp` extensions available
- A Wialon account and API token

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

Fill in from your Supabase dashboard (Settings → API):

| Variable | Where it's used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | server only — admin user management |

`.env.local` is gitignored. Never commit it, and never expose the service-role key
to the client.

### 3. Run the migrations

Apply `supabase/migrations/*.sql` **in numeric order** via the Supabase SQL editor or
the CLI:

| File | What it does |
|---|---|
| `001_initial_schema.sql` | All tables, RLS policies, the profile-creation trigger |
| `002_seed_data.sql` | Trucks, 125 construction sites, factory + HQ geofences (run once) |
| `003_enable_realtime.sql` | Realtime on `dispatches` |
| `004_store_wialon_token.sql` | Seeds the `app_config` row with an empty token |
| `005_fleet_snapshots.sql` | Periodic fleet telemetry snapshots |
| `006_dispatch_state_and_speed.sql` | Current off-route / speeding flags |
| `007_enable_realtime_notifications.sql` | Realtime on `notifications` |
| `008_geofence_rpcs.sql` | PostGIS read/write RPCs for geofences |
| `009_gas_stations.sql` | Gas station registry + seed rows |
| `010_hq_arrival.sql` | `fleet_trucks.at_hq` flag, `hq_arrival` notification kind |

### 4. Create the first admin

Add a user under Authentication → Users in the Supabase dashboard. The
`on_auth_user_created` trigger creates their `profiles` row as an `operator`; promote
them by hand:

```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
```

After that, admins can invite users from Admin → Users.

### 5. Set the Wialon token

Sign in, then go to **Admin → Settings** and paste the Wialon API token. Until this is
set the fleet views will show "Wialon is not configured". The token is stored in
`app_config`, not in source control.

### 6. Develop

```bash
npm run dev     # http://localhost:3000
npm run build   # production build
npm start       # serve the production build
```

## Pages

| Route | Purpose |
|---|---|
| `/login` | Email/password sign-in over a live map background |
| `/dashboard` | Four breakdowns — fleet status, location (factory / base / site / in transit), fuel-station proximity, alert mix — plus driver ratings |
| `/dispatch` | Assign trucks to a site, watch the live map, stop runs, manual coordinate fallback |
| `/monitoring` | Searchable/filterable table of every truck, dispatched or not |
| `/history` | Completed and stopped runs with duration and violation flags; CSV export and a printable daily summary |
| `/notifications` | Alert feed with mark-read |
| `/reports` | Placeholder — not built yet |
| `/admin` | KML geofence upload and zone-to-site matching |
| `/admin/users` | Invite users, set roles, disable/enable accounts |
| `/admin/settings` | Wialon relay, server and token |

Access control: `src/middleware.ts` redirects unauthenticated traffic to `/login`, and
`src/app/(app)/admin/layout.tsx` bounces non-admins off the admin section. Postgres
RLS enforces the same rules at the data layer.

## Project structure

```
src/
├── app/
│   ├── (auth)/login/          # Sign-in page
│   ├── (app)/                 # Authenticated shell: topbar, FleetProvider, i18n
│   │   ├── dashboard/ dispatch/ monitoring/ history/
│   │   ├── notifications/ reports/ admin/
│   └── actions/auth.ts        # Sign-in / sign-out server actions
├── components/
│   ├── providers/             # FleetProvider, notification sound listener
│   ├── layout/                # Topbar, nav, login-page scenery
│   └── map/MapView.tsx        # Leaflet map (persistent singleton across navigation)
├── lib/
│   ├── wialon/config.ts       # Wialon relay client, driver resolution, fleet shaping
│   ├── supabase/              # Server actions per domain: dispatches, geofences,
│   │                          #   positions, history, stations, admin, auth
│   ├── geometry/              # Haversine, route projection, point-in-polygon
│   ├── kml.ts routing.ts      # KML polygon parsing; OSRM route fetch
│   └── i18n/                  # EN / FR / AR chrome translations
├── middleware.ts              # Auth gate
supabase/migrations/           # Numbered SQL migrations
index.html                     # Legacy single-file prototype, kept for reference only
```

`index.html` is the original pre-Next.js app. Nothing in the build references it.

## Internationalization

Navigation, page headings and common actions are translated to English, French and
Arabic (`src/lib/i18n/translations.ts`), with RTL applied on `<html>` for Arabic. Deep
content — notification text, error strings, form values — is English only, matching
the original app's scope.

## External services

- **Wialon relay** — `hst-api.wialon.eu` reached through a Cloudflare Worker
  (`wialon-relay1.ferdjellahsouhaibomd.workers.dev`), configurable in Admin → Settings.
- **OSRM** — `router.project-osrm.org` for road routes at dispatch time. This is the
  free demo server; its usage policy rules it out for production load, so a dedicated
  router is the eventual fix.
- **Map tiles** — CARTO dark basemap and Esri World Imagery.

## Known limitations

- **Monitoring runs in the browser.** The poll loop, snapshot writes and all position
  checks live in `FleetProvider`, so nothing is monitored while no one has the app
  open, and each additional open tab repeats the same work.
- **Snapshot and HQ-arrival writes are admin-only.** `fleet_snapshots` and
  `fleet_trucks` only carry admin RLS write policies, so those writes are rejected for
  operators.
- **`dispatches.truck_id` still has a foreign key to `fleet_trucks`**, but the roster
  is Wialon now and `truck_id` is the raw Wialon unit name — dispatching a truck whose
  Wialon name isn't in the seeded `fleet_trucks` list will fail.
- **`app_config` is readable by any authenticated user**, and it holds the Wialon
  token.
- **`npm run lint` doesn't run** — the project has no `eslint.config.js` for ESLint 9.
  `npx tsc --noEmit` and `npm run build` both work.
- `/reports` is a stub.
- There are no automated tests.

## License

See [LICENSE](LICENSE).
