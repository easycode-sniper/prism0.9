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
export type FactoryZoneKind = "factory" | "factory_loading";

export interface FactoryVisit {
  truck_id: string;
  driver_name: string | null;
  zone_kind: FactoryZoneKind;
  zone_name: string;
  entered_at: string;
  /** Null while the truck is still inside. */
  exited_at: string | null;
  /** Null for the same reason — an open visit has no duration yet, and
   *  rendering it as zero would read as a truck that came and went. */
  seconds_in_zone: number | null;
}

export interface FactorySummaryRow {
  truck_id: string;
  driver_name: string | null;
  zone_kind: FactoryZoneKind;
  visits: number;
  /** Visits that have actually ended. The averages below are over these
   *  only, so an open visit cannot drag a median down to zero. */
  closed_visits: number;
  total_seconds: number;
  median_seconds: number | null;
  max_seconds: number | null;
}

function validateRange(fromIso: string, toIso: string): string | null {
  if (!fromIso || !toIso) return "Choose a start and end time";
  if (new Date(fromIso) > new Date(toIso)) return "The start time is after the end time";
  return null;
}

/** One row per visit — the owner's table, verbatim. */
export async function getFactoryVisits(
  fromIso: string,
  toIso: string
): Promise<{ data: FactoryVisit[]; truncated: boolean; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], truncated: false, error: "Not authenticated" };

  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], truncated: false, error: invalid };

  // Aggregated and ordered in Postgres — PostgREST caps a response at
  // 1000 rows and does NOT error when it truncates, so a range wide
  // enough to exceed the cap would silently show a partial report. The
  // limit here is explicit and the UI says when it is hit.
  const { data, error } = await supabase
    .rpc("factory_zone_visits", { p_from: fromIso, p_to: toIso })
    .limit(MAX_ROWS + 1);

  if (error) return { data: [], truncated: false, error: error.message };

  const rows = (data ?? []) as FactoryVisit[];
  return {
    data: rows.slice(0, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
    error: null,
  };
}

/** One row per truck per zone. Bounded by the size of the fleet rather
 *  than by the length of the range, so it stays usable over a month. */
export async function getFactorySummary(
  fromIso: string,
  toIso: string
): Promise<{ data: FactorySummaryRow[]; error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], error: "Not authenticated" };

  const invalid = validateRange(fromIso, toIso);
  if (invalid) return { data: [], error: invalid };

  const { data, error } = await supabase.rpc("factory_zone_summary", {
    p_from: fromIso,
    p_to: toIso,
  });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as FactorySummaryRow[], error: null };
}
