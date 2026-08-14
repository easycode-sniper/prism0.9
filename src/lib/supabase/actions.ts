"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

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

  const rows = truckIds.map((truckId) => ({
    truck_id: truckId,
    site_id: siteId,
    dispatched_by: user.data.user!.id,
    status: "active",
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

export async function listTrucks() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fleet_trucks")
    .select("truck_id, name, status")
    .eq("status", "active")
    .order("truck_id");

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

export interface TruckRecord {
  truck_id: string;
  name: string | null;
  status: string;
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
  site: { name: string; client: string | null; lat: number | null; lng: number | null }[];
  dispatcher: { full_name: string | null }[];
}
