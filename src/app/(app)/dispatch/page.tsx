"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  listSites,
  listTrucks,
  listActiveDispatches,
  createDispatch,
  stopDispatch,
} from "@/lib/supabase/actions";
import { checkPositionForDispatch } from "@/lib/supabase/positions";
import { createClient } from "@/lib/supabase/client";
import type { SiteRecord, TruckRecord, DispatchRecord } from "@/lib/supabase/actions";
import type { PositionCheckResult } from "@/lib/supabase/positions";

export default function DispatchPage() {
  const router = useRouter();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [selectedTruck, setSelectedTruck] = useState("");
  const [selectedSite, setSelectedSite] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Map<string, PositionCheckResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [sitesRes, trucksRes, dispatchesRes] = await Promise.all([
      listSites(),
      listTrucks(),
      listActiveDispatches(),
    ]);

    if (sitesRes.data) setSites(sitesRes.data);
    if (trucksRes.data) setTrucks(trucksRes.data);
    if (dispatchesRes.data) setDispatches(dispatchesRes.data);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("dispatches-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatches" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setLoading(true);
    if (!selectedTruck || !selectedSite) { setError("Select both a truck and a destination"); setLoading(false); return; }
    const result = await createDispatch(selectedTruck, selectedSite);
    if (result.error) { setError(result.error); setLoading(false); return; }
    const siteName = Array.isArray(result.data?.site) ? result.data?.site[0]?.name : "site";
    setSuccess(`Dispatched ${selectedTruck} → ${siteName}`);
    setSelectedTruck(""); setSelectedSite("");
    setLoading(false); await loadData(); router.refresh();
  }

  async function handleStop(dispatchId: string) {
    const result = await stopDispatch(dispatchId);
    if (result.error) { setError(result.error); return; }
    await loadData(); router.refresh();
  }

  async function handleCheckPosition(dispatchId: string, truckId: string) {
    setChecking(truckId);
    setError(null);
    const result = await checkPositionForDispatch(truckId, dispatchId);
    if (result.error) { setError(result.error); setChecking(null); return; }
    if (result.result) {
      setCheckResults(prev => new Map(prev).set(dispatchId, result.result!));
    }
    setChecking(null);
    await loadData();
  }

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Dispatch</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
          Assign trucks to destinations and check route compliance.
        </p>
      </div>

      {/* Dispatch Form */}
      <form onSubmit={handleCreateDispatch} className="panel p-6">
        <div className="section-label mb-4">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded text-xs" style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--indigo)" }}>1</span>
          New Dispatch
        </div>

        {error && <div className="mb-4 rounded-lg p-3 text-sm" style={{ background: "var(--red-subtle, rgba(248,113,113,0.08))", border: "1px solid rgba(248,113,113,0.35)", color: "var(--red)" }}>{error}</div>}
        {success && <div className="mb-4 rounded-lg p-3 text-sm" style={{ background: "rgba(21,156,131,0.08)", border: "1px solid rgba(21,156,131,0.18)", color: "#159c83" }}>{success}</div>}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Truck</label>
            <select value={selectedTruck} onChange={(e) => setSelectedTruck(e.target.value)} className="mt-1">
              <option value="">-- Select Truck --</option>
              {trucks.map((t) => <option key={t.truck_id} value={t.truck_id}>{t.truck_id}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium" style={{ color: "var(--text-dim)" }}>Destination</label>
            <select value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)} className="mt-1">
              <option value="">-- Select Destination --</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.client ? ` — ${s.client}` : ""}{s.lat == null ? " (no coords)" : ""}</option>)}
            </select>
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn-primary mt-4">
          {loading ? "Creating..." : "Start Tracking Run"}
        </button>
      </form>

      {/* Active Dispatches */}
      <div>
        <div className="section-label mb-4">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded text-xs" style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--indigo)" }}>2</span>
          Active Dispatches ({dispatches.length})
        </div>

        {dispatches.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>No active dispatches. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {dispatches.map((d) => {
              const check = checkResults.get(d.id);
              const siteName = Array.isArray(d.site) ? d.site[0]?.name : "Unknown";
              const dispName = Array.isArray(d.dispatcher) ? d.dispatcher[0]?.full_name : "Unknown";

              return (
                <div key={d.id} className="panel-2 p-4 flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="truck-id text-sm">{d.truck_id}</span>
                      <span style={{ color: "var(--text-dim)" }}>→</span>
                      <span className="text-sm text-white">{siteName}</span>
                      {d.last_on_route === false && <span className="status-pill off-route ml-2">Off route</span>}
                    </div>
                    <div className="mt-1 flex gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
                      <span>Dispatched: {new Date(d.dispatched_at).toLocaleString()}</span>
                      <span>By: {dispName}</span>
                    </div>
                    {check && (
                      <div className="mt-2 flex gap-3 text-xs items-center">
                        <span className={`status-pill ${check.onRoute ? "on-route" : check.onRoute === false ? "off-route" : "pending"}`}>
                          {check.onRoute ? "On route" : check.onRoute === false ? `Off route (${(check.deviationMeters! / 1000).toFixed(1)}km)` : "Pending"}
                        </span>
                        {check.etaSeconds != null && (
                          <span style={{ color: "var(--text-dim)" }}>
                            ETA: {check.etaLabel}{check.etaBasis === "fallback-speed" ? " (est.)" : ""}
                          </span>
                        )}
                        <span style={{ color: "var(--text-dim)" }}>{check.speed} km/h</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => handleCheckPosition(d.id, d.truck_id)}
                      disabled={checking === d.truck_id}
                      className="btn-sm" style={{ borderColor: "var(--indigo)", color: "var(--indigo)" }}>
                      {checking === d.truck_id ? "..." : "Check Position"}
                    </button>
                    <button onClick={() => handleStop(d.id)}
                      className="btn-sm danger">
                      Stop
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
