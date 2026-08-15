"use server";

import { createClient } from "@/lib/supabase/server";

export interface GasStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export async function listGasStations(): Promise<{ data: GasStation[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gas_stations")
    .select("id, name, lat, lng")
    .order("name");

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as GasStation[], error: null };
}
