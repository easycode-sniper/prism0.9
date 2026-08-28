# Prism — OMD Fleet Route Verification

Fleet dispatch and route-compliance monitoring for OMD Transport (Amouda cement line).
Dispatchers assign trucks to construction sites, and the app tracks each run against
its planned road route — flagging deviations, arrivals and approaches as they happen —
while watching the whole fleet for speeding and for stops at blacklisted fuel stations.

Live vehicle positions come from **Wialon**; fuel logs are mirrored from a **Google
Sheet**; everything else (users, dispatches, geofences, sites, stations, notifications,
history) lives in **Supabase**.

## Stack

| Layer | What |
|---|---|
| Framework | Next.js 15 (App Router, React 19, Server Actions) |
| Language | TypeScript, Tailwind CSS v4 |
| Database / auth | Supabase (Postgres + PostGIS, RLS, Realtime, pg_cron, pg_net) |
| Maps | Leaflet 1.9 + `leaflet.markercluster` |
| Charts | Chart.js via `react-chartjs-2` |
| Telemetry source | Wialon Remote API, through a Cloudflare Worker relay |
| Fuel source | Google Sheets API (service account, read-only) |
| Routing | OSRM public demo server |

## How it works

Monitoring runs **server-side on a schedule**, not in the browser.

Every minute `pg_cron` (inside Supabase) calls `dispatch_fleet_tick()`,
which uses `pg_net` to POST to `/api/tick` on this app. That handler
(`src/lib/fleet/tick.ts`) runs one cycle with the Supabase service role:

1. Fetches the whole fleet from Wialon in one shot — one login, then units
   and the driver library in parallel (`src/lib/fleet/wialon.ts`), and reads
   each vehicle's category from `fleet_trucks`.
2. Writes a `fleet_snapshots` row. This is both the fleet feed the browser
   reads and the job's heartbeat: `pg_net` is fire-and-forget and won't
   report a failed tick, so a gap in that table is the alarm.
3. Runs a position check for every active dispatch — projects the truck
   onto its stored OSRM route geometry, computes deviation and ETA, and
   fires a notification on each `false → true` transition (off-route, site
   approaching, site arrival). Transition flags on the `dispatches` row are
   what stop it re-notifying every minute.
4. Checks the fleet against the HQ geofence (`hq_arrival`) and the factory
   geofence (`factory_arrival`). Both are fleet-wide rather than per
   dispatch — reaching the factory to load is what *prompts* a dispatch, so
   it can't be conditional on one already existing. Both skip vehicles
   flagged `category = 'staff'`.
5. Checks every non-offline **cargo** truck against the 90 km/h limit
   (`speeding`). Staff cars are excluded, like the two checks above:
   this ran fleet-wide until 2026-08-28, when 7 staff vehicles turned out
   to be raising 65 of 171 alerts — a light car keeps up with traffic, and
   an alert nobody acts on buries the ones they do. Offline units are
   dropped rather than treated as under the limit, so a truck that stops
   reporting freezes its flag instead of re-alerting when it comes back.
6. Checks every **idle** vehicle against blacklisted fuel stations
   (`station_stop`). Idle-only is the feature, not an optimisation: the
   fleet feed calls a truck idle at ≤ 5 km/h on a fix under 30 minutes old,
   so driving past a blacklisted station raises nothing. The alert is about
   the stop.

The schedule lives in Postgres because it does minute-level cron on
Supabase's free plan; the tick itself stays in Next.js so it can reuse the
existing Wialon client, geometry and position-check code.

`/api/tick` is a public URL, so it authenticates itself — middleware excludes
`/api`, since its matcher would redirect the unauthenticated call to `/login`.
The primary credential is a **single-use nonce** that Postgres mints into
`tick_nonces` for each call and the route redeems by deleting; replay is
therefore impossible and minting one needs database write access.
`CRON_SECRET` is kept as a fallback for manual `curl` testing and is
compared with `timingSafeEqual`.

A second job, `dispatch_fuel_sync()`, runs every 15 minutes against
`/api/fuel-sync` with the same nonce scheme (`fuel_sync_nonces`). It reads the
gas-consumption Google Sheet and full-refreshes `fuel_transactions` through
`refresh_fuel_transactions(jsonb)`. Because it is a full refresh, a correction
made in the sheet propagates to every existing row within 15 minutes with no
data migration.

Current `cron.job` schedule:

| Job | Schedule | What |
|---|---|---|
| `fleet-tick` | `* * * * *` | one monitoring cycle |
| `fleet-day-metrics` | `*/5 * * * *` | rolls up `fleet_day_metrics` |
| `fuel-sync` | `*/15 * * * *` | mirrors the fuel sheet |
| `prune-fleet-snapshots` | `17 4 * * *` | drops snapshots older than 7 days |
| `prune-notifications` | `23 4 * * *` | drops notifications older than 40 days |

**The browser only reads.** `FleetProvider` takes the newest
`fleet_snapshots` row and subscribes to realtime for the rest — it never
calls Wialon. Every page reads fleet data, dispatches, geofences, stations
and notifications from that one provider. New notifications also drive an
in-browser alert tone (`src/lib/sound.ts`), one per kind.

### Aggregate in Postgres, not in JS

PostgREST caps every response at 1000 rows and **does not error when it
truncates**, so anything that reduces a table client-side silently becomes
"the first thousand" once the table outgrows that — while still presenting
itself as a total. Aggregations therefore live in the database as RPCs
(`SECURITY INVOKER`, granted to `authenticated`, so RLS still applies):

`fuel_period_stats()` · `dashboard_daily_series(p_days)` ·
`driver_variance_leaders(p_limit)` · `truck_variance_leaders(p_limit)` ·
`driver_speeding_leaders(p_limit)` · `driver_ratings()` ·
`mark_my_notifications_read()` · `station_watch_radius(radius, blacklisted)`

The fleet-state transitions are `SECURITY DEFINER` compare-and-sets that
return only the trucks that actually changed — `mark_trucks_hq_state`,
`mark_trucks_factory_state`, `mark_trucks_speeding_state`,
`mark_trucks_station_state`. Each does a `DISTINCT` on the incoming ids,
because two Wialon units can share a name and the duplicate is what once
raised `21000` and stopped HQ tracking for 28 hours.

### Secrets

The Wialon token never reaches client JS, and that rests on two things, not
one. `src/lib/wialon/config.ts` and everything under `src/lib/supabase/` are
`"use server"` modules — but **every export of a `"use server"` file becomes a
callable HTTP endpoint**, so a server module is not by itself a boundary. The
resolver that returns `{ relay, server, token }` is deliberately *not*
exported; the exported surface is `isWialonConfigured()`, which returns a
boolean.

`app_config` holds both a published rate (`fuel`) and the fleet credential
(`wialon`) behind RLS, and its SELECT policy is an **allow-list**:

```sql
USING (config_key = ANY (ARRAY['fuel']))
```

A key added later is unreadable by operators until someone names it there.
Admins keep full access through the separate `FOR ALL` policy, and the service
role — which the tick, the config resolver and the settings write all use —
bypasses RLS entirely.

## Getting started

### Prerequisites

- Node.js 20+
- A Supabase project with the `postgis`, `uuid-ossp`, `pg_cron` and `pg_net`
  extensions available
- A Wialon account and API token
- A CARTO Basemaps API key (free; CARTO began requiring one in August 2026)
- Optional, for the fuel pages: a Google service account with read access to
  the gas-consumption sheet

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.local.example .env.local
```

| Variable | Where it's used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | server only — admin user management, scheduled jobs |
| `CRON_SECRET` | server only — fallback auth for `/api/tick` and `/api/fuel-sync` |
| `NEXT_PUBLIC_CARTO_BASEMAP_KEY` | browser — Leaflet basemap tiles |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | server only — fuel sheet sync |
| `GOOGLE_SHEETS_PRIVATE_KEY` | server only — fuel sheet sync |

`.env.local` is gitignored. Never commit it, and never expose the service-role
key to the client.

Two notes that cost real time when missed:

- `NEXT_PUBLIC_*` values are **inlined at build time**. Adding one to Vercel
  does nothing to an already-built deployment — it needs a redeploy, and no
  amount of hard-refreshing helps.
- `NEXT_PUBLIC_CARTO_BASEMAP_KEY` is public *by design* (Leaflet builds tile
  URLs in the browser), but **this repository is public**, so it lives in the
  environment rather than in source — a key committed to a public repo gets
  scraped. In Vercel it must be added as a **Config** variable, not a Secret;
  Secrets reject the `NEXT_PUBLIC_` prefix. Without it every tile is stamped
  "API KEY REQUIRED".

### 3. Run the migrations

Apply `supabase/migrations/*.sql` **in numeric order** via the Supabase SQL
editor or the CLI. There are 36; the ones worth knowing about:

| File | What it does |
|---|---|
| `001`–`004` | Tables, RLS, the profile-creation trigger, seed data, `app_config` |
| `005`–`007` | `fleet_snapshots`, dispatch state flags, realtime |
| `008` | PostGIS read/write RPCs for geofences |
| `009`, `023` | Gas station registry + admin writes |
| `010`, `012`, `022` | HQ arrivals: flag, race-free transition RPC, duplicate-name dedupe |
| `014`, `015` | `pg_cron` + `pg_net` schedule, snapshot pruning, single-use nonce auth |
| `016` | `fleet_trucks.category` — `truck` / `staff` |
| `017`–`020` | Parc entries, driver directory, day metrics |
| `021`, `027` | `fuel_transactions` and the Google Sheet mirror |
| `025`, `026` | Factory arrivals and site-approach alerts |
| `028`–`032` | The aggregate RPCs (see above) |
| `033` | Fleet-wide speeding: `fleet_trucks.is_speeding` + transition RPC |
| `034` | `prune_notifications()` — 40-day retention, nightly |
| `035` | Station blacklisting: `blacklisted`, `radius_meters`, `at_blacklisted_station_id` |
| `036` | Closes `app_config` to an allow-list |
| `037` | Adds `amount_da` and `da_per_km` to `dashboard_daily_series` |
| `038` | Drops staff vehicles from the speeding leaderboard |

When adding a notification kind, update the `notifications_kind_check`
constraint in the same migration. The insert is fire-and-forget: a rejected row
still sets the transition flag, which silently kills that alert for the rest of
the run.

### 4. Create the first admin

Add a user under Authentication → Users in the Supabase dashboard. The
`on_auth_user_created` trigger creates their `profiles` row as an `operator`;
promote them by hand:

```sql
UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
```

After that, admins can invite users from Admin → Users.

### 5. Set the Wialon token

Sign in, then go to **Admin → Settings** and paste the Wialon API token. Until
this is set the fleet views will show "Wialon is not configured". The token is
stored in `app_config`, not in source control.

### 6. Develop

```bash
npm run dev     # http://localhost:3000
npm run lint    # eslint (flat config, eslint.config.mjs)
npm run build   # production build
npm start       # serve the production build
```

`npx tsc --noEmit && npm run lint && npm run build` before pushing. The build
is the only one of the three that catches a `"use server"` file exporting
something other than an async function.

## Pages

| Route | Purpose |
|---|---|
| `/login` | Email/password sign-in over a live map background |
| `/dashboard` | Fuel-sheet totals across the top; a "what has been happening" column (distance per day, daily spend against cost per km, then litres, consumption and alerts per day, then fuel variance by truck and by driver) beside a live rail (fleet status, speeding leaderboard, drivers on duty, active runs, operational signals) |
| `/dispatch` | Assign trucks to a site, watch the live map, stop runs, blacklist a station, manual coordinate fallback |
| `/monitoring` | Searchable/filterable table of every truck, dispatched or not |
| `/history` | Completed and stopped runs with duration and violation flags; CSV export and a printable daily summary |
| `/notifications` | Rolling 24-hour feed, grouped by destination (Parc / Factory / Client / Conduct), 6 rows per group with expand, and mark-read |
| `/reports` | Parc-entry report over a From/To range with quick ranges, clipboard copy and CSV download |
| `/drivers` | Driver directory — Wialon names matched to stored phone and address, with inline editing |
| `/carburant` | Recent fuel transactions as the sheet records them |
| `/admin` | Admin hub; lists the geofences currently loaded |
| `/admin/users` | Invite users, set roles, disable/enable accounts |
| `/admin/settings` | Wialon relay, server and token |
| `/admin/sites` | Clients and their sites |
| `/admin/stations` | Gas station registry |

Access control: `src/middleware.ts` redirects unauthenticated traffic to
`/login`, and `src/app/(app)/admin/layout.tsx` bounces non-admins off the admin
section. Postgres RLS enforces the same rules at the data layer.

## Project structure

```
src/
├── app/
│   ├── (auth)/login/          # Sign-in page
│   ├── (app)/                 # Authenticated shell: topbar, FleetProvider, i18n
│   │   ├── dashboard/ dispatch/ monitoring/ history/ reports/
│   │   ├── drivers/ carburant/ notifications/ admin/
│   ├── api/tick/              # Scheduled monitoring endpoint (pg_cron calls this)
│   ├── api/fuel-sync/         # Scheduled fuel-sheet mirror (pg_cron calls this)
│   └── actions/auth.ts        # Sign-in / sign-out server actions
├── components/
│   ├── providers/             # FleetProvider, AlertToaster (toast + sound)
│   ├── layout/                # Topbar, nav, operations strip, login scenery
│   └── map/MapView.tsx        # Leaflet map (persistent singleton across navigation)
├── lib/
│   ├── fleet/                 # Client-agnostic core: tick orchestration, Wialon
│   │                          #   client, position / HQ / factory / speeding /
│   │                          #   station checks, geofence loading
│   ├── wialon/config.ts       # Session-scoped Wialon entry points
│   ├── supabase/              # Server actions per domain: dispatches, geofences,
│   │                          #   positions, history, sites, stations, drivers,
│   │                          #   fuel, dashboard, reports, admin, auth
│   ├── fuel/                  # Google Sheets read + date/row parsing
│   ├── drivers/               # Name normalisation, matching, phone formatting
│   ├── notifications/kinds.ts # One description of each alert kind
│   ├── geometry/              # Haversine, route projection, point-in-polygon
│   ├── constants.ts           # Shared client-safe thresholds
│   ├── chartTheme.ts routing.ts sound.ts format.ts fleetJoin.ts
│   └── i18n/                  # EN / FR / AR chrome translations
├── middleware.ts              # Auth gate
scripts/                       # Runnable checks: sheet date parser,
│                              #   optimistic-overlay settling
supabase/migrations/           # Numbered SQL migrations
index.html                     # Legacy single-file prototype, kept for reference only
```

`index.html` is the original pre-Next.js app. Nothing in the build references it.

## Design system

Dark only, and **colour is taxonomy, not decoration** — every hue is spoken for
by a vehicle state, so a coloured pixel always means something about a truck.
Chrome is achromatic. See `CLAUDE.md` for the tokens and the rules that are
easiest to break by accident; `globals.css` is the source of truth for the
values, and Leaflet marker HTML and Chart.js canvas colours repeat them as
literals because neither can read a CSS variable.

## Internationalization

Navigation, page headings and common actions are translated to English, French
and Arabic (`src/lib/i18n/translations.ts`), with RTL applied on `<html>` for
Arabic. Deep content — notification text, error strings, form values — is
English only, matching the original app's scope.

## External services

- **Wialon relay** — `hst-api.wialon.eu` reached through a Cloudflare Worker
  (`wialon-relay1.ferdjellahsouhaibomd.workers.dev`), configurable in Admin → Settings.
- **OSRM** — `router.project-osrm.org` for road routes at dispatch time. This is the
  free demo server; its usage policy rules it out for production load, so a dedicated
  router is the eventual fix.
- **Google Sheets** — the gas-consumption sheet, read with a service account.
- **Map tiles** — CARTO dark basemap (API key required) and Esri World Imagery.

## Known limitations

- **The stationary split is coarse.** The fleet feed can say moving / idle /
  offline but not ignition-on versus ignition-off: the unit fetch uses Wialon
  flags `1439`, which brings sensor *definitions* but not the last message
  whose params carry ignition state. Splitting it needs the sensor's real name
  from the live account — don't guess one.
- **Client sites have no geofences.** Only two polygons exist (the factory and
  the PARC circle); none of the 125 client sites has one, so arrivals there
  fall back to a 300 m radius check around the site's coordinates.
- **`fleet_trucks.category` has no UI.** A vehicle can only be flagged `staff`
  by hand in SQL, which is why a staff car raised parc arrivals for weeks
  before anyone noticed.
- **An already-open tab does not refresh itself.** The fuel sheet syncs
  every 15 minutes, but `/dashboard` is a client component that fetches on
  mount and never re-polls, so end to end is up to 15 minutes *plus a page
  reload*. The live pages are unaffected — `FleetProvider` is on realtime.
- **No test framework.** Two runnable check scripts exist —
  `scripts/check-fuel-dates.mts` and `scripts/check-optimistic-overlay.mts`
  (`node --experimental-strip-types scripts/<name>.mts`) — and everything
  else is verified by hand.

## License

See [LICENSE](LICENSE).
</content>
