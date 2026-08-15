"use server";

// Was previously using the browser Supabase client, which only
// authenticates correctly when this code runs client-side. Once
// monitoring.ts (a "use server" module) started calling this too, the
// call ran entirely server-side, the browser client couldn't read the
// session cookie, and the RLS-protected fleet_trucks query silently
// returned zero rows. "use server" here makes this a proper server
// action — safe to call from client components (live-fleet/page.tsx,
// via RPC) and from other server code (monitoring.ts, direct call).

import { createClient } from "@/lib/supabase/server";
import { getFleetData } from "@/lib/wialon/config";

export async function getFleetLiveData() {
  const client = await createClient();

  const { data: truckRows } = await client
    .from("fleet_trucks")
    .select("truck_id")
    .eq("status", "active");

  const truckIds = (truckRows ?? []).map((t: any) => t.truck_id);

  if (truckIds.length === 0) {
    return { trucks: [], error: null };
  }

  return getFleetData(truckIds);
}
