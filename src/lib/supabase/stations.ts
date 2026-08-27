"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/supabase/auth";

export interface GasStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Forecourt radius. Widened for a blacklisted station by
   *  stationWatchRadius() rather than by writing a bigger number here. */
  radiusMeters: number;
  blacklisted: boolean;
  blacklistNote: string | null;
}

function toStation(r: Record<string, unknown>): GasStation {
  return {
    id: r.id as string,
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
    radiusMeters: (r.radius_meters as number) ?? 50,
    blacklisted: (r.blacklisted as boolean) ?? false,
    blacklistNote: (r.blacklist_note as string | null) ?? null,
  };
}

export async function listGasStations(): Promise<{ data: GasStation[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("gas_stations")
    .select("id, name, lat, lng, radius_meters, blacklisted, blacklist_note")
    .order("name");

  if (error) return { data: [], error: error.message };
  return {
    data: (data ?? []).map(toStation),
    error: null,
  };
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
    .select("id, name, lat, lng, radius_meters, blacklisted, blacklist_note")
    .single();

  if (error) {
    // 23505 is the unique index on (name, lat, lng) added in 023.
    if (error.code === "23505") return { error: "That station is already on the list" };
    return { error: error.message };
  }
  // Mapped, not cast. The row comes back snake_case, so `data as
  // GasStation` typechecks while leaving radiusMeters and blacklisted
  // undefined at runtime.
  return { station: toStation(data) };
}

export async function deleteGasStation(id: string): Promise<{ error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can remove stations" };

  const supabase = await createClient();
  const { error } = await supabase.from("gas_stations").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}

/**
 * Mark a station as one that takes money from drivers, or clear it.
 *
 * Admin-only in code AND in the database: gas_stations carries an
 * admin-only UPDATE policy, so a non-admin's write is refused there too
 * rather than relying on this check alone.
 *
 * Blacklisting does NOT write a bigger radius — the wider watch radius
 * is derived by stationWatchRadius(), so clearing the blacklist restores
 * the station's own radius instead of leaving it stuck at 150m.
 */
export async function setStationBlacklisted(
  id: string,
  blacklisted: boolean,
  note?: string
): Promise<{ station?: GasStation; error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can blacklist a station" };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  const clean = (note ?? "").trim().slice(0, 300);

  const { data, error } = await supabase
    .from("gas_stations")
    .update({
      blacklisted,
      // Stamped on the way in and cleared on the way out, so the record
      // never claims a station is blacklisted by someone who lifted it.
      blacklisted_at: blacklisted ? new Date().toISOString() : null,
      blacklisted_by: blacklisted ? (userData.user?.id ?? null) : null,
      blacklist_note: blacklisted ? (clean || null) : null,
    })
    .eq("id", id)
    .select("id, name, lat, lng, radius_meters, blacklisted, blacklist_note")
    .single();

  if (error) return { error: error.message };
  return { station: toStation(data) };
}

/**
 * Whether the caller may blacklist stations.
 *
 * Exists so the dispatch map can hide the control without importing
 * isAdmin() directly: auth.ts is not a "use server" module, so a client
 * component importing it drags next/headers into the browser bundle and
 * fails the build. This module already is one, so the check crosses the
 * boundary as a server action instead.
 *
 * Convenience only. setStationBlacklisted re-checks, and gas_stations
 * carries an admin-only UPDATE policy underneath both.
 */
export async function canBlacklistStations(): Promise<boolean> {
  return isAdmin();
}
