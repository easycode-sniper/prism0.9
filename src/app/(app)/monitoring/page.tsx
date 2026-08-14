"use client";

import { useState, useEffect, useCallback } from "react";
import { getMonitoringData } from "@/lib/supabase/monitoring";
import type { MonitoringTruck, MonitoringData } from "@/lib/supabase/monitoring";
import { MapView } from "@/components/map/MapView";

type FilterType = "all" | "dispatched" | "moving" | "idle" | "offline";

export default function MonitoringPage() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);
  const [selectedTruck, setSelectedTruck] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await getMonitoringData();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-gray-500">Loading fleet data...</div>
      </div>
    );
  }

  const trucks = data?.trucks ?? [];

  const filteredTrucks = trucks.filter((t) => {
    // Search
    if (search) {
      const s = search.toLowerCase();
      const matchTruck = t.truck_id.toLowerCase().includes(s);
      const matchSite = t.site_name?.toLowerCase().includes(s) ?? false;
      const matchClient = t.client?.toLowerCase().includes(s) ?? false;
      if (!matchTruck && !matchSite && !matchClient) return false;
    }

    // Filter
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
      {/* Header */}
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
              {(["all", "dispatched", "moving", "idle", "offline"] as const).map(
                (f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded px-2 py-1 text-xs transition ${
                      filter === f
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {f}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Map */}
        <div className="w-1/2 border-r border-gray-800">
          <MapView markers={mapMarkers} />
        </div>

        {/* Table */}
        <div className="w-1/2 overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-800 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-2">Truck</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Speed</th>
                <th className="px-4 py-2">Destination</th>
                <th className="px-4 py-2">Route</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {filteredTrucks.map((t) => (
                <tr
                  key={t.truck_id}
                  onClick={() => setSelectedTruck(t.truck_id)}
                  className={`cursor-pointer text-sm transition hover:bg-gray-800/50 ${
                    selectedTruck === t.truck_id ? "bg-gray-800/50" : ""
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-cyan-400">
                    {t.truck_id}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2 text-gray-300">
                    {t.lat != null ? `${t.speed} km/h` : "—"}
                  </td>
                  <td className="px-4 py-2 text-gray-400">
                    {t.site_name ? (
                      <span className="text-white">{t.site_name}</span>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {t.dispatched ? (
                      t.last_on_route === false ? (
                        <span className="text-red-400">⚠ Off</span>
                      ) : t.last_on_route === true ? (
                        <span className="text-green-400">✓ On</span>
                      ) : (
                        <span className="text-amber-400">Pending</span>
                      )
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTrucks.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              No trucks match the current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: MonitoringTruck["status"] }) {
  const styles = {
    moving: "bg-green-900/50 text-green-400",
    idle: "bg-cyan-900/50 text-cyan-400",
    offline: "bg-gray-800 text-gray-500",
  };

  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
