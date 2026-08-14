import { createClient } from "@/lib/supabase/client";
import { getFleetData } from "@/lib/wialon/config";

export async function getFleetLiveData() {
  const client = createClient();

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
