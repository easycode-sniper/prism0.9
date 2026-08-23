"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/supabase/auth";

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

/** Algeria sits well inside these, but the check is the global range —
 *  the point is to reject a transposed pair or a stray digit, not to
 *  refuse a station the operator really does have somewhere unexpected. */
function parseCoordinate(raw: string, kind: "lat" | "lng"): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const limit = kind === "lat" ? 90 : 180;
  if (n < -limit || n > limit) return null;
  return n;
}

export async function createGasStation(
  name: string,
  latRaw: string,
  lngRaw: string
): Promise<{ station?: GasStation; error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can add stations" };

  const cleanName = name.trim().replace(/\s+/g, " ");
  if (!cleanName) return { error: "Give the station a name" };
  if (cleanName.length > 120) return { error: "That name is too long" };

  const lat = parseCoordinate(latRaw, "lat");
  if (lat === null) return { error: "Latitude must be a number between -90 and 90" };
  const lng = parseCoordinate(lngRaw, "lng");
  if (lng === null) return { error: "Longitude must be a number between -180 and 180" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gas_stations")
    .insert({ name: cleanName, lat, lng })
    .select("id, name, lat, lng")
    .single();

  if (error) {
    // 23505 is the unique index on (name, lat, lng) added in 023.
    if (error.code === "23505") return { error: "That station is already on the list" };
    return { error: error.message };
  }
  return { station: data as GasStation };
}

export async function deleteGasStation(id: string): Promise<{ error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can remove stations" };

  const supabase = await createClient();
  const { error } = await supabase.from("gas_stations").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}
