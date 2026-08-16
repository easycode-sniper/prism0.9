"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getFleetData, FleetData, FleetTruck } from "@/lib/wialon/config";
import { listActiveDispatches, listSites, listTrucks } from "@/lib/supabase/actions";
import type { DispatchRecord, SiteRecord, TruckRecord } from "@/lib/supabase/actions";
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
  trucks: TruckRecord[];
  notifications: NotificationRecord[];
  refreshGeofences: () => Promise<void>;
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
  trucks: [],
  notifications: [],
  refreshGeofences: async () => {},
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
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const supabase = createClient();

  const activeRuns = dispatches.length;
  const offRouteCount = dispatches.filter((d) => d.last_on_route === false).length;

  const loadDispatches = useCallback(async () => {
    const result = await listActiveDispatches();
    if (result.data) setDispatches(result.data);
  }, []);

  const loadGeofences = useCallback(async () => {
    const result = await listGeofences();
    if (result.data) setGeofences(result.data);
  }, []);

  const loadNotifications = useCallback(async () => {
    const result = await getNotifications();
    if (result.data) setNotifications(result.data);
  }, []);

  const getTruckIds = useCallback(async (): Promise<string[]> => {
    const { data } = await supabase
      .from("fleet_trucks")
      .select("truck_id")
      .eq("status", "active");
    return (data ?? []).map((t: any) => t.truck_id);
  }, [supabase]);

  const pollOnce = useCallback(async () => {
    try {
      setIsPolling(true);
      const truckIds = await getTruckIds();
      if (truckIds.length === 0) return;

      const data = await getFleetData(truckIds);
      setFleetData(data);

      // Persist snapshot to Supabase
      await supabase
        .from("fleet_snapshots")
        .insert({
          snapshot_data: data.trucks,
          truck_count: data.trucks.length,
          moving_count: data.trucks.filter((t: FleetTruck) => t.status === "moving").length,
          idle_count: data.trucks.filter((t: FleetTruck) => t.status === "idle").length,
          offline_count: data.trucks.filter((t: FleetTruck) => t.status === "offline").length,
          captured_at: new Date().toISOString(),
        });
    } catch (err) {
      console.error("Fleet poll failed:", err);
    } finally {
      setIsPolling(false);
    }
  }, [getTruckIds, supabase]);

  useEffect(() => {
    pollOnce();
    intervalRef.current = setInterval(pollOnce, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [pollOnce]);

  // Reference/list data — fetched once for the whole app, not once per
  // page. Sites and the truck registry change rarely enough that a
  // 5-minute refresh is plenty; geofences/notifications get their own
  // realtime channels below instead of polling.
  useEffect(() => {
    loadDispatches();
    loadGeofences();
    loadNotifications();
    listGasStations().then(({ data }) => setGasStations(data));
    listSites().then(({ data }) => { if (data) setSites(data); });
    listTrucks().then(({ data }) => { if (data) setTrucks(data); });

    const refInterval = setInterval(() => {
      listGasStations().then(({ data }) => setGasStations(data));
      listSites().then(({ data }) => { if (data) setSites(data); });
      listTrucks().then(({ data }) => { if (data) setTrucks(data); });
    }, 5 * 60_000);
    return () => clearInterval(refInterval);
  }, [loadDispatches, loadGeofences, loadNotifications]);

  useEffect(() => {
    const channel = supabase
      .channel("fleet-provider-dispatches")
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatches" }, () => loadDispatches())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadDispatches, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("fleet-provider-notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => loadNotifications())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadNotifications, supabase]);

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
        trucks,
        notifications,
        refreshGeofences: loadGeofences,
        refreshDispatches: loadDispatches,
        refreshNotifications: loadNotifications,
      }}
    >
      {children}
    </FleetContext.Provider>
  );
}
