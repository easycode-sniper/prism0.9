"use client";

import { useState, useEffect, useCallback } from "react";
import { getFleetLiveData } from "@/lib/supabase/fleet";
import type { FleetTruck } from "@/lib/wialon/config";

const POLL_INTERVAL_MS = 60_000;

export default function LiveFleetPage() {
  const [trucks, setTrucks] = useState<FleetTruck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<"all" | "moving" | "idle" | "offline">("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await getFleetLiveData();
    setTrucks(result.trucks);
    setError(result.error);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadData]);

  const filteredTrucks = trucks.filter((t) => {
    if (filter === "all") return true;
    return t.status === filter;
  });

  const counts = {
    moving: trucks.filter((t) => t.status === "moving").length,
    idle: trucks.filter((t) => t.status === "idle").length,
    offline: trucks.filter((t) => t.status === "offline").length,
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Live Fleet</h1>
          <p className="mt-1 text-sm text-gray-400">
            Real-time truck telemetry from Wialon.
            {lastUpdated && (
              <span className="ml-2">
                Last update: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-yellow-900/50 p-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      {/* Status counts */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{counts.moving}</div>
          <div className="text-xs text-gray-500">Moving</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-center">
          <div className="text-2xl font-bold text-cyan-400">{counts.idle}</div>
          <div className="text-xs text-gray-500">Idle</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-center">
          <div className="text-2xl font-bold text-gray-400">{counts.offline}</div>
          <div className="text-xs text-gray-500">Offline</div>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 flex gap-2">
        {(["all", "moving", "idle", "offline"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              filter === f
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Truck table */}
      <div className="mt-6 overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-900 text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">Truck</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Speed</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filteredTrucks.map((truck) => (
              <tr key={truck.truck_id} className="bg-gray-900/50 text-sm">
                <td className="px-4 py-3 font-mono text-cyan-400">
                  {truck.truck_id}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={truck.status} />
                </td>
                <td className="px-4 py-3 text-gray-300">
                  {truck.matched && truck.lat != null ? `${truck.speed} km/h` : "—"}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {truck.lat != null && truck.lng != null
                    ? `${truck.lat.toFixed(4)}, ${truck.lng.toFixed(4)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {truck.age_minutes != null
                    ? truck.age_minutes < 1
                      ? "just now"
                      : `${truck.age_minutes}m ago`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FleetTruck["status"] }) {
  const styles = {
    moving: "bg-green-900 text-green-400",
    idle: "bg-cyan-900 text-cyan-400",
    offline: "bg-gray-800 text-gray-500",
  };

  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
