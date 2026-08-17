"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getFleetData, FleetData, FleetTruck } from "@/lib/wialon/config";
import { listActiveDispatches, listSites } from "@/lib/supabase/actions";
import type { DispatchRecord, SiteRecord } from "@/lib/supabase/actions";
import { listGeofences } from "@/lib/supabase/geofences";
import type { GeofenceRecord } from "@/lib/supabase/geofences";
import { listGasStations } from "@/lib/supabase/stations";
import type { GasStation } from "@/lib/supabase/stations";
import { getNotifications } from "@/lib/supabase/history";
import type { NotificationRecord } from "@/lib/supabase/history";
import { checkPositionAuto, checkHqArrivals } from "@/lib/supabase/positions";
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
  // directly in the render body, which returns a new client (and
  // therefore a new identity) on every render. That instability was
  // the actual bug: pollOnce, and both realtime channel effects below,
  // all depend on `supabase`, so a fresh identity on every render tore
  // them down and immediately re-fired them — including re-running the
  // full Wialon poll right away instead of on its 60s schedule. Since
  // pollOnce's own writes trigger the realtime channels that cause a
  // re-render, this was a feedback loop: poll -> DB write -> realtime
  // event -> re-render -> new client -> effects reset -> poll again,
  // compounding into near-continuous full re-fetches and freezing the
  // tab (this provider wraps every page, so it wasn't page-specific).
  const [supabase] = useState(() => createClient());

  // pollOnce reads these via ref rather than closing over the state
  // directly, so checking positions each poll doesn't require
  // recreating (and re-scheduling) pollOnce every time a dispatch or
  // geofence changes.
  const dispatchesRef = useRef<DispatchRecord[]>([]);
  const geofencesRef = useRef<GeofenceRecord[]>([]);
  useEffect(() => { dispatchesRef.current = dispatches; }, [dispatches]);
  useEffect(() => { geofencesRef.current = geofences; }, [geofences]);

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

  // Guards against overlapping poll cycles — if a cycle's own
  // notification checks (below) are still draining when the next 60s
  // tick fires, starting another full cycle on top would pile up
  // concurrent request generations with nothing to cap them. A plain
  // ref (not isPolling state) since pollOnce's identity is now stable
  // and won't pick up a fresh closure over state.
  const pollingRef = useRef(false);

  const pollOnce = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      setIsPolling(true);
      // No truck-ID list to pass — the whole Wialon account is this
      // company's fleet, so every unit it returns is a truck.
      const data = await getFleetData();
      setFleetData(data);

      // Persist snapshot to Supabase. The error is checked rather than
      // discarded: this insert failed on every poll for months — the
      // fleet_snapshots table had never been created in the project, and
      // nothing surfaced it.
      const { error: snapshotError } = await supabase
        .from("fleet_snapshots")
        .insert({
          snapshot_data: data.trucks,
          truck_count: data.trucks.length,
          moving_count: data.trucks.filter((t: FleetTruck) => t.status === "moving").length,
          idle_count: data.trucks.filter((t: FleetTruck) => t.status === "idle").length,
          offline_count: data.trucks.filter((t: FleetTruck) => t.status === "offline").length,
          captured_at: new Date().toISOString(),
        });

      if (snapshotError) console.error("[FleetProvider] snapshot insert failed:", snapshotError);

      // The actual notification trigger — this is what previously only
      // ran when someone manually clicked "Check" on a single truck.
      // Reuses the positions (and geofences) this same poll already
      // has, so it's not an extra Wialon/Supabase round-trip per
      // dispatch. Awaited (allSettled, so one failing dispatch doesn't
      // stop the rest) rather than fire-and-forget, so this cycle's
      // work is fully done before pollingRef releases — that's what
      // actually enforces "one generation of checks at a time."
      const truckById = new Map(data.trucks.map((t) => [t.truck_id, t]));
      const checks: Promise<unknown>[] = [];
      for (const dispatch of dispatchesRef.current) {
        const truck = truckById.get(dispatch.truck_id);
        if (truck?.lat != null && truck.lng != null) {
          checks.push(
            checkPositionAuto(dispatch.id, truck.lat, truck.lng, truck.speed, truck.driverName, geofencesRef.current).catch(
              (err) => console.error("[FleetProvider] auto position check failed:", err)
            )
          );
        }
      }

      const hq = geofencesRef.current.find((g) => g.kind === "site" && g.siteId == null);
      if (hq?.centerLat != null && hq?.centerLng != null && hq?.radiusMeters != null) {
        checks.push(
          checkHqArrivals(data.trucks, { centerLat: hq.centerLat, centerLng: hq.centerLng, radiusMeters: hq.radiusMeters }).catch(
            (err) => console.error("[FleetProvider] HQ arrival check failed:", err)
          )
        );
      }

      await Promise.allSettled(checks);
    } catch (err) {
      console.error("Fleet poll failed:", err);
    } finally {
      setIsPolling(false);
      pollingRef.current = false;
    }
  }, [supabase]);

  // Polling follows tab visibility. A hidden tab has nobody reading the
  // map, but its cycle still costs a Wialon fetch, a snapshot write, a
  // position check per active dispatch and an HQ sweep — and every tab
  // the operator left open was paying that independently, all writing to
  // the same rows. Hidden tabs now stop entirely and poll immediately on
  // return, so coming back doesn't mean waiting up to 60s for fresh data.
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
    listGasStations().then(({ data }) => setGasStations(data));
    listSites().then(({ data }) => { if (data) setSites(data); });

    const refInterval = setInterval(() => {
      listGasStations().then(({ data }) => setGasStations(data));
      listSites().then(({ data }) => { if (data) setSites(data); });
    }, 5 * 60_000);
    return () => clearInterval(refInterval);
  }, [loadDispatches, loadGeofences, loadNotifications]);

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
        refreshDispatches: loadDispatches,
        refreshNotifications: loadNotifications,
      }}
    >
      {children}
    </FleetContext.Provider>
  );
}
