"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/supabase/auth";

// Client sites live in construction_sites, which already carried 125 rows
// imported from the original spreadsheet. This adds the manual path: a
// client name, where the site is, and its coordinates — the same shape
// as the gas-station form, because it is the same job.

export interface ClientSite {
  id: string;
  name: string;
  client: string | null;
  lat: number | null;
  lng: number | null;
  isManual: boolean;
}

export async function listClientSites(): Promise<{ data: ClientSite[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("construction_sites")
    .select("id, name, client, lat, lng, is_manual")
    .order("name");

  if (error) return { data: [], error: error.message };
  return {
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      client: (r.client as string | null) ?? null,
      lat: r.lat as number | null,
      lng: r.lng as number | null,
      isManual: r.is_manual === true,
    })),
    error: null,
  };
}

/** Algeria sits well inside these, but the check is the global range —
 *  the point is to reject a transposed pair or a stray digit, not to
 *  refuse a site the operator really does have somewhere unexpected. */
function parseCoordinate(raw: string, kind: "lat" | "lng"): number | null {
  const n = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const limit = kind === "lat" ? 90 : 180;
  if (n < -limit || n > limit) return null;
  return n;
}

export async function createClientSite(input: {
  client: string;
  name: string;
  lat: string;
  lng: string;
}): Promise<{ site?: ClientSite; error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can add clients" };

  const clean = (v: string) => v.trim().replace(/\s+/g, " ");
  const client = clean(input.client);
  const name = clean(input.name);

  if (!client) return { error: "Give the client a name" };
  if (!name) return { error: "Give the site a location" };
  if (client.length > 160) return { error: "That client name is too long" };
  if (name.length > 160) return { error: "That location is too long" };

  const lat = parseCoordinate(input.lat, "lat");
  if (lat === null) return { error: "Latitude must be a number between -90 and 90" };
  const lng = parseCoordinate(input.lng, "lng");
  if (lng === null) return { error: "Longitude must be a number between -180 and 180" };

  const supabase = await createClient();

  // site_code is NOT NULL and carries no default — the imported rows use
  // site_0, site_1… from the original spreadsheet's ordering, which a
  // manual entry has no place in. There is no unique index on it, but
  // colliding with an imported code would still be misleading, so manual
  // rows get their own namespace rather than continuing that sequence.
  const site_code = `manual_${Date.now().toString(36)}`;

  const { data, error } = await supabase
    .from("construction_sites")
    .insert({
      site_code,
      name,
      client,
      lat,
      lng,
      // 'exact' rather than 'approx': these are coordinates someone typed
      // deliberately, not a town-centre guess inferred from an address.
      accuracy: "exact",
      is_manual: true,
    })
    .select("id, name, client, lat, lng, is_manual")
    .single();

  if (error) return { error: error.message };

  return {
    site: {
      id: data.id as string,
      name: data.name as string,
      client: (data.client as string | null) ?? null,
      lat: data.lat as number | null,
      lng: data.lng as number | null,
      isManual: data.is_manual === true,
    },
  };
}

export async function deleteClientSite(id: string): Promise<{ error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can remove clients" };

  const supabase = await createClient();

  // A site with dispatches against it is referenced by history and by the
  // arrival checks; deleting it would orphan those rows (or be refused by
  // the FK, depending on how it was declared). Better to say so plainly
  // than to surface a constraint error.
  const { count, error: countError } = await supabase
    .from("dispatches")
    .select("id", { count: "exact", head: true })
    .eq("site_id", id);

  if (countError) return { error: countError.message };
  if ((count ?? 0) > 0) {
    return {
      error: `This site has ${count} dispatch${count === 1 ? "" : "es"} against it and can't be removed.`,
    };
  }

  const { error } = await supabase.from("construction_sites").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}
