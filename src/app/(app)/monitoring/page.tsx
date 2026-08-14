"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { getMonitoringData } from "@/lib/supabase/monitoring";
import { checkPositionForDispatch } from "@/lib/supabase/positions";
import type { MonitoringTruck, MonitoringData } from "@/lib/supabase/monitoring";
import type { PositionCheckResult } from "@/lib/supabase/positions";

// Leaflet touches `window` at import time, so it can't be part of the
// server-rendered bundle for this ("use client") page.
const MapView = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), { ssr: false });

type FilterType = "all" | "dispatched" | "moving" | "idle" | "offline";

export default function MonitoringPage() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);
  const [selectedTruck, setSelectedTruck] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Map<string, PositionCheckResult>>(new Map());
  const [checking, setChecking] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await getMonitoringData();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleCheckPosition(dispatchId: string, truckId: string) {
    setChecking(truckId);
    const result = await checkPositionForDispatch(truckId, dispatchId);
    if (result.result) {
      setCheckResults(prev => new Map(prev).set(dispatchId, result.result!));
    }
    setChecking(null);
    await loadData();
  }

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-500">Loading fleet data...</div>
      </div>
    );
  }

  const trucks = data?.trucks ?? [];

  const filteredTrucks = trucks.filter((t) => {
    if (search) {
      const s = search.toLowerCase();
      const matchTruck = t.truck_id.toLowerCase().includes(s);
      const matchSite = t.site_name?.toLowerCase().includes(s) ?? false;
      const matchClient = t.client?.toLowerCase().includes(s) ?? false;
      if (!matchTruck && !matchSite && !matchClient) return false;
    }
    if (filter === "dispatched") return t.dispatched;
    if (filter === "moving") return t.status === "moving";
    if (filter === "idle") return t.status === "idle";
    if (filter === "offline") return t.status === "offline";
    return true;
  });

  const mapMarkers = filteredTrucks
    .filter((t) => t.lat != null && t.lng != null)
    .map((t) => ({
      lat: t.lat!,
      lng: t.lng!,
      label: t.truck_id,
      status: t.status,
      dispatched: t.dispatched,
      offRoute: t.last_on_route === false,
    }));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Monitoring</h1>
            <p className="text-xs text-gray-500">
              {data?.total ?? 0} trucks · {data?.moving ?? 0} moving ·{" "}
              {data?.idle ?? 0} idle · {data?.offline ?? 0} offline
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search truck, site, or client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex gap-1">
              {(["all", "dispatched", "moving", "idle", "offline"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`rounded px-2 py-1 text-xs transition ${filter === f ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-1/2 border-r border-gray-800">
          <MapView markers={mapMarkers} />
        </div>

        <div className="w-1/2 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-800 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Truck</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Speed</th>
                <th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Route</th>
                <th className="px-4 py-2">ETA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filteredTrucks.map((t) => {
                const check = t.dispatch_id ? checkResults.get(t.dispatch_id) : null;
                return (
                  <tr key={t.truck_id} onClick={() => setSelectedTruck(t.truck_id)}
                    className={`cursor-pointer text-sm transition hover:bg-gray-800/50 ${selectedTruck === t.truck_id ? "bg-gray-800/50" : ""}`}>
                    <td className="px-4 py-2 font-mono text-cyan-400">{t.truck_id}</td>
                    <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                    <td className="px-4 py-2 text-gray-300">{t.lat != null ? `${t.speed} km/h` : "—"}</td>
                    <td className="px-4 py-2 text-gray-400">
                      {t.site_name ? <span className="text-white">{t.site_name}</span> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      {t.dispatched ? (
                        t.last_on_route === false ? <span className="text-red-400" title={check ? `${(check.deviationMeters! / 1000).toFixed(1)}km off` : ""}>⚠ Off</span>
                        : t.last_on_route === true ? <span className="text-green-400">✓ On</span>
                        : <button onClick={(e) => { e.stopPropagation(); t.dispatch_id && handleCheckPosition(t.dispatch_id, t.truck_id); }}
                          disabled={checking === t.truck_id}
                          className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
                          {checking === t.truck_id ? "..." : "Check"}
                        </button>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400">
                      {check?.etaSeconds != null ? (
                        <span className={check.onRoute ? "text-green-400" : "text-amber-400"}>
                          {check.etaLabel}{check.etaBasis === "fallback-speed" ? "*" : ""}
                        </span>
                      ) : t.last_eta_seconds != null ? (
                        <span>{formatEta(t.last_eta_seconds)}</span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredTrucks.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">No trucks match the current filter.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: MonitoringTruck["status"] }) {
  const styles = { moving: "bg-green-900/50 text-green-400", idle: "bg-cyan-900/50 text-cyan-400", offline: "bg-gray-800 text-gray-500" };
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}

function formatEta(seconds: number): string {
  if (seconds < 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
