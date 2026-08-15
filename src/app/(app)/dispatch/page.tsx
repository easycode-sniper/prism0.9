"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  listSites,
  listTrucks,
  listActiveDispatches,
  createBatchDispatch,
  stopDispatch,
} from "@/lib/supabase/actions";
import { checkPositionForDispatch, checkPositionManual } from "@/lib/supabase/positions";
import { getMonitoringData } from "@/lib/supabase/monitoring";
import { listGeofences } from "@/lib/supabase/geofences";
import { createClient } from "@/lib/supabase/client";
import { FACTORY_NAME } from "@/lib/constants";
import type { SiteRecord, TruckRecord, DispatchRecord } from "@/lib/supabase/actions";
import type { PositionCheckResult } from "@/lib/supabase/positions";
import type { MonitoringTruck } from "@/lib/supabase/monitoring";
import type { GeofenceRecord } from "@/lib/supabase/geofences";
import { useTranslation } from "@/lib/i18n/I18nProvider";

// Leaflet touches `window` at import time, so it can't be part of the
// server-rendered bundle for this ("use client") page.
const MapView = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), { ssr: false });

export default function DispatchPage() {
  const { t } = useTranslation();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [fleetTrucks, setFleetTrucks] = useState<MonitoringTruck[]>([]);
  const [geofences, setGeofences] = useState<GeofenceRecord[]>([]);

  const [truckSearch, setTruckSearch] = useState("");
  const [selectedTrucks, setSelectedTrucks] = useState<string[]>([]);

  const [siteSearch, setSiteSearch] = useState("");
  const [selectedSite, setSelectedSite] = useState<SiteRecord | null>(null);
  const [siteResultsOpen, setSiteResultsOpen] = useState(false);

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

  const loadMapData = useCallback(async () => {
    const [monitoring, geofenceRes] = await Promise.all([getMonitoringData(), listGeofences()]);
    setFleetTrucks(monitoring.trucks);
    if (geofenceRes.data) setGeofences(geofenceRes.data);
  }, []);

  useEffect(() => {
    loadData();
    loadMapData();
  }, [loadData, loadMapData]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel("dispatches-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "dispatches" }, () => {
        loadData();
        loadMapData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData, loadMapData]);

  function toggleTruck(truckId: string) {
    setSelectedTrucks((prev) =>
      prev.includes(truckId) ? prev.filter((id) => id !== truckId) : [...prev, truckId]
    );
  }

  const filteredTrucks = useMemo(() => {
    const q = truckSearch.trim().toLowerCase();
    if (!q) return trucks;
    return trucks.filter((tr) => tr.truck_id.toLowerCase().includes(q));
  }, [trucks, truckSearch]);

  const siteSearchResults = useMemo(() => {
    const q = siteSearch.trim().toLowerCase();
    if (!q) return [];
    return sites
      .filter((s) => s.name.toLowerCase().includes(q) || (s.client && s.client.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [sites, siteSearch]);

  function selectSite(site: SiteRecord) {
    setSelectedSite(site);
    setSiteSearch(`${site.name}${site.client ? ` — ${site.client}` : ""}`);
    setSiteResultsOpen(false);
  }

  function clearSite() {
    setSelectedSite(null);
    setSiteSearch("");
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setLoading(true);
    if (selectedTrucks.length === 0 || !selectedSite) {
      setError("Select at least one truck and a destination");
      setLoading(false);
      return;
    }
    const result = await createBatchDispatch(selectedTrucks, selectedSite.id);
    if (result.error) { setError(result.error); setLoading(false); return; }
    const siteName = result.data?.[0]?.site?.name ?? selectedSite.name;
    setSuccess(`Dispatched ${selectedTrucks.length} truck${selectedTrucks.length > 1 ? "s" : ""} → ${siteName}`);
    setSelectedTrucks([]); setTruckSearch(""); clearSite();
    setLoading(false);
    await loadData();
    await loadMapData();
  }

  async function handleStop(dispatchId: string) {
    const result = await stopDispatch(dispatchId);
    if (result.error) { setError(result.error); return; }
    await loadData();
    await loadMapData();
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
    await loadMapData();
  }

  async function handleManualCheck(dispatchId: string, lat: number, lng: number) {
    setChecking(dispatchId);
    setError(null);
    const result = await checkPositionManual(dispatchId, lat, lng);
    if (result.error) { setError(result.error); setChecking(null); return; }
    if (result.result) {
      setCheckResults(prev => new Map(prev).set(dispatchId, result.result!));
    }
    setChecking(null);
    await loadData();
    await loadMapData();
  }

  // Whole live fleet, not just currently-dispatched trucks — matches the
  // legacy app's Dispatch tab, which always shows every truck/driver on
  // the map regardless of dispatch status.
  const allTruckMarkers = useMemo(() => {
    return fleetTrucks
      .filter((tr) => tr.lat != null && tr.lng != null)
      .map((tr) => ({
        lat: tr.lat!,
        lng: tr.lng!,
        label: tr.truck_id,
        status: tr.status,
        course: tr.course,
        driverName: tr.driver_name,
        offRoute: tr.dispatched && tr.last_on_route === false,
      }));
  }, [fleetTrucks]);

  const siteMarkers = useMemo(
    () => sites.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng!, name: s.name, client: s.client })),
    [sites]
  );

  const mostRecentRoute = dispatches[0]?.route_geometry ?? null;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-96 flex-shrink-0 overflow-y-auto p-4 space-y-4" style={{ borderRight: "1px solid var(--line)" }}>
        <div>
          <h1 className="text-xl font-semibold text-white">{t("dispatch.title")}</h1>
          <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{t("dispatch.subtitle")}</p>
        </div>

        {error && <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--red)" }}>{error}</div>}
        {success && <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(21,156,131,0.08)", border: "1px solid rgba(21,156,131,0.18)", color: "#159c83" }}>{success}</div>}

        <form onSubmit={handleCreateDispatch} className="panel p-4 space-y-4">
          {/* Step 1 */}
          <div>
            <div className="section-label mb-2">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded text-xs" style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--indigo)" }}>1</span>
              Select Truck(s)
            </div>
            {selectedTrucks.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedTrucks.map((id) => (
                  <span key={id} className="truck-id inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs" style={{ background: "var(--panel-2)", border: "1px solid var(--indigo)" }}>
                    {id}
                    <button type="button" onClick={() => toggleTruck(id)} aria-label={`Remove ${id}`} style={{ color: "var(--text-dim)" }}>×</button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={truckSearch}
              onChange={(e) => setTruckSearch(e.target.value)}
              placeholder="Type truck ID to filter..."
              className="search-input w-full mb-2"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", padding: "6px 10px", color: "var(--text)", fontSize: ".82rem" }}
            />
            <div className="max-h-40 overflow-y-auto rounded-md p-1" style={{ border: "1px solid var(--line)", background: "var(--panel-2)" }}>
              {filteredTrucks.length === 0 ? (
                <p className="text-xs p-2" style={{ color: "var(--text-dim)" }}>No matching trucks.</p>
              ) : (
                filteredTrucks.map((tr) => (
                  <label key={tr.truck_id} className="flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer hover:bg-black/20">
                    <input type="checkbox" checked={selectedTrucks.includes(tr.truck_id)} onChange={() => toggleTruck(tr.truck_id)} />
                    <span className="truck-id">{tr.truck_id}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Step 2 */}
          <div>
            <div className="section-label mb-2">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded text-xs" style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--indigo)" }}>2</span>
              Route
            </div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Starting factory</label>
            <div className="rounded-md px-3 py-2 text-sm mb-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text-dim)" }}>
              🏭 {FACTORY_NAME}
            </div>

            <label className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Destination — client or site name</label>
            <div className="relative">
              <input
                type="text"
                value={siteSearch}
                onChange={(e) => { setSiteSearch(e.target.value); setSelectedSite(null); setSiteResultsOpen(true); }}
                onFocus={() => setSiteResultsOpen(true)}
                placeholder="Type client name or town..."
                className="search-input w-full"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", padding: "6px 10px", color: "var(--text)", fontSize: ".82rem" }}
              />
              {selectedSite && (
                <button type="button" onClick={clearSite} className="text-xs mt-1" style={{ color: "var(--indigo)" }}>Clear</button>
              )}
              {siteResultsOpen && !selectedSite && siteSearchResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full max-h-52 overflow-y-auto rounded-md" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
                  {siteSearchResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => selectSite(s)}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-black/20"
                    >
                      <span className="text-white">{s.name}</span>
                      {s.client && <span style={{ color: "var(--text-dim)" }}> — {s.client}</span>}
                      {s.lat == null && <span style={{ color: "var(--red)" }}> (no coords)</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Creating..." : selectedTrucks.length > 1 ? `▶ Start Tracking Run (${selectedTrucks.length} trucks)` : "▶ Start Tracking Run"}
          </button>
        </form>

        {/* Step 3 */}
        <div className="panel p-4">
          <div className="section-label mb-3">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded text-xs" style={{ background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--indigo)" }}>3</span>
            Verify Position ({dispatches.length} active)
          </div>

          {dispatches.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-dim)" }}>No active dispatches. Create one above.</p>
          ) : (
            <div className="space-y-3">
              {dispatches.map((d) => (
                <ActiveDispatchRow
                  key={d.id}
                  dispatch={d}
                  check={checkResults.get(d.id)}
                  checking={checking === d.truck_id || checking === d.id}
                  onCheckPosition={() => handleCheckPosition(d.id, d.truck_id)}
                  onManualCheck={(lat, lng) => handleManualCheck(d.id, lat, lng)}
                  onStop={() => handleStop(d.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-w-0">
        <MapView
          truckMarkers={allTruckMarkers}
          siteMarkers={siteMarkers}
          zones={geofences}
          routeLine={mostRecentRoute}
        />
      </div>
    </div>
  );
}

function ActiveDispatchRow({
  dispatch,
  check,
  checking,
  onCheckPosition,
  onManualCheck,
  onStop,
}: {
  dispatch: DispatchRecord;
  check: PositionCheckResult | undefined;
  checking: boolean;
  onCheckPosition: () => void;
  onManualCheck: (lat: number, lng: number) => void;
  onStop: () => void;
}) {
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const siteName = dispatch.site?.name ?? "Unknown";
  const dispName = dispatch.dispatcher?.full_name ?? "Unknown";

  function submitManual() {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) onManualCheck(lat, lng);
  }

  return (
    <div className="panel-2 p-3 rounded-md">
      <div className="flex items-center gap-2">
        <span className="truck-id text-sm">{dispatch.truck_id}</span>
        <span style={{ color: "var(--text-dim)" }}>→</span>
        <span className="text-sm text-white">{siteName}</span>
      </div>
      <div className="mt-1 flex gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
        <span>{new Date(dispatch.dispatched_at).toLocaleString()}</span>
        <span>By: {dispName}</span>
      </div>

      {check && (
        <div className="mt-2 flex gap-2 text-xs items-center flex-wrap">
          <span className={`status-pill ${check.onRoute ? "on-route" : check.onRoute === false ? "off-route" : "pending"}`}>
            {check.onRoute ? "On route" : check.onRoute === false ? `Off route (${(check.deviationMeters! / 1000).toFixed(1)}km)` : "Pending"}
          </span>
          {check.etaSeconds != null && (
            <span style={{ color: "var(--text-dim)" }}>ETA: {check.etaLabel}{check.etaBasis === "fallback-speed" ? " (est.)" : ""}</span>
          )}
          <span style={{ color: "var(--text-dim)" }}>{check.speed} km/h</span>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button onClick={onCheckPosition} disabled={checking} className="btn-sm" style={{ borderColor: "var(--indigo)", color: "var(--indigo)" }}>
          {checking ? "..." : "📡 Fetch Live Position"}
        </button>
        <button onClick={onStop} className="btn-sm danger">Stop</button>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs" style={{ color: "var(--text-dim)" }}>Paste coordinates manually instead</summary>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            placeholder="Latitude"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            className="w-24 text-xs"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "4px", padding: "4px 6px", color: "var(--text)" }}
          />
          <input
            type="text"
            placeholder="Longitude"
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
            className="w-24 text-xs"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "4px", padding: "4px 6px", color: "var(--text)" }}
          />
          <button type="button" onClick={submitManual} disabled={checking} className="btn-sm" style={{ borderColor: "var(--line)", color: "var(--text-dim)" }}>
            Check with pasted coordinates
          </button>
        </div>
      </details>
    </div>
  );
}
