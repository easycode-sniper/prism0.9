"use server";

import { createClient } from "@/lib/supabase/server";

// ── History ──

export interface HistoryRecord {
  id: string;
  truck_id: string;
  site_name: string | null;
  client: string | null;
  driver_name: string | null;
  dispatched_at: string;
  stopped_at: string | null;
  status: "completed" | "stopped";
  reached_site: boolean | null;
  reached_factory: boolean | null;
  ever_off_route: boolean;
  ever_speeding: boolean;
  duration_minutes: number | null;
  last_deviation_meters: number | null;
  last_eta_seconds: number | null;
  dispatcher_name: string | null;
}

export async function getHistoryData(): Promise<{ data: HistoryRecord[]; error: string | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("dispatches")
    .select(
      `
      id,
      truck_id,
      dispatched_at,
      stopped_at,
      status,
      ever_off_route,
      ever_speeding,
      last_deviation_meters,
      last_eta_seconds,
      arrived_at,
      site_arrival_notified,
      factory_arrival_notified,
      site:construction_sites(name, client),
      dispatcher:profiles!dispatches_dispatched_by_fkey(full_name),
      stopper:profiles!dispatches_stopped_by_fkey(full_name)
    `
    )
    .in("status", ["stopped", "completed"])
    .order("stopped_at", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) return { data: [], error: error.message };

  const records: HistoryRecord[] = ((data ?? []) as any[]).map((d) => {
    const stoppedAt = d.stopped_at ? new Date(d.stopped_at) : null;
    const dispatchedAt = new Date(d.dispatched_at);
    const durationMinutes = stoppedAt
      ? Math.round((stoppedAt.getTime() - dispatchedAt.getTime()) / 60000)
      : null;

    return {
      id: d.id,
      truck_id: d.truck_id,
      site_name: Array.isArray(d.site) ? d.site[0]?.name : d.site?.name || null,
      client: Array.isArray(d.site) ? d.site[0]?.client : d.site?.client || null,
      driver_name: null,
      dispatched_at: d.dispatched_at,
      stopped_at: d.stopped_at,
      status: d.status,
      reached_site: d.site_arrival_notified,
      reached_factory: d.factory_arrival_notified,
      ever_off_route: d.ever_off_route || false,
      ever_speeding: d.ever_speeding || false,
      duration_minutes: durationMinutes,
      last_deviation_meters: d.last_deviation_meters,
      last_eta_seconds: d.last_eta_seconds,
      dispatcher_name: Array.isArray(d.dispatcher)
        ? d.dispatcher[0]?.full_name
        : d.dispatcher?.full_name || null,
    };
  });

  return { data: records, error: null };
}

// ── Notifications ──

export interface NotificationRecord {
  id: string;
  dispatch_id: string | null;
  truck_id: string;
  kind: "off_route" | "speeding" | "site_arrival" | "factory_arrival";
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

export async function getNotifications(): Promise<{ data: NotificationRecord[]; error: string | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as NotificationRecord[], error: null };
}

export async function markNotificationRead(notificationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("id", notificationId);
  return { error: error?.message ?? null };
}

export async function markAllNotificationsRead(): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.data.user.id)
    .single();

  if (profile?.role === "admin") {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("read", false);
    return { error: error?.message ?? null };
  }

  const { data: dispatches } = await supabase
    .from("dispatches")
    .select("id")
    .eq("dispatched_by", user.data.user.id);

  const dispatchIds = (dispatches ?? []).map((d) => d.id);
  if (dispatchIds.length === 0) return { error: null };

  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("read", false)
    .in("dispatch_id", dispatchIds);

  return { error: error?.message ?? null };
}

// ── Routes ──

export interface RouteData {
  dispatch_id: string;
  truck_id: string;
  site_name: string | null;
  route_geometry: [number, number][] | null;
  total_distance_meters: number | null;
  total_time_seconds: number | null;
  last_lat: number | null;
  last_lng: number | null;
  site_lat: number | null;
  site_lng: number | null;
}

export async function getDispatchRoute(dispatchId: string): Promise<{ data: RouteData | null; error: string | null }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("dispatches")
    .select(
      `
      id,
      truck_id,
      route_geometry,
      route_total_distance_meters,
      route_total_time_seconds,
      last_lat,
      last_lng,
      site:construction_sites(name, lat, lng)
    `
    )
    .eq("id", dispatchId)
    .single();

  if (error) return { data: null, error: error.message };

  const site = data.site as any;
  return {
    data: {
      dispatch_id: data.id,
      truck_id: data.truck_id,
      site_name: Array.isArray(site) ? site[0]?.name : site?.name || null,
      route_geometry: data.route_geometry,
      total_distance_meters: data.route_total_distance_meters,
      total_time_seconds: data.route_total_time_seconds,
      last_lat: data.last_lat,
      last_lng: data.last_lng,
      site_lat: Array.isArray(site) ? site[0]?.lat : site?.lat ?? null,
      site_lng: Array.isArray(site) ? site[0]?.lng : site?.lng ?? null,
    },
    error: null,
  };
}
