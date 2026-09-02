"use server";

// Which trucks have finished at the client and are free.
//
// The 25-minute rule and the 12-hour cutoff live in lib/constants.ts:
// this file is "use server", which may only export async functions, and
// the panel renders the threshold in its own subtitle so the rule and
// the sentence explaining it cannot drift apart.
//
// Its own module rather than an addition to monitoring.ts, which is
// deliberately NOT "use server" — that file is types only, shared with
// fleetJoin.ts and rendered client-side, and adding a server action to
// it would make every export there a callable HTTP endpoint.

import { createClient } from "@/lib/supabase/server";
import { UNLOADED_MIN_SECONDS, UNLOADED_MAX_AGE_HOURS } from "@/lib/constants";

export interface UnloadedTruck {
  truck_id: string;
  driver_name: string | null;
  /** The site as it was named on the day it was visited. */
  zone_name: string;
  site_id: string | null;
  entered_at: string;
  exited_at: string;
  seconds_on_site: number;
}

export async function getUnloadedTrucks(): Promise<{
  data: UnloadedTruck[];
  error: string | null;
}> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { data: [], error: "Not authenticated" };

  // Filtered and ordered in Postgres. The result is bounded by the size
  // of the fleet — one row per truck at most — so nothing here can meet
  // the 1000-row cap PostgREST truncates at without erroring.
  const { data, error } = await supabase.rpc("unloaded_trucks", {
    p_min_seconds: UNLOADED_MIN_SECONDS,
    p_max_age_hours: UNLOADED_MAX_AGE_HOURS,
  });

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as UnloadedTruck[], error: null };
}
