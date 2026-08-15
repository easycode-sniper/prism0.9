"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getFleetData, FleetData, FleetTruck } from "@/lib/wialon/config";
import { createClient } from "@/lib/supabase/client";

interface FleetContextType {
  fleetData: FleetData;
  refresh: () => Promise<void>;
  isPolling: boolean;
  activeRuns: number;
  offRouteCount: number;
}

const FleetContext = createContext<FleetContextType>({
  fleetData: { trucks: [], lastUpdated: null, error: null },
  refresh: async () => {},
  isPolling: false,
  activeRuns: 0,
  offRouteCount: 0,
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
  const [activeRuns, setActiveRuns] = useState(0);
  const [offRouteCount, setOffRouteCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const supabase = createClient();

  const loadDispatchStats = useCallback(async () => {
    const [activeRes, offRouteRes] = await Promise.all([
      supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("dispatches").select("id", { count: "exact", head: true }).eq("status", "active").eq("is_off_route", true),
    ]);
    setActiveRuns(activeRes.count ?? 0);
    setOffRouteCount(offRouteRes.count ?? 0);
  }, [supabase]);

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

  useEffect(() => {
    loadDispatchStats();
    const channel = supabase
      .channel("fleet-provider-dispatch-stats")
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatches" }, () => loadDispatchStats())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadDispatchStats, supabase]);

  return (
    <FleetContext.Provider value={{ fleetData, refresh: pollOnce, isPolling, activeRuns, offRouteCount }}>
      {children}
    </FleetContext.Provider>
  );
}
