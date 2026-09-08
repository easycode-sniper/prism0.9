"use server";

import { createClient } from "@/lib/supabase/server";
import { UNLOADED_MIN_SECONDS } from "@/lib/constants";

export interface ParcEntry {
  id: string;
  truck_id: string;
  driver_name: string | null;
  entered_at: string;
}

// Cap so a careless range (or a year of data) can't try to render tens of
// thousands of rows into the browser. The UI says when it has been hit.
//
// 5000 WAS NEVER REACHABLE, and that was the bug. Every query below asked
// for MAX_ROWS + 1 and inferred "there was more" from getting the extra
// row back — sound reasoning against a database, and wrong against this
// one, because the API refuses to return more than 1000 rows in a
// response and does not error when it truncates. Ask for 5001, get 1000,
// count 1000, conclude "fewer than I asked for, so that is everything",
// and print a row count that looks entirely normal. The same silent
// ceiling had the fuel KPIs summing the first 1000 of 1147 fills before
// migration 028.
//
// TWO INDEPENDENT FIXES, because either alone can be undermined:
//
//   1. MAX_RANGE_DAYS below keeps the row count small enough that the
//      ceiling is never approached in the first place.
//   2. The queries now ask PostgREST for an EXACT COUNT alongside the
//      page of rows. That count is computed in Postgres over the whole
//      matching set and is unaffected by any row limit, so "is there
//      more than I am showing" is answered by the database rather than
//      inferred from what survived the wire. It stays right whatever the
//      API's ceiling turns out to be, and it lets the notice say how
//      many rows were actually found instead of only that some are
//      missing.
const MAX_ROWS = 5000;

/**
 * The longest range a report will run, in days.
 *
 * THE OWNER'S NUMBER, 2026-09-08: "thirty days will do just fine — I'm
 * not gonna look for a report that's over thirty days old", and a
 * six-month pull is "crazy data" he would not read. So this is a product
 * decision that happens to also be a safety one; it is not a workaround
 * for the ceiling above, which is why the exact count ships alongside it
 * rather than instead of it.
 *
 * 31 rather than 30 so that both a "last 30 days" preset (inclusive, so
 * 30 days) and a whole calendar month (up to 31) fit without the operator
 * having to shave a day off a date he typed correctly.
 *
 * For scale: at ~25 deliveries a day, 31 days of Rapport Livraisons is
 * about 775 rows. Rapport Parc runs ~10 entries a day and Geo is one
 * truck, so both are far smaller.
 */
const MAX_RANGE_DAYS = 31;

export async function getParcEntries(
  fromIso: string,
  toIso: string
): Promise<{ data: ParcEntry[]; truncated: boolean; total: number; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, total: 0, error: "Not authenticated" };

  // Was two inline checks that predated validateRange and so never
  // gained the span cap. One rule, one place.
  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], truncated: false, total: 0, error: invalid };

  // Staff vehicles are left out, and the filter has to be in the QUERY
  // rather than applied to the result: MAX_ROWS is a cap on rows coming
  // back, so filtering afterwards would truncate against a count that
  // includes rows the report never shows.
  //
  // The tick stopped writing parc entries for staff cars when they were
  // dropped from runHqArrivalCheck, so nothing new arrives — but 21 rows
  // were already on record, and a report that lists them while never
  // gaining another is inconsistent with itself across time. This is a
  // display filter over a true log, not a deletion: the rows stay.
  //
  // Read as a list rather than joined because hq_entries has no foreign
  // key to fleet_trucks — 011 dropped that relationship deliberately,
  // since Wialon is the roster. Ten staff vehicles is a small `in`.
  const { data: staffRows, error: staffError } = await supabase
    .from("fleet_trucks")
    .select("truck_id")
    .eq("category", "staff");
  if (staffError) return { data: [], truncated: false, total: 0, error: staffError.message };
  const staffIds = (staffRows ?? []).map((r) => r.truck_id as string);

  let query = supabase
    .from("hq_entries")
    .select("id, truck_id, driver_name, entered_at")
    .gte("entered_at", fromIso)
    .lte("entered_at", toIso);
  if (staffIds.length > 0) query = query.not("truck_id", "in", `(${staffIds.join(",")})`);

  const { data, error, count } = await query
    .order("entered_at", { ascending: true })
    .limit(MAX_ROWS);

  if (error) return { data: [], truncated: false, total: 0, error: error.message };

  return finish((data ?? []) as ParcEntry[], count);
}

/**
 * The one place a report decides whether it showed everything.
 *
 * `count` comes from PostgREST's exact count, computed over the whole
 * matching set in Postgres, so it is right regardless of how many rows
 * the response was actually allowed to carry. That is the entire point:
 * the previous rule compared the rows that ARRIVED against the number
 * asked for, which cannot detect a transport that quietly capped the
 * response — and this one did, at 1000.
 *
 * A null count (the header missing, or a server that did not compute it)
 * falls back to the old inference rather than claiming completeness it
 * cannot prove.
 */
function finish<T>(rows: T[], count: number | null): { data: T[]; truncated: boolean; total: number; error: null } {
  const total = count ?? rows.length;
  return { data: rows, truncated: total > rows.length, total, error: null };
}

// ── Rapport Usine ────────────────────────────────────────────
//
// Time at the Amouda plant, split between its two zones: the waiting
// area a truck queues in, and the loading bay inside it where cement
// actually goes on. Both halves of every stay are logged by the tick
// into zone_visits; see migration 039.
//
// No staff filter here, unlike the parc above. The tick only ever passes
// cargo trucks to the zone checks, so a staff car cannot produce a
// zone_visits row in the first place — a filter would be dead code
// implying a class of rows that does not exist.

/** 'factory' is the waiting area, 'factory_loading' the bay inside it. */
// validateRange and MAX_ROWS below served Rapport Usine too, until the
// owner dropped that report on 2026-09-01. Its three accessors
// (getFactoryVisits, getFactorySummary, getFactoryTotals) and their
// types went with it; the factory_zone_* RPCs they called still exist in
// the database and are simply no longer read. The LOGGING is untouched —
// Rapport Geo's Attente and Chargement rows are those same zone_visits.

function validateRange(fromIso: string, toIso: string): string | null {
  if (!fromIso || !toIso) return "Choose a start and end time";
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Those dates could not be read";
  }
  if (from > to) return "The start time is after the end time";
  // Rejected here rather than clipped silently. A report that quietly
  // narrowed the range it was given is the same class of lie as one that
  // quietly drops rows — the operator has to be the one who decides
  // which month he is looking at.
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > MAX_RANGE_DAYS) {
    return `That range is ${Math.ceil(days)} days. Reports cover up to ${MAX_RANGE_DAYS} days — narrow the dates.`;
  }
  return null;
}

// ── Rapport Geo ───────────────────────────────────────────────
//
// One truck, one range, every zone it entered — the plant's waiting area
// and loading bay alongside the client sites, in one chronological
// table. That is the shape of the Wialon export the owner works from.
//
// It answers "where did THIS truck spend its time", which is why it
// takes a truck and why 'site' rows appear at all — as opposed to the
// retired Rapport Usine, which asked what the whole fleet did at Amouda
// and could not see a client site.

export type GeoZoneKind = "factory" | "factory_loading" | "site";

export interface GeoVisit {
  truck_id: string;
  driver_name: string | null;
  zone_kind: GeoZoneKind;
  /** The zone's name as it read on the day it was entered, not as it
   *  reads now — the log must not rewrite its own history. */
  zone_name: string;
  /** construction_sites.id on a 'site' row, null on the two plant
   *  zones. What the totals group by, since names cannot be trusted to
   *  match (the Wialon export carries typos on both sides). */
  site_id: string | null;
  entered_at: string;
  /** Null while the truck is still inside. */
  exited_at: string | null;
  /** Null for the same reason — an open visit has no duration yet. */
  seconds_in_zone: number | null;
  /** How long the truck was at the plant before loading started:
   *  loading entry minus the enclosing waiting entry.
   *
   *  On a CHARGEMENT row only. The bay sits inside the waiting area, so
   *  an Attente row's own duration is total time at the plant — this is
   *  the wait on its own, and the two are not the same number. Null on
   *  every other kind, and on a loading visit nothing encloses; see
   *  migrations 040 and 043. */
  /** Still returned by geo_zone_visits, but no longer shown: the "Avant
   *  chargement" column was removed from the Geo table on 2026-09-03 at
   *  the owner's request. Kept here, and the RPC left alone, because
   *  dropping a function is a migration to undo while an unread field
   *  costs nothing — and restoring the column needs no database work. */
  queue_seconds: number | null;
}

export interface GeoTotalRow {
  zone_kind: GeoZoneKind;
  zone_name: string;
  site_id: string | null;
  visits: number;
  /** Visits that have actually ended; the total below is over these
   *  only, so an open visit cannot read as zero time spent. */
  closed_visits: number;
  total_seconds: number;
  max_seconds: number | null;
}

/** Every visit this truck made in the range, oldest first.
 *
 *  OVERLAP, not entry time — a stay that began at 23:50 and ended at
 *  02:00 belongs in both days' reports rather than in neither, and it
 *  is exactly the long waits the owner is looking for that straddle a
 *  boundary. The duration reported is the whole visit, not the slice
 *  inside the window; see migration 042. */
export async function getGeoVisits(
  truckId: string,
  fromIso: string,
  toIso: string
): Promise<{ data: GeoVisit[]; truncated: boolean; total: number; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, total: 0, error: "Not authenticated" };

  if (!truckId) return { data: [], truncated: false, total: 0, error: "Choose a truck" };
  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], truncated: false, total: 0, error: invalid };

  // One truck rather than the fleet, so the cap is far out of reach in
  // normal use — but counted exactly anyway, because PostgREST truncates
  // at 1000 without erroring and a silently partial report is the
  // failure this codebase keeps paying for.
  const { data, error, count } = await supabase
    .rpc("geo_zone_visits", { p_truck_id: truckId, p_from: fromIso, p_to: toIso }, { count: "exact" })
    .limit(MAX_ROWS);

  if (error) return { data: [], truncated: false, total: 0, error: error.message };

  return finish((data ?? []) as GeoVisit[], count);
}

/** One row per zone visited, for the strip above the table.
 *
 *  Aggregated in Postgres rather than summed from the list above, for
 *  the reason 041 exists: the detail is capped and a total derived from
 *  a truncated list is wrong without saying so. */
export async function getGeoTotals(
  truckId: string,
  fromIso: string,
  toIso: string
): Promise<{ data: GeoTotalRow[]; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], error: "Not authenticated" };

  if (!truckId) return { data: [], error: "Choose a truck" };
  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], error: invalid };

  const { data, error } = await supabase.rpc("geo_zone_totals", {
    p_truck_id: truckId,
    p_from: fromIso,
    p_to: toIso,
  });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as GeoTotalRow[], error: null };
}

/** The trucks Rapport Geo can be run for.
 *
 *  Cargo only, matching the tick: runSiteZoneCheck and both factory
 *  checks take cargoTrucks, so a staff car has no zone_visits rows and
 *  offering one in the picker would only ever produce an empty report.
 *
 *  Read from fleet_trucks rather than from zone_visits so a truck that
 *  has not moved yet is still selectable — an empty report for a real
 *  truck is an answer, a missing truck is a puzzle. */
export async function getReportableTrucks(): Promise<{
  data: { truck_id: string; name: string | null }[];
  error: string | null;
}> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], error: "Not authenticated" };

  const { data, error } = await supabase
    .from("fleet_trucks")
    .select("truck_id, name")
    .neq("category", "staff")
    .order("truck_id", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as { truck_id: string; name: string | null }[], error: null };
}

// ── Rapport Livraisons ────────────────────────────────────────
//
// The same zone_visits log Geo reads, turned ninety degrees: Geo is one
// truck across every zone, this is every truck across the client sites
// only. The plant is excluded in SQL rather than filtered here — across
// 46 trucks every delivery is bracketed by an Attente and a Chargement
// row, so a fleet-wide read that included them would be two thirds
// plant and the cap would be spent on rows nobody asked for.

export interface FleetSiteVisit {
  truck_id: string;
  /** Stamped per visit, so a truck that changed hands mid-period shows
   *  both drivers on the rows they actually drove. */
  driver_name: string | null;
  zone_name: string;
  /** From public.clients, falling back to construction_sites.client.
   *  Null for a site in neither — 8 of the 130 delivery points have no
   *  site row at all (migration 051). */
  client_name: string | null;
  site_id: string | null;
  entered_at: string;
  /** Null while the truck is still on site. */
  exited_at: string | null;
  /** Null for the same reason: an open visit has no duration yet. */
  seconds_on_site: number | null;
}

export interface FleetSiteTotalRow {
  truck_id: string;
  deliveries: number;
  /** Distinct site_id, not distinct name — the Wialon export carries
   *  typos on both sides and two spellings of one site would count as
   *  two places. */
  sites: number;
  closed_visits: number;
  total_seconds: number;
  last_site: string | null;
  last_entered: string | null;
  /** Distinct sites across the WHOLE fleet in the range — the same value
   *  on every row. Not the sum of `sites` above, which counts a site once
   *  per truck that went there: over one week that read 152 against a
   *  true 36. Computed in SQL rather than from the visit list because
   *  that list is capped. */
  fleet_sites: number;
}

/** Every client-site visit the fleet made in the range, grouped by truck.
 *
 *  OVERLAP, not entry time — 042's rule, so this and Geo cannot disagree
 *  about which day a delivery belongs to. */
export async function getFleetSiteVisits(
  fromIso: string,
  toIso: string
): Promise<{ data: FleetSiteVisit[]; truncated: boolean; total: number; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, total: 0, error: "Not authenticated" };

  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], truncated: false, total: 0, error: invalid };

  // Asked for explicitly, and it matters more here than it does on Geo:
  // this is the whole fleet, so the cap is reachable on a wide range,
  // and PostgREST truncates at its own limit without erroring. A
  // silently partial report is the failure this codebase keeps paying
  // for.
  const { data, error, count } = await supabase
    .rpc("fleet_site_visits", {
      p_from: fromIso,
      p_to: toIso,
      // Passed rather than left to the SQL default, so the number is
      // greppable from the app and cannot drift from the sentence the
      // page prints under the heading.
      p_min_seconds: UNLOADED_MIN_SECONDS,
    }, { count: "exact" })
    .limit(MAX_ROWS);

  if (error) return { data: [], truncated: false, total: 0, error: error.message };

  return finish((data ?? []) as FleetSiteVisit[], count);
}

/** One row per truck, for the strip above the table.
 *
 *  Aggregated in Postgres for the reason 041 exists — a total summed
 *  from the capped list above would be wrong without saying so. One row
 *  per truck is ~50 rows and cannot itself be truncated, so the page may
 *  safely add these up for the fleet-wide figures. */
export async function getFleetSiteTotals(
  fromIso: string,
  toIso: string
): Promise<{ data: FleetSiteTotalRow[]; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], error: "Not authenticated" };

  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], error: invalid };

  // The same threshold as the detail, necessarily: a summary counting a
  // different set of visits from the table under it is wrong in the way
  // nobody checks.
  const { data, error } = await supabase.rpc("fleet_site_totals", {
    p_from: fromIso,
    p_to: toIso,
    p_min_seconds: UNLOADED_MIN_SECONDS,
  });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as FleetSiteTotalRow[], error: null };
}

// ── Rapport Voyages ───────────────────────────────────────────
//
// One row per truck: what it cost to run, and how many trips it made for
// the money. The owner's spec, 2026-09-08, given as a hand-made CSV —
// truck, driver, amount, kilometres, litres, L/100km, variance, voyages,
// in that order.
//
// It is the only report that joins the two halves of this app. Every
// other one reads either the fuel sheet or the zone log; this one puts a
// truck's fuel beside the work it did for it, which is the comparison
// the fuel desk actually makes.

export interface VoyageRow {
  truck_id: string;
  /** Every driver who fuelled this truck in the range, most fills first.
   *  A LIST rather than a name: over a month 38 of 74 trucks carry two
   *  drivers and 9 carry three, and picking one would make him answer
   *  for another man's fuel. */
  drivers: string;
  driver_count: number;
  amount_da: number;
  km: number;
  litres: number;
  litres_per_100km: number | null;
  variance_da: number;
  fills: number;
  /** NULL, NEVER 0 — the report prints "Not available".
   *
   *  The owner called this before it was built: the fuel sheet covers
   *  the whole fleet, but voyages can only be counted from the one plant
   *  this app watches. A truck with no voyages either made none or
   *  loaded somewhere Amouda's geofence cannot see, and 0 asserts the
   *  first when the data cannot separate them. 28 of 74 trucks today. */
  voyages: number | null;
}

export async function getVoyageReport(
  fromIso: string,
  toIso: string
): Promise<{ data: VoyageRow[]; truncated: boolean; total: number; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, total: 0, error: "Not authenticated" };

  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], truncated: false, total: 0, error: invalid };

  // One row per truck, so this is ~78 rows and the cap is nowhere near.
  // Counted exactly anyway, on the same reasoning as the others: the
  // ceiling that bites is the transport's, not ours.
  const { data, error, count } = await supabase
    .rpc("fuel_voyage_report", {
      p_from: fromIso,
      p_to: toIso,
      // The same constant Livraisons and Déchargés pass, so all three
      // agree on what counts as reaching a client.
      p_min_seconds: UNLOADED_MIN_SECONDS,
      p_limit: MAX_ROWS,
    }, { count: "exact" })
    .limit(MAX_ROWS);

  if (error) return { data: [], truncated: false, total: 0, error: error.message };

  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    truck_id: String(r.truck_id ?? "—"),
    drivers: String(r.drivers ?? "—"),
    driver_count: Number(r.driver_count ?? 0),
    amount_da: Number(r.amount_da ?? 0),
    km: Number(r.km ?? 0),
    litres: Number(r.litres ?? 0),
    litres_per_100km: r.litres_per_100km == null ? null : Number(r.litres_per_100km),
    variance_da: Number(r.variance_da ?? 0),
    fills: Number(r.fills ?? 0),
    // The one field that must survive as null. Number(null) is 0, which
    // would turn "we cannot tell" into "it made no trips".
    voyages: r.voyages == null ? null : Number(r.voyages),
  }));

  return finish(rows, count);
}
