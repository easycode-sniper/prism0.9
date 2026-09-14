"use server";

import { createClient } from "@/lib/supabase/server";
// OpsRange and ALL_TIME live in a plain module, NOT here: this file is
// "use server", which may only export async functions. Exporting the
// constant from here compiled fine — nothing outside crossed a client
// boundary with it — and then broke the render at runtime.
import { type OpsRange, ALL_TIME } from "@/lib/dashboard/range";
// Passed to the RPC explicitly rather than leaning on its SQL default,
// exactly as reports.ts does: the panel prints "over 25 minutes" in its
// own subtitle, and a threshold living only in the database could drift
// from that sentence without anything failing.
import { UNLOADED_MIN_SECONDS } from "@/lib/constants";
// Same reasoning as OpsRange above: a plain module, because this file is
// "use server" and may only export async functions.
import { type Scope, type ScopeOption, FLEET, scopeArgs } from "@/lib/dashboard/scope";

/** The caller's own Supabase client, created once per request by the one
 *  exported action below and handed to every reader. */
type Db = Awaited<ReturnType<typeof createClient>>;

// Everything the redesigned dashboard reads, in one module so the page
// makes ONE round trip — see getDashboardBundle at the foot of the file.
//
// Every figure here is measured. Nothing on this page is derived from an
// assumed rate or a placeholder: a dashboard that mixes real numbers with
// plausible ones is worse than a smaller dashboard, because nothing on it
// can be trusted without knowing which is which.

// ── The fuel sheet, summed ────────────────────────────────────

export interface FuelPeriodStats {
  /** What the sheet's own date cells say the first and last fill were,
   *  as written. Taken in sheet-row order rather than by date, which is
   *  what makes them correct regardless of how the column is formatted —
   *  the source was mixed month/day and day/month until it was
   *  normalised, and resolveOccurredAt still guards against a batch
   *  arriving that way again. */
  firstRaw: string | null;
  lastRaw: string | null;
  fills: number;
  /** Distance covered between fills, summed. */
  km: number;
  litres: number;
  amountDa: number;
  /** SUM(litres) * 100 / SUM(km), counting only fills that carry a
   *  variance. A fill with no variance is one the sheet could not price
   *  against a distance, which means no kilometres were logged for it —
   *  overwhelmingly a Vh Service vehicle (71 of the 76), plus a handful
   *  of first-ever truck fills with no previous odometer to measure
   *  from. Their litres in the numerator with no distance in the
   *  denominator would overstate what the fleet actually burns, so they
   *  are left out of this figure and counted only in the totals above.
   *
   *  Keyed on variance rather than distance deliberately: the two are
   *  the same set (verified — zero rows have one without the other),
   *  and "the sheet could not compute an écart for this fill" is the
   *  condition that actually means "no kilometres here". */
  litresPer100Km: number | null;
  /** The sheet's écart: what was paid, less what the assumed rate says
   *  the distance should have cost. Positive means the fleet spent more
   *  than the assumption predicted. */
  varianceDa: number;
  /** Litres on fills excluded from the average, and how many there
   *  were. Surfaced rather than hidden: it is the error bar on the
   *  figure above, and the office should be able to see how much of the
   *  month it covers. */
  unpairedLitres: number;
  unpairedFills: number;
  /** What those excluded fills cost. They have no distance, so amount is
   *  the only thing they contribute. */
  unpairedAmountDa: number;
}

// Both figures below are summed in Postgres, not here — see migration
// 028. Selecting the rows to add them up in JS has a ceiling nobody sees
// coming: PostgREST caps a response at 1000 rows and does NOT error when
// it truncates, so the month totals were quietly summing 1000 fills of
// 1147, and the 30-day series was already past the cap the day it
// shipped. Paging only moves the ceiling; at ~46 fills a day a year is
// 17,000 rows, and dragging those over the wire to add them is the wrong
// shape however well it fits. An aggregate is one row at any size.

async function readFuelPeriodStats(
  supabase: Db,
  range: OpsRange = ALL_TIME,
  scope: Scope = FLEET
): Promise<{ stats?: FuelPeriodStats; error?: string }> {

  // Both null for the fleet, which makes this the identical call the
  // dashboard made before 060 — the scoped path is additive, and the
  // unscoped one is not meant to change by a dinar.
  const { driver, truck } = scopeArgs(scope);
  const { data, error } = await supabase
    .rpc("fuel_period_stats", {
      p_from: range.from,
      p_to: range.to,
      p_driver: driver,
      p_truck: truck,
    })
    .single();
  if (error) return { error: error.message };
  if (!data) return { error: "No fuel data" };

  const r = data as Record<string, unknown>;
  const num = (v: unknown) => (v == null ? 0 : Number(v));

  return {
    stats: {
      firstRaw: (r.first_raw as string | null) ?? null,
      lastRaw: (r.last_raw as string | null) ?? null,
      fills: num(r.fills),
      km: num(r.km),
      litres: num(r.litres),
      amountDa: num(r.amount_da),
      litresPer100Km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
      varianceDa: num(r.variance_da),
      unpairedLitres: num(r.unpaired_litres),
      unpairedFills: num(r.unpaired_fills),
      unpairedAmountDa: num(r.unpaired_amount_da),
    },
  };
}

// ── Daily series ──────────────────────────────────────────────

export interface DayPoint {
  /** ISO date, YYYY-MM-DD, in the operations day. */
  day: string;
  /** Null where the day has no value to report, which is not the same as
   *  zero. Consumption on a day with no fill yet is unknown; litres
   *  bought on that day really is zero. Charts draw a gap for null. */
  value: number | null;
}

export interface DashboardSeries {
  /** Kilometres per operations day, from the table pg_cron writes. */
  km: DayPoint[];
  /** Alerts raised per day — off-route, speeding, arrivals. */
  alerts: DayPoint[];
  /** Litres bought per day, summed from the pump transactions. */
  litres: DayPoint[];
  /** Litres per 100km per day, on the same rule the headline figure
   *  uses: only fills carrying a variance, because a fill without one
   *  had no distance logged against it. A day with no such fill has no
   *  consumption to report and comes back as 0. */
  consumption: DayPoint[];
  /** Dinars paid at the pump per day, every fill — the same population
   *  as the "Amount filled" headline tile, which the 30-day series sums
   *  to exactly. */
  amountDa: DayPoint[];
  /** The montant kilométrique: dinars per kilometre, on fills that
   *  logged a distance. Deliberately a NARROWER population than amountDa
   *  above — a fill with no distance is money that bought no measured
   *  kilometres, and counting it would inflate the rate. Same subset as
   *  consumption, so the two rates describe the same fills. */
  daPerKm: DayPoint[];
  /** Client-site deliveries per day — the fleet's OUTPUT, against the
   *  cost every other series here measures. Counted from zone_visits on
   *  the same 25-minute rule as Rapport Livraisons and the Déchargés
   *  panel (see UNLOADED_MIN_SECONDS), the plant excluded because it is
   *  zone_kind 'factory' rather than 'site'.
   *
   *  Bucketed by ARRIVAL, one day per visit — unlike Rapport Livraisons,
   *  which reports an overnight stay in both days it touches. A series
   *  whose columns did not sum to its own total would be worse than the
   *  small edge disagreement this costs. Migration 056 has the argument.
   *
   *  Null, never zero, before site logging began on 2026-09-01: there
   *  were no 'site' rows to count, which is not the same as a fleet that
   *  delivered nothing. Same rule as km — see DayPoint. */
  deliveries: DayPoint[];
  /** True when the requested range was longer than the series can
   *  return and the START was moved forward — so the charts show the
   *  newest days, not all of them. Migration 057 caps the span at 730
   *  days, comfortably under the 1000-row ceiling the API truncates at
   *  without erroring.
   *
   *  Surfaced rather than swallowed: the whole failure this replaces was
   *  a chart that covered less than it was asked for and said nothing.
   *  Unreachable until roughly August 2028 on today's record, which is
   *  exactly why it has to announce itself — nobody will remember. */
  daysClamped: boolean;
  /** How many days of history actually exist behind the longest series,
   *  so the page can show a range control that does not promise more
   *  than it has. */
  daysAvailable: number;
}

async function readDashboardSeries(
  supabase: Db,
  range: OpsRange,
  scope: Scope = FLEET
): Promise<{ series?: DashboardSeries; error?: string }> {

  // The RPC returns one row per day, already dense and already bucketed
  // to the Africa/Algiers operations day — so a fill logged at 00:12
  // local counts against the day the office worked it. One row per day
  // in the range however many fills sit behind them.
  //
  // A NULL range means ALL TIME and is answered as such: 057 reads the
  // first day any source has data rather than defaulting to the last 30.
  // Until then "All time" gave genuinely all-time KPI tiles above charts
  // that quietly covered a month, with nothing on screen saying so.
  //
  // The span cap is 730 days and it moves the START, keeping the newest
  // days. 047 capped the END instead, which answered "2020 to today"
  // with 2020-2022 — three years of history and not one recent day on a
  // dashboard about now.
  //
  // SCOPED, the km column changes source — see migration 060. Fleet-wide
  // it is telemetry from fleet_day_metrics, real distance per calendar
  // day; for one truck that table has nothing to offer, so km becomes
  // the fuel sheet's distance BETWEEN FILLS, credited to the later
  // fill's day. The page relabels the chart rather than letting it read
  // as the fleet chart with a filter on it.
  const { driver, truck } = scopeArgs(scope);
  const { data, error } = await supabase.rpc("dashboard_daily_series", {
    p_from: range.from,
    p_to: range.to,
    p_min_seconds: UNLOADED_MIN_SECONDS,
    p_driver: driver,
    p_truck: truck,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as { day: string; km: string | number; litres: string | number;
                                 consumption: string | number | null; alerts: string | number;
                                 amount_da: string | number; da_per_km: string | number | null;
                                 deliveries: string | number | null;
                                 days_clamped: boolean | null }[];
  const point = (
    r: typeof rows[number],
    field: "km" | "litres" | "consumption" | "alerts" | "amount_da" | "da_per_km" | "deliveries"
  ) => ({
    day: r.day,
    // Null is carried through rather than floored to zero — see DayPoint.
    value: r[field] == null ? null : Number(r[field]),
  });

  return {
    series: {
      km: rows.map((r) => point(r, "km")),
      alerts: rows.map((r) => point(r, "alerts")),
      litres: rows.map((r) => point(r, "litres")),
      consumption: rows.map((r) => point(r, "consumption")),
      amountDa: rows.map((r) => point(r, "amount_da")),
      daPerKm: rows.map((r) => point(r, "da_per_km")),
      deliveries: rows.map((r) => point(r, "deliveries")),
      // The same value on every row — read the first, and default to
      // false for an empty range rather than to a missing-column crash.
      daysClamped: rows[0]?.days_clamped === true,
      // Days that actually carry a distance reading, so the panel can say
      // how much history is really behind a 30-day frame.
      daysAvailable: rows.filter((r) => Number(r.km ?? 0) > 0).length,
    },
  };
}

// ── Where the variance comes from ─────────────────────────────

export interface DriverVariance {
  driverName: string;
  /** The truck (or trucks) this driver's figure came from. A driver with
   *  one truck cannot be separated from it in this data, and the row has
   *  to admit that rather than leave the reader to assume otherwise. */
  trucks: string | null;
  truckCount: number;
  fills: number;
  km: number;
  litresPer100Km: number | null;
  varianceDa: number;
  /** Dinars of overspend per 100km. The total says who cost the most;
   *  this says who is actually heavy on fuel, and in the current data
   *  they are two different drivers. */
  variancePer100Km: number | null;
}

async function readDriverVariance(
  supabase: Db,
  // The whole roster, not a top N. One row per driver — 92 today — grows
  // with headcount rather than with fills, so it is small enough to hand
  // over whole and sort in the browser, where changing the sort costs
  // nothing. The cap is a guard, not a page size.
  limit = 500,
  range: OpsRange = ALL_TIME
): Promise<{ drivers?: DriverVariance[]; error?: string }> {

  const { data, error } = await supabase.rpc("driver_variance_leaders", {
    p_limit: limit, p_from: range.from, p_to: range.to,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    drivers: rows.map((r) => ({
      driverName: String(r.driver_name ?? "—"),
      trucks: (r.trucks as string | null) ?? null,
      truckCount: Number(r.truck_count ?? 0),
      fills: Number(r.fills ?? 0),
      km: Number(r.km ?? 0),
      litresPer100Km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
      varianceDa: Number(r.variance_da ?? 0),
      variancePer100Km: r.variance_per_100km == null ? null : Number(r.variance_per_100km),
    })),
  };
}

export interface TruckVariance {
  truckId: string;
  /** How many drivers the figure covers. One means this row and that
   *  driver's row are the same evidence counted twice. */
  drivers: number;
  fills: number;
  km: number;
  litresPer100Km: number | null;
  varianceDa: number;
  variancePer100Km: number | null;
}

async function readTruckVariance(
  supabase: Db,
  limit = 500,
  range: OpsRange = ALL_TIME
): Promise<{ trucks?: TruckVariance[]; error?: string }> {

  const { data, error } = await supabase.rpc("truck_variance_leaders", {
    p_limit: limit, p_from: range.from, p_to: range.to,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    trucks: rows.map((r) => ({
      truckId: String(r.truck_id ?? "—"),
      drivers: Number(r.drivers ?? 0),
      fills: Number(r.fills ?? 0),
      km: Number(r.km ?? 0),
      litresPer100Km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
      varianceDa: Number(r.variance_da ?? 0),
      variancePer100Km: r.variance_per_100km == null ? null : Number(r.variance_per_100km),
    })),
  };
}

// ── Who keeps crossing the limit ──────────────────────────────

export interface DriverSpeeding {
  driverName: string;
  /** The truck (or trucks) the alerts came from, same admission the
   *  variance rows make: with one truck the driver and the vehicle are
   *  not separable in this data. */
  trucks: string | null;
  truckCount: number;
  /** Crossings of the limit this month, anywhere in the fleet — one per
   *  false->true transition of fleet_trucks.is_speeding, so slowing down
   *  and speeding up again counts twice. Not scoped to dispatched runs. */
  times: number;
  lastAt: string | null;
}

async function readDriverSpeeding(
  supabase: Db,
  limit = 100,
  // Defaulted to ALL_TIME like the others, but note this one was NEVER
  // all-time before 047: it carried a hardcoded date_trunc('month'),
  // so it showed month-to-date while the tables beside it showed
  // everything. Callers must pass the page's range or the panels
  // disagree again.
  range: OpsRange = ALL_TIME,
  scope: Scope = FLEET
): Promise<{ drivers?: DriverSpeeding[]; error?: string }> {

  // Counted and grouped in Postgres: notifications grow without bound and
  // PostgREST truncates at 1000 rows without erroring. One row per driver
  // who sped at least once this month, which is far smaller.
  //
  // Scoped it still returns a LIST, of one row, so the panel keeps one
  // layout. A truck scope can legitimately return more than one row —
  // two men drove it — which is a fact about the truck worth seeing.
  const { driver, truck } = scopeArgs(scope);
  const { data, error } = await supabase.rpc("driver_speeding_leaders", {
    p_limit: limit, p_from: range.from, p_to: range.to,
    p_driver: driver, p_truck: truck,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    drivers: rows.map((r) => ({
      driverName: String(r.driver_name ?? "—"),
      trucks: (r.trucks as string | null) ?? null,
      truckCount: Number(r.truck_count ?? 0),
      times: Number(r.times ?? 0),
      lastAt: (r.last_at as string | null) ?? null,
    })),
  };
}

// ── Where the fleet fills up ──────────────────────────────────

export interface StationLeader {
  station: string;
  fills: number;
  amountDa: number;
  litres: number;
  /** 1-based, already ordered by the RPC. Ties break on name so two
   *  stations on the same count cannot swap places between refreshes. */
  rank: number;
}

export interface StationLeaders {
  leaders: StationLeader[];
  /** The whole window, from SQL — NOT the sum of `leaders`. The donut's
   *  remainder arc is total minus the top N, and deriving the total from
   *  a list that has been limited would make the remainder wrong by
   *  exactly the part it exists to show. */
  totalFills: number;
  totalAmountDa: number;
  /** How many distinct stations the window holds, so the remainder can
   *  say how many places it stands for rather than just "other". */
  totalStations: number;
}

/**
 * The stations the fleet fills at most often, and enough of the whole to
 * size the rest.
 *
 * TOP N AND A REMAINDER, because the tail is the shape of this data: 318
 * distinct stations over the sheet's lifetime, and the top six cover
 * about a third of fills. Six slices that omit the other two thirds
 * would be a chart that lies by omission; six plus one honest "everyone
 * else" arc is the same information without the lie.
 */
async function readFuelStationLeaders(
  supabase: Db,
  range: OpsRange = ALL_TIME,
  limit = 6,
  scope: Scope = FLEET
): Promise<{ data?: StationLeaders; error?: string }> {

  // Scoped this answers "where does THIS truck fill up", which is worth
  // more than it sounds: a truck buying fuel somewhere the rest of the
  // fleet never uses is the shape a blacklisted-station problem takes.
  const { driver, truck } = scopeArgs(scope);
  const { data, error } = await supabase.rpc("fuel_station_leaders", {
    p_from: range.from,
    p_to: range.to,
    p_limit: limit,
    p_driver: driver,
    p_truck: truck,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  const num = (v: unknown) => (v == null ? 0 : Number(v));

  return {
    data: {
      leaders: rows.map((r) => ({
        station: String(r.station ?? "—"),
        fills: num(r.fills),
        amountDa: num(r.amount_da),
        litres: num(r.litres),
        rank: num(r.rank),
      })),
      // Identical on every row, so the first is as good as any — and 0
      // when the window is empty, which the page reads as "no fills".
      totalFills: num(rows[0]?.total_fills),
      totalAmountDa: num(rows[0]?.total_amount),
      totalStations: num(rows[0]?.total_stations),
    },
  };
}

// ── Who the search box can find ───────────────────────────────

/**
 * Every driver and truck the dashboard can actually be scoped to.
 *
 * Built from the tables the dashboard AGGREGATES, not from Wialon's
 * roster: a name that appears in no fuel row and no zone visit would
 * select a scope with nothing behind it, and an empty dashboard reads as
 * a broken filter rather than as an honest "no data for this person".
 *
 * `fills` and `visits` come back with each option so the picker can show
 * what is behind a name before it is chosen — and so a driver the fuel
 * sheet spells one way and the tracker another appears as two entries
 * with one side at zero, rather than as one entry that mysteriously
 * half-populates the page. That split is a correction for the source
 * sheet; migration 060 explains why SQL does not guess at it.
 */
async function readScopeOptions(supabase: Db): Promise<{ options?: ScopeOption[]; error?: string }> {

  const { data, error } = await supabase.rpc("dashboard_scope_options");
  if (error) return { error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    options: rows
      .map((r) => ({
        kind: (r.kind === "truck" ? "truck" : "driver") as "driver" | "truck",
        id: String(r.id ?? ""),
        label: String(r.label ?? r.id ?? ""),
        fills: Number(r.fills ?? 0),
        visits: Number(r.visits ?? 0),
      }))
      // A blank id cannot be selected and cannot be searched for; it
      // would render as an empty row in the popup.
      .filter((o) => o.id !== ""),
  };
}

// ── The one round trip ────────────────────────────────────────
//
// THE ONLY EXPORT IN THIS FILE, and the reason is measured rather than
// stylistic.
//
// The page used to call eight server actions — seven in a Promise.all
// plus the scope roster — and a Promise.all of server actions is NOT
// concurrent. Next.js queues actions and runs them strictly one at a
// time; a second request does not begin until the first has answered.
// Measured on Next 15.5.9 with this repo's own toolchain: seven actions
// of 300ms each took 2,180ms end to end, and the server-side span
// between the first start and the last finish was 2,180ms too, so they
// never overlapped. The same work behind ONE action took 308ms.
//
// Each of those eight also opened with its own supabase.auth.getUser(),
// which is a network call to the Auth API — not a cookie read. So the
// page was paying sixteen sequential round trips (eight auth, eight
// RPC) to answer a question Postgres does in tens of milliseconds: at
// the time of writing every one of these RPCs runs in 7-23ms, and the
// scope roster, the slowest, in 173ms. None of the waiting was
// database work. That is how a dashboard that holds no slow query still
// spends long enough in flight to be cut off with a 504, which is what
// the owner was seeing on 2026-09-14 — the scorecards filled and the
// charts underneath came back empty, because the queue ran out of time
// partway down.
//
// So: one action, one client, one getUser, and then the reads in a
// Promise.all where they ARE concurrent, because at that point they are
// ordinary fetches rather than queued actions.
//
// The roster is the one conditional piece. It costs 173ms — an order of
// magnitude more than anything else here — and it answers "who exists",
// which does not change when the range moves. So the page asks for it
// on the first load and never again, and the extra argument is what
// keeps it out of every subsequent call.

export interface DashboardBundle {
  fuel?: FuelPeriodStats;
  /** The same figures over the preceding window, for the deltas under
   *  the scorecards. Undefined where there is nothing before this range
   *  to compare with — All time, chiefly. */
  previousFuel?: FuelPeriodStats;
  series?: DashboardSeries;
  drivers?: DriverVariance[];
  trucks?: TruckVariance[];
  speeding?: DriverSpeeding[];
  stations?: StationLeaders;
  /** Only when asked for. Undefined on a refresh is not "the roster is
   *  empty" — the page keeps the list it already holds. */
  options?: ScopeOption[];
  /** The first hard failure among the panels. They share a range and a
   *  round trip, so if one signature is wrong they all are; reporting
   *  seven copies of one sentence would only bury it. */
  error?: string;
}

export async function getDashboardBundle(
  range: OpsRange,
  /** The preceding window, for the deltas — or null where there is
   *  nothing before this range.
   *
   *  PASSED IN rather than derived here, and not by preference: whether
   *  a month-shaped range means "the whole month before" or "the same
   *  many days of it" depends on which preset produced it, and
   *  presetKeyFor lives in RangeBar, a client component this file must
   *  not import. The page computes it once and uses the same value for
   *  the label it prints under the figures, so the two cannot disagree. */
  comparison: OpsRange | null,
  scope: Scope = FLEET,
  /** How many rows the two variance tables may return. The page sorts
   *  them itself, so this is a guard rather than a page size. */
  limits: { variance?: number; speeding?: number; stations?: number } = {},
  /** True only on the first load — see the note above. */
  includeOptions = false
): Promise<DashboardBundle> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  const variance = limits.variance ?? 500;
  const speedingLimit = limits.speeding ?? 100;
  const stationSlices = limits.stations ?? 6;

  const [f, s, dv, tv, sp, pf, st, opt] = await Promise.all([
    readFuelPeriodStats(supabase, range, scope),
    readDashboardSeries(supabase, range, scope),
    readDriverVariance(supabase, variance, range),
    readTruckVariance(supabase, variance, range),
    readDriverSpeeding(supabase, speedingLimit, range, scope),
    comparison
      ? readFuelPeriodStats(supabase, comparison, scope)
      : Promise.resolve({ stats: undefined, error: undefined }),
    readFuelStationLeaders(supabase, range, stationSlices, scope),
    includeOptions
      ? readScopeOptions(supabase)
      : Promise.resolve({ options: undefined, error: undefined }),
  ]);

  return {
    fuel: f.stats,
    // The comparison's own error is deliberately NOT folded into `error`
    // below: the page is still correct without a delta, and failing the
    // whole dashboard because the previous month would not load would
    // trade a working page for a missing footnote.
    previousFuel: pf.stats,
    series: s.series,
    drivers: dv.drivers,
    trucks: tv.trucks,
    speeding: sp.drivers,
    stations: st.data,
    options: opt.options,
    error: f.error ?? s.error ?? dv.error ?? tv.error ?? sp.error ?? st.error ?? undefined,
  };
}
