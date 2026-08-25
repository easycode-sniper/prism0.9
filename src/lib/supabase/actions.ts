"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { fetchRoute } from "@/lib/routing";
import { FACTORY_LAT, FACTORY_LNG } from "@/lib/constants";

// ── Auth ──

export async function signIn(email: string, password: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ── Dispatches ──

export async function createBatchDispatch(truckIds: string[], siteId: string) {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();

  if (!user.data.user) {
    return { error: "Not authenticated" };
  }

  if (truckIds.length === 0) {
    return { error: "Select at least one truck" };
  }

  const site = await supabase
    .from("construction_sites")
    .select("id, name, client, lat, lng")
    .eq("id", siteId)
    .single();

  if (site.error || !site.data) {
    return { error: "Site not found" };
  }

  if (site.data.lat == null || site.data.lng == null) {
    return { error: "Site has no coordinates" };
  }

  // All trucks in a convoy share the same origin (the one factory) and
  // destination, so the road route only needs to be fetched once.
  const route = await fetchRoute([FACTORY_LAT, FACTORY_LNG], [site.data.lat, site.data.lng]);

  const rows = truckIds.map((truckId) => ({
    truck_id: truckId,
    site_id: siteId,
    dispatched_by: user.data.user!.id,
    status: "active",
    route_geometry: route?.geometry ?? null,
    route_total_distance_meters: route?.distanceMeters ?? null,
    route_total_time_seconds: route?.durationSeconds ?? null,
  }));

  const dispatch = await supabase
    .from("dispatches")
    .insert(rows)
    .select(
      `
      id,
      truck_id,
      site_id,
      dispatched_at,
      status,
      route_geometry,
      site:construction_sites(name, client, lat, lng),
      dispatcher:profiles!dispatches_dispatched_by_fkey(full_name)
    `
    );

  if (dispatch.error) {
    return { error: dispatch.error.message };
  }

  return { data: dispatch.data as unknown as DispatchRecord[] };
}

export async function listActiveDispatches() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dispatches")
    .select(
      `
      id,
      truck_id,
      site_id,
      dispatched_at,
      status,
      last_lat,
      last_lng,
      last_checked_at,
      last_on_route,
      last_deviation_meters,
      last_eta_seconds,
      route_geometry,
      route_total_distance_meters,
      route_total_time_seconds,
      site:construction_sites(name, client, lat, lng),
      dispatcher:profiles!dispatches_dispatched_by_fkey(full_name)
    `
    )
    .eq("status", "active")
    .order("dispatched_at", { ascending: false });

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: (data ?? []) as unknown as DispatchRecord[] };
}

export async function stopDispatch(dispatchId: string) {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();

  if (!user.data.user) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("dispatches")
    .update({
      status: "stopped",
      stopped_at: new Date().toISOString(),
      stopped_by: user.data.user.id,
    })
    .eq("id", dispatchId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

/**
 * Make sure a run has a drawable route, fetching one if it doesn't.
 *
 * The geometry is normally fetched once, when the run is created. That
 * call goes to the public OSRM demo server, which is rate-limited and
 * does fail — and when it does, the dispatch is still created (a run
 * without a drawn line beats no run at all) with a null geometry. Four
 * of the twenty dispatches in the table are in that state.
 *
 * So "Show route" backfills instead of dead-ending on a disabled button:
 * same origin, same destination, same fetch as `createBatchDispatch`,
 * written back to the row so it costs one call per run and not one per
 * click.
 */
export async function ensureDispatchRoute(dispatchId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("dispatches")
    .select("id, route_geometry, site:construction_sites(lat, lng)")
    .eq("id", dispatchId)
    .single();

  if (error || !data) return { error: error?.message ?? "Run not found" };
  if (Array.isArray(data.route_geometry) && data.route_geometry.length >= 2) return { ok: true };

  // The embedded row comes back as an object at runtime; PostgREST's
  // generated types describe the relationship as an array.
  const site = (Array.isArray(data.site) ? data.site[0] : data.site) as
    | { lat: number | null; lng: number | null }
    | null;
  if (!site || site.lat == null || site.lng == null) {
    return { error: "This run's destination has no coordinates, so there is no route to draw." };
  }

  const route = await fetchRoute([FACTORY_LAT, FACTORY_LNG], [site.lat, site.lng]);
  if (!route) return { error: "The routing service didn't answer. Try again in a moment." };

  const { error: updateError } = await supabase
    .from("dispatches")
    .update({
      route_geometry: route.geometry,
      route_total_distance_meters: route.distanceMeters,
      route_total_time_seconds: route.durationSeconds,
    })
    .eq("id", dispatchId);

  if (updateError) return { error: updateError.message };
  return { ok: true };
}

export async function listSites() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("construction_sites")
    .select("id, name, client, lat, lng")
    .order("name");

  if (error) {
    return { error: error.message, data: [] };
  }

  return { data: data ?? [] };
}

// Types for dispatch records

export interface SiteRecord {
  id: string;
  name: string;
  client: string | null;
  lat: number | null;
  lng: number | null;
}

export interface DispatchRecord {
  id: string;
  truck_id: string;
  site_id: string;
  dispatched_at: string;
  status: string;
  last_lat: number | null;
  last_lng: number | null;
  last_checked_at: string | null;
  last_on_route: boolean | null;
  last_deviation_meters: number | null;
  last_eta_seconds: number | null;
  route_geometry: [number, number][] | null;
  route_total_distance_meters: number | null;
  route_total_time_seconds: number | null;
  site: { name: string; client: string | null; lat: number | null; lng: number | null } | null;
  dispatcher: { full_name: string | null } | null;
}
