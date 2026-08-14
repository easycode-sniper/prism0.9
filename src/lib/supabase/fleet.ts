import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getFleetData } from "@/lib/wialon/config";

let supabase: ReturnType<typeof createSupabaseClient> | null = null;

function getClient(): any {
  if (!supabase) {
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return supabase;
}

export async function getFleetLiveData() {
  const client = getClient();

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
