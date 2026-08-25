"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { FleetData, FleetTruck } from "@/lib/wialon/config";
import { listActiveDispatches, listSites } from "@/lib/supabase/actions";
import type { DispatchRecord, SiteRecord } from "@/lib/supabase/actions";
import { listGeofences } from "@/lib/supabase/geofences";
import type { GeofenceRecord } from "@/lib/supabase/geofences";
import { listGasStations } from "@/lib/supabase/stations";
import type { GasStation } from "@/lib/supabase/stations";
import { getNotifications } from "@/lib/supabase/history";
import type { NotificationRecord } from "@/lib/supabase/history";
import { createClient } from "@/lib/supabase/client";

interface FleetContextType {
  fleetData: FleetData;
  refresh: () => Promise<void>;
  isPolling: boolean;
  activeRuns: number;
  offRouteCount: number;
  // Reference/live data shared app-wide so individual pages don't each
  // re-fetch (and each open their own realtime channel on) the same
  // tables every time they mount — see fleetJoin.ts and the commit
  // that introduced this for the full story.
  dispatches: DispatchRecord[];
  geofences: GeofenceRecord[];
  gasStations: GasStation[];
  sites: SiteRecord[];
  notifications: NotificationRecord[];
  refreshGeofences: () => Promise<void>;
  refreshGasStations: () => Promise<void>;
  refreshDispatches: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

const FleetContext = createContext<FleetContextType>({
  fleetData: { trucks: [], lastUpdated: null, error: null },
  refresh: async () => {},
  isPolling: false,
  activeRuns: 0,
  offRouteCount: 0,
  dispatches: [],
  geofences: [],
  gasStations: [],
  sites: [],
  notifications: [],
  refreshGeofences: async () => {},
  refreshGasStations: async () => {},
  refreshDispatches: async () => {},
  refreshNotifications: async () => {},
});

export function useFleet() {
  return useContext(FleetContext);
}

export function FleetProvider({ children }: { children: React.ReactNode }) {
  const [fleetData, setFleetData] = useState<FleetData>({
    trucks: [],
    lastUpdated: null,
    error: null,
  });
  const [isPolling, setIsPolling] = useState(false);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [geofences, setGeofences] = useState<GeofenceRecord[]>([]);
  const [gasStations, setGasStations] = useState<GasStation[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  // Stable for the component's lifetime — NOT `createClient()` called
  // directly in the render body, which returns a new client (and so a
  // new identity) on every render. Everything below depends on this
  // client, so an unstable identity tears down and re-fires every read
  // and every channel subscription on each re-render.
  const [supabase] = useState(() => createClient());

  const activeRuns = dispatches.length;
  const offRouteCount = dispatches.filter((d) => d.last_on_route === false).length;

  const loadDispatches = useCallback(async () => {
    const result = await listActiveDispatches();
    if (result.data) setDispatches(result.data);
  }, []);

  const loadGeofences = useCallback(async () => {
    // `if (result.data)` was always true — an error path returns an empty
    // array, which is truthy — so a failed load overwrote the geofences
    // with none and said nothing. Consumers cannot tell "no geofence is
    // defined" from "the request failed", and both read as every truck
    // being in transit.
    const result = await listGeofences();
    if (result.error) {
      console.error("[FleetProvider] geofences failed to load:", result.error);
      return;
    }
    setGeofences(result.data);
  }, []);

  const loadGasStations = useCallback(async () => {
    const result = await listGasStations();
    if (result.data) setGasStations(result.data);
  }, []);

  const loadNotifications = useCallback(async () => {
    const result = await getNotifications();
    if (result.data) setNotifications(result.data);
  }, []);

  // Realtime delivers one event per row, but a poll writes rows in
  // batches — one dispatch update per active run, one notification per
  // arriving truck. Refetching per event meant a batch of N rows cost N
  // server-action round trips and N re-renders of every consumer of this
  // context (including the Leaflet marker rebuild). Coalescing collapses
  // each burst into a single refetch once the burst settles.
  const refreshTimers = useRef<Record<string, NodeJS.Timeout | undefined>>({});
  const coalesce = useCallback((key: string, fn: () => void) => {
    clearTimeout(refreshTimers.current[key]);
    refreshTimers.current[key] = setTimeout(() => {
      delete refreshTimers.current[key];
      fn();
    }, 400);
  }, []);
  useEffect(() => {
    const timers = refreshTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  // Guards against overlapping reads, so a slow fetch can't have a
  // second one stacked on top of it.
  const pollingRef = useRef(false);

  // Reads the fleet from the newest fleet_snapshots row instead of
  // calling Wialon. The scheduled tick (app/api/tick, driven by pg_cron)
  // writes that row every minute, so the browser no longer logs into
  // Wialon at all — one poll happens for the whole company rather than
  // one per open tab, and it keeps happening when nobody has the app
  // open, which is the entire point of moving it server-side.
  const pollOnce = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      setIsPolling(true);
      const { data, error } = await supabase
        .from("fleet_snapshots")
        .select("snapshot_data, captured_at")
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setFleetData((prev) => ({ ...prev, error: error.message }));
        return;
      }
      if (!data) {
        setFleetData({
          trucks: [],
          lastUpdated: null,
          error: "No fleet snapshot yet — the monitoring job may not be running.",
        });
        return;
      }

      setFleetData({
        trucks: (data.snapshot_data ?? []) as FleetTruck[],
        lastUpdated: new Date(data.captured_at),
        error: null,
      });
    } catch (err) {
      console.error("Fleet read failed:", err);
    } finally {
      setIsPolling(false);
      pollingRef.current = false;
    }
  }, [supabase]);

  // Reads follow tab visibility: a hidden tab has nobody looking at the
  // map, and re-reads immediately on return rather than showing stale
  // data for up to a minute. This is only a safety net now — the
  // realtime subscription below is the primary path, and the interval
  // covers the case where the socket drops without reconnecting.
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const start = () => {
      if (!interval) interval = setInterval(pollOnce, 60_000);
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };

    const sync = () => {
      if (document.visibilityState === "visible") {
        pollOnce();
        start();
      } else {
        stop();
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      stop();
    };
  }, [pollOnce]);

  // Reference/list data — fetched once for the whole app, not once per
  // page. Sites change rarely enough that a 5-minute refresh is
  // plenty; geofences/notifications get their own realtime channels
  // below instead of polling. The truck roster no longer lives here —
  // fleetData.trucks (from Wialon, via pollOnce) is the fleet now.
  useEffect(() => {
    loadDispatches();
    loadGeofences();
    loadNotifications();
    loadGasStations();
    listSites().then(({ data }) => { if (data) setSites(data); });

    const refInterval = setInterval(() => {
      loadGasStations();
      listSites().then(({ data }) => { if (data) setSites(data); });
    }, 5 * 60_000);
    return () => clearInterval(refInterval);
  }, [loadDispatches, loadGeofences, loadNotifications, loadGasStations]);

  // The tick writes one snapshot row a minute; this turns that write
  // into a push, so the map updates without the browser asking.
  useEffect(() => {
    const channel = supabase
      .channel("fleet-provider-snapshots")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "fleet_snapshots" }, () =>
        coalesce("snapshots", pollOnce)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pollOnce, coalesce, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("fleet-provider-dispatches")
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatches" }, () =>
        coalesce("dispatches", loadDispatches)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadDispatches, coalesce, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("fleet-provider-notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () =>
        coalesce("notifications", loadNotifications)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadNotifications, coalesce, supabase]);

  return (
    <FleetContext.Provider
      value={{
        fleetData,
        refresh: pollOnce,
        isPolling,
        activeRuns,
        offRouteCount,
        dispatches,
        geofences,
        gasStations,
        sites,
        notifications,
        refreshGeofences: loadGeofences,
        refreshGasStations: loadGasStations,
        refreshDispatches: loadDispatches,
        refreshNotifications: loadNotifications,
      }}
    >
      {children}
    </FleetContext.Provider>
  );
}
