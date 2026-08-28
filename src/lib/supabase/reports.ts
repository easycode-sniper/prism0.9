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
