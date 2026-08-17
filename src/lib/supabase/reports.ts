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

  const { data, error } = await supabase
    .from("hq_entries")
    .select("id, truck_id, driver_name, entered_at")
    .gte("entered_at", fromIso)
    .lte("entered_at", toIso)
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
