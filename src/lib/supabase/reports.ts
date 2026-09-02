"use server";

import { createClient } from "@/lib/supabase/server";

export interface ParcEntry {
  id: string;
  truck_id: string;
  driver_name: string | null;
  entered_at: string;
}

// Cap so a careless range (or a year of data) can't try to render tens of
// thousands of rows into the browser. The UI says when it has been hit.
const MAX_ROWS = 5000;

export async function getParcEntries(
  fromIso: string,
  toIso: string
): Promise<{ data: ParcEntry[]; truncated: boolean; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, error: "Not authenticated" };

  if (!fromIso || !toIso) {
    return { data: [], truncated: false, error: "Choose a start and end time" };
  }
  if (new Date(fromIso) > new Date(toIso)) {
    return { data: [], truncated: false, error: "The start time is after the end time" };
  }

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
  if (staffError) return { data: [], truncated: false, error: staffError.message };
  const staffIds = (staffRows ?? []).map((r) => r.truck_id as string);

  let query = supabase
    .from("hq_entries")
    .select("id, truck_id, driver_name, entered_at")
    .gte("entered_at", fromIso)
    .lte("entered_at", toIso);
  if (staffIds.length > 0) query = query.not("truck_id", "in", `(${staffIds.join(",")})`);

  const { data, error } = await query
    .order("entered_at", { ascending: true })
    .limit(MAX_ROWS + 1);

  if (error) return { data: [], truncated: false, error: error.message };

  const rows = (data ?? []) as ParcEntry[];
  return {
    data: rows.slice(0, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
    error: null,
  };
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
  if (new Date(fromIso) > new Date(toIso)) return "The start time is after the end time";
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
): Promise<{ data: GeoVisit[]; truncated: boolean; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, error: "Not authenticated" };

  if (!truckId) return { data: [], truncated: false, error: "Choose a truck" };
  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], truncated: false, error: invalid };

  // One truck rather than the fleet, so the cap is far out of reach in
  // normal use — but asked for explicitly anyway, because PostgREST
  // truncates at 1000 without erroring and a silently partial report is
  // the failure this codebase keeps paying for.
  const { data, error } = await supabase
    .rpc("geo_zone_visits", { p_truck_id: truckId, p_from: fromIso, p_to: toIso })
    .limit(MAX_ROWS + 1);

  if (error) return { data: [], truncated: false, error: error.message };

  const rows = (data ?? []) as GeoVisit[];
  return { data: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS, error: null };
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
