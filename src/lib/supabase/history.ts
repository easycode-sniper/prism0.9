"use server";

import { createClient } from "@/lib/supabase/server";
import { NOTIFICATION_FEED_HOURS } from "@/lib/constants";
import type { NotificationKind } from "@/lib/notifications/kinds";

// ── History ──

export interface HistoryRecord {
  id: string;
  truck_id: string;
  site_name: string | null;
  client: string | null;
  driver_name: string | null;
  dispatched_at: string;
  ended_at: string | null;
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
      driver_name,
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
    // Ordered by dispatched_at, not by when the run ended: a run that
    // completed on arrival has no stopped_at, so ordering on that column
    // sorted every completed run to the bottom — where the 500-row limit
    // then cut them off. dispatched_at is never null. The rows are put
    // back into ended-at order below, once both endings are resolved.
    .order("dispatched_at", { ascending: false })
    .limit(500);

  if (error) return { data: [], error: error.message };

  const records: HistoryRecord[] = ((data ?? []) as any[]).map((d) => {
    // A run ends either when the truck reached the client or when a
    // dispatcher stopped it early. Arrival comes first: it is the real
    // end of the delivery, and a run completed that way never gets a
    // stopped_at at all. So this duration answers the question the
    // History page is actually asked — how long the truck took to reach
    // the destination — and still covers stopped runs the old way.
    const endedAtRaw: string | null = d.arrived_at ?? d.stopped_at ?? null;
    const endedAt = endedAtRaw ? new Date(endedAtRaw) : null;
    const dispatchedAt = new Date(d.dispatched_at);
    const durationMinutes = endedAt
      ? Math.round((endedAt.getTime() - dispatchedAt.getTime()) / 60000)
      : null;

    return {
      id: d.id,
      truck_id: d.truck_id,
      site_name: Array.isArray(d.site) ? d.site[0]?.name : d.site?.name || null,
      client: Array.isArray(d.site) ? d.site[0]?.client : d.site?.client || null,
      driver_name: d.driver_name || null,
      dispatched_at: d.dispatched_at,
      ended_at: endedAtRaw,
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

  // Newest ending first, which is what the fetch order could not express.
  records.sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""));

  return { data: records, error: null };
}

// ── Driver Ratings ──
// Score = % of completed runs with NEITHER a route deviation NOR a
// speeding violation. A run only counts as "clean" if both are true.

export interface DriverRating {
  name: string;
  totalRuns: number;
  deviations: number;
  speedingCount: number;
  cleanRuns: number;
  score: number;
}

export async function getDriverRatings(): Promise<{ data: DriverRating[]; error: string | null }> {
  const supabase = await createClient();

  // Aggregated in Postgres. This used to select every completed and
  // stopped dispatch and reduce them here, which PostgREST silently
  // truncates at 1000 rows — so past a thousand runs the ratings would
  // have quietly become "the oldest thousand" while still looking like
  // a current score. See migration 031.
  const { data, error } = await supabase.rpc("driver_ratings");
  if (error) return { data: [], error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    data: rows.map((r) => ({
      name: String(r.name ?? "—"),
      totalRuns: Number(r.total_runs ?? 0),
      deviations: Number(r.deviations ?? 0),
      speedingCount: Number(r.speeding_count ?? 0),
      cleanRuns: Number(r.clean_runs ?? 0),
      score: Number(r.score ?? 100),
    })),
    error: null,
  };
}

// ── Notifications ──

export interface NotificationRecord {
  id: string;
  dispatch_id: string | null;
  truck_id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

export async function getNotifications(): Promise<{ data: NotificationRecord[]; error: string | null }> {
  const supabase = await createClient();

  const since = new Date(Date.now() - NOTIFICATION_FEED_HOURS * 3600_000).toISOString();

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

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

  // One statement, admin branch included. The previous version fetched
  // the caller's dispatch ids and passed them to .in(), and that id list
  // is capped at 1000 — past a thousand dispatches the oldest
  // notifications could never be marked read, while the button carried
  // on reporting success. See migration 031.
  const { error } = await supabase.rpc("mark_my_notifications_read");
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
