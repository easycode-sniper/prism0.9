"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  listSites,
  listTrucks,
  listActiveDispatches,
  createDispatch,
  stopDispatch,
} from "@/lib/supabase/actions";
import type { SiteRecord, TruckRecord, DispatchRecord } from "@/lib/supabase/actions";

export default function DispatchPage() {
  const router = useRouter();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [selectedTruck, setSelectedTruck] = useState("");
  const [selectedSite, setSelectedSite] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [sitesRes, trucksRes, dispatchesRes] = await Promise.all([
      listSites(),
      listTrucks(),
      listActiveDispatches(),
    ]);

    if (sitesRes.data) setSites(sitesRes.data);
    if (trucksRes.data) setTrucks(trucksRes.data);
    if (dispatchesRes.data) setDispatches(dispatchesRes.data);
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (!selectedTruck || !selectedSite) {
      setError("Select both a truck and a destination");
      setLoading(false);
      return;
    }

    const result = await createDispatch(selectedTruck, selectedSite);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setSuccess(`Dispatched ${selectedTruck} → ${Array.isArray(result.data?.site) ? result.data?.site[0]?.name : "site"}`);
    setSelectedTruck("");
    setSelectedSite("");
    setLoading(false);
    await loadData();
    router.refresh();
  }

  async function handleStop(dispatchId: string, truckId: string) {
    const result = await stopDispatch(dispatchId);
    if (result.error) {
      setError(result.error);
      return;
    }
    await loadData();
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold text-white">Dispatch</h1>
      <p className="mt-1 text-sm text-gray-400">
        Assign trucks to destinations. All changes are saved to the database and persist across sessions.
      </p>

      {/* Dispatch Form */}
      <form onSubmit={handleCreateDispatch} className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">New Dispatch</h2>

        {error && (
          <div className="mt-4 rounded-md bg-red-900/50 p-3 text-sm text-red-300">{error}</div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-900/50 p-3 text-sm text-green-300">{success}</div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="truck" className="block text-sm font-medium text-gray-300">
              Truck
            </label>
            <select
              id="truck"
              value={selectedTruck}
              onChange={(e) => setSelectedTruck(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">-- Select Truck --</option>
              {trucks.map((t) => (
                <option key={t.truck_id} value={t.truck_id}>
                  {t.truck_id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="site" className="block text-sm font-medium text-gray-300">
              Destination
            </label>
            <select
              id="site"
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">-- Select Destination --</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.client ? `— ${s.client}` : ""}
                  {s.lat == null ? " (no coords)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-4 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Dispatch"}
        </button>
      </form>

      {/* Active Dispatches */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-white">Active Dispatches</h2>

        {dispatches.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">
            No active dispatches. Create one above to get started.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {dispatches.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 p-4"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-cyan-400">{d.truck_id}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-sm text-white">
                      {Array.isArray(d.site) ? d.site[0]?.name : "Unknown"}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-gray-500">
                    <span>Dispatched: {new Date(d.dispatched_at).toLocaleString()}</span>
                    <span>By: {Array.isArray(d.dispatcher) ? d.dispatcher[0]?.full_name || "Unknown" : "Unknown"}</span>
                    {d.last_on_route === false && (
                      <span className="text-red-400">⚠ Off route</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleStop(d.id, d.truck_id)}
                  className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-900/30"
                >
                  Stop
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
