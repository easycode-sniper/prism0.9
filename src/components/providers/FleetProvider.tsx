"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getFleetData, FleetData, FleetTruck } from "@/lib/wialon/config";
import { createClient } from "@/lib/supabase/client";

interface FleetContextType {
  fleetData: FleetData;
  refresh: () => Promise<void>;
  isPolling: boolean;
}

const FleetContext = createContext<FleetContextType>({
  fleetData: { trucks: [], lastUpdated: null, error: null },
  refresh: async () => {},
  isPolling: false,
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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const supabase = createClient();

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

  return (
    <FleetContext.Provider value={{ fleetData, refresh: pollOnce, isPolling }}>
      {children}
    </FleetContext.Provider>
  );
}
