"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  listSites,
  listTrucks,
  listActiveDispatches,
  createBatchDispatch,
  stopDispatch,
} from "@/lib/supabase/actions";
import { checkPositionForDispatch } from "@/lib/supabase/positions";
import { createClient } from "@/lib/supabase/client";
import type { SiteRecord, TruckRecord, DispatchRecord } from "@/lib/supabase/actions";
import type { PositionCheckResult } from "@/lib/supabase/positions";
import { useTranslation } from "@/lib/i18n/I18nProvider";

export default function DispatchPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [selectedTrucks, setSelectedTrucks] = useState<string[]>([]);
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

  function toggleTruck(truckId: string) {
    setSelectedTrucks((prev) =>
      prev.includes(truckId) ? prev.filter((id) => id !== truckId) : [...prev, truckId]
    );
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setLoading(true);
    if (selectedTrucks.length === 0 || !selectedSite) { setError("Select at least one truck and a destination"); setLoading(false); return; }
    const result = await createBatchDispatch(selectedTrucks, selectedSite);
    if (result.error) { setError(result.error); setLoading(false); return; }
    const siteName = result.data?.[0]?.site?.name ?? "site";
    setSuccess(`Dispatched ${selectedTrucks.length} truck${selectedTrucks.length > 1 ? "s" : ""} → ${siteName}`);
    setSelectedTrucks([]); setSelectedSite("");
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
        <h1 className="text-2xl font-semibold text-white">{t("dispatch.title")}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("dispatch.subtitle")}
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
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium" style={{ color: "var(--text-dim)" }}>
                Trucks {selectedTrucks.length > 0 ? `(${selectedTrucks.length} selected)` : ""}
              </label>
              {selectedTrucks.length > 0 && (
                <button type="button" onClick={() => setSelectedTrucks([])} className="text-xs" style={{ color: "var(--indigo)" }}>
                  Clear
                </button>
              )}
            </div>
            <div className="mt-1 max-h-56 overflow-y-auto rounded-md p-2" style={{ border: "1px solid var(--line)", background: "var(--panel-2)" }}>
              {trucks.length === 0 ? (
                <p className="text-xs p-2" style={{ color: "var(--text-dim)" }}>No active trucks.</p>
              ) : (
                trucks.map((t) => (
                  <label key={t.truck_id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer hover:bg-black/20">
                    <input
                      type="checkbox"
                      checked={selectedTrucks.includes(t.truck_id)}
                      onChange={() => toggleTruck(t.truck_id)}
                    />
                    <span className="truck-id">{t.truck_id}</span>
                  </label>
                ))
              )}
            </div>
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
          {loading ? "Creating..." : selectedTrucks.length > 1 ? `Start Tracking Run (${selectedTrucks.length} trucks)` : "Start Tracking Run"}
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
              const siteName = d.site?.name ?? "Unknown";
              const dispName = d.dispatcher?.full_name ?? "Unknown";

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
