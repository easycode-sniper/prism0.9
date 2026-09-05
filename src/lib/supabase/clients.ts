"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * The client directory — one row per delivery point. See migration 051
 * for why the grain is a place rather than a company, and for how the
 * hours column was parsed out of 50 different spellings.
 */
export interface ClientRecord {
  id: string;
  clientCode: string | null;
  name: string;
  phones: string[];
  phoneNote: string | null;
  rep: string | null;
  siteName: string | null;
  siteId: string | null;
  distanceKm: number | null;
  is24h: boolean | null;
  opensAt: string | null;
  closesAt: string | null;
  fridayExcluded: boolean | null;
  sevenDays: boolean | null;
  hoursRaw: string | null;
  /** From the linked construction_site. Null for the 8 delivery points
   *  that have no site row yet, which is what hides Locate on them. */
  lat: number | null;
  lng: number | null;
}

interface Row {
  id: string;
  client_code: string | null;
  name: string;
  phones: string[] | null;
  phone_note: string | null;
  rep: string | null;
  site_name: string | null;
  site_id: string | null;
  distance_km: number | string | null;
  is_24h: boolean | null;
  opens_at: string | null;
  closes_at: string | null;
  friday_excluded: boolean | null;
  seven_days: boolean | null;
  hours_raw: string | null;
  // PostgREST returns an embedded one-to-one as an object, but types it
  // as possibly an array; normalised in toRecord rather than trusted.
  site: { lat: number | null; lng: number | null } | { lat: number | null; lng: number | null }[] | null;
}

function coords(site: Row["site"]): { lat: number | null; lng: number | null } {
  const s = Array.isArray(site) ? site[0] : site;
  return { lat: s?.lat ?? null, lng: s?.lng ?? null };
}

export async function listClients(): Promise<{ data: ClientRecord[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, client_code, name, phones, phone_note, rep, site_name, site_id, distance_km, is_24h, opens_at, closes_at, friday_excluded, seven_days, hours_raw, site:construction_sites(lat, lng)")
    .order("name");

  if (error) return { data: [], error: error.message };

  return {
    data: ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      clientCode: r.client_code,
      name: r.name,
      phones: r.phones ?? [],
      phoneNote: r.phone_note,
      rep: r.rep,
      siteName: r.site_name,
      siteId: r.site_id,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      is24h: r.is_24h,
      // Postgres hands back time as "07:00:00"; the two characters of
      // seconds are noise in every place this is shown.
      opensAt: r.opens_at ? r.opens_at.slice(0, 5) : null,
      closesAt: r.closes_at ? r.closes_at.slice(0, 5) : null,
      fridayExcluded: r.friday_excluded,
      sevenDays: r.seven_days,
      hoursRaw: r.hours_raw,
      ...coords(r.site),
    })),
    error: null,
  };
}
