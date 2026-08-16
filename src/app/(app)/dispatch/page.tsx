"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  listSites,
  listTrucks,
  listActiveDispatches,
  createBatchDispatch,
  stopDispatch,
} from "@/lib/supabase/actions";
import { checkPositionForDispatch, checkPositionManual } from "@/lib/supabase/positions";
import { listGeofences } from "@/lib/supabase/geofences";
import { listGasStations } from "@/lib/supabase/stations";
import { createClient } from "@/lib/supabase/client";
import { FACTORY_NAME } from "@/lib/constants";
import { haversineMeters } from "@/lib/geometry";
import { useFleet } from "@/components/providers/FleetProvider";
import { joinFleetWithDispatches } from "@/lib/fleetJoin";
import type { SiteRecord, TruckRecord, DispatchRecord } from "@/lib/supabase/actions";
import type { PositionCheckResult } from "@/lib/supabase/positions";
import type { GeofenceRecord } from "@/lib/supabase/geofences";
import type { GasStation } from "@/lib/supabase/stations";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { Radar } from "lucide-react";

// A truck within this distance of a station is treated as "at the pump".
const STATION_PROXIMITY_METERS = 150;

// Leaflet touches `window` at import time, so it can't be part of the
// server-rendered bundle for this ("use client") page.
const MapView = dynamic(() => import("@/components/map/MapView").then((m) => m.MapView), { ssr: false });

export default function DispatchPage() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const focusLat = searchParams.get("lat");
  const focusLng = searchParams.get("lng");
  const urlFocusPoint = useMemo<[number, number] | null>(
    () => (focusLat && focusLng ? [parseFloat(focusLat), parseFloat(focusLng)] : null),
    [focusLat, focusLng]
  );
  const [truckFocus, setTruckFocus] = useState<[number, number] | null>(null);
  const focusPoint = truckFocus ?? urlFocusPoint;
  const { fleetData } = useFleet();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [trucks, setTrucks] = useState<TruckRecord[]>([]);
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [geofences, setGeofences] = useState<GeofenceRecord[]>([]);
  const [gasStations, setGasStations] = useState<GasStation[]>([]);

  const [truckSearch, setTruckSearch] = useState("");
  const [selectedTrucks, setSelectedTrucks] = useState<string[]>([]);

  const [siteSearch, setSiteSearch] = useState("");
  const [selectedSite, setSelectedSite] = useState<SiteRecord | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [liveFleetOn, setLiveFleetOn] = useState(true);
  const [fleetFilter, setFleetFilter] = useState<"all" | "dispatched" | "idle" | "offline">("all");
  const [fleetSearch, setFleetSearch] = useState("");

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
    const [geofenceRes, stationsRes] = await Promise.all([
      listGeofences(),
      listGasStations(),
    ]);
    if (geofenceRes.data) setGeofences(geofenceRes.data);
    if (stationsRes.data) setGasStations(stationsRes.data);
  }, []);

  // Fleet positions come from the app-wide FleetProvider context
  // (already polling Wialon in the background), joined with the
  // dispatches already fetched above — not a second independent
  // Wialon fetch just for this page.
  const fleetTrucks = useMemo(
    () => joinFleetWithDispatches(fleetData.trucks, dispatches),
    [fleetData.trucks, dispatches]
  );

  useEffect(() => {
    loadData();
    loadMapData();
    const interval = setInterval(loadMapData, 60_000);
    return () => clearInterval(interval);
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

  // Live driver names come from the fleet feed (loadMapData), not the
  // truck registry (loadData) — the Step 1 checklist joins them by ID
  // so it's not just a wall of truck IDs.
  const driverByTruckId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const tr of fleetTrucks) map.set(tr.truck_id, tr.driver_name);
    return map;
  }, [fleetTrucks]);

  const filteredFleet = useMemo(() => {
    let list = fleetTrucks;
    if (fleetFilter === "dispatched") list = list.filter((tr) => tr.dispatched);
    else if (fleetFilter === "idle") list = list.filter((tr) => tr.status === "idle");
    else if (fleetFilter === "offline") list = list.filter((tr) => tr.status === "offline");

    const q = fleetSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (tr) => tr.truck_id.toLowerCase().includes(q) || (tr.driver_name && tr.driver_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [fleetTrucks, fleetFilter, fleetSearch]);

  const filteredTrucks = useMemo(() => {
    const q = truckSearch.trim().toLowerCase();
    if (!q) return trucks;
    return trucks.filter((tr) => tr.truck_id.toLowerCase().includes(q));
  }, [trucks, truckSearch]);

  // Full list by default (not search-triggered-only) — the destination
  // listbox should show every site immediately, narrowing as you type.
  const siteListOptions = useMemo(() => {
    const q = siteSearch.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) => s.name.toLowerCase().includes(q) || (s.client && s.client.toLowerCase().includes(q)));
  }, [sites, siteSearch]);

  function selectSite(site: SiteRecord) {
    setSelectedSite(site);
  }

  function clearSite() {
    setSelectedSite(null);
    setSiteSearch("");
  }

  async function handleCreateDispatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setLoading(true);

    if (selectedTrucks.length === 0) {
      setError("Select at least one truck");
      setLoading(false);
      return;
    }
    if (!selectedSite) {
      setError("Select a destination");
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
        speed: tr.speed,
        ageMinutes: tr.age_minutes,
        siteName: tr.dispatched ? tr.site_name : null,
        client: tr.dispatched ? tr.client : null,
        etaSeconds: tr.dispatched ? tr.last_eta_seconds : null,
      }));
  }, [fleetTrucks]);

  const siteMarkers = useMemo(
    () => sites.filter((s) => s.lat != null && s.lng != null).map((s) => ({ lat: s.lat!, lng: s.lng!, name: s.name, client: s.client })),
    [sites]
  );

  const stationMarkers = useMemo(
    () =>
      gasStations.map((s) => {
        const truckHere = allTruckMarkers.find(
          (tr) => haversineMeters(tr.lat, tr.lng, s.lat, s.lng) <= STATION_PROXIMITY_METERS
        );
        return { lat: s.lat, lng: s.lng, name: s.name, truckHere: truckHere?.label ?? null };
      }),
    [gasStations, allTruckMarkers]
  );

  const mostRecentRoute = dispatches[0]?.route_geometry ?? null;

  if (sidebarCollapsed) {
    return (
      <div className="flex h-full">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          title="Show dispatch panel"
          className="flex-shrink-0 flex items-start justify-center pt-4"
          style={{ width: "28px", borderRight: "1px solid var(--line)", background: "var(--panel)", color: "var(--text-dim)" }}
        >
          ▶
        </button>
        <div className="flex-1 min-w-0">
          <MapView
            truckMarkers={allTruckMarkers}
            siteMarkers={siteMarkers}
            stationMarkers={stationMarkers}
            zones={geofences}
            routeLine={mostRecentRoute}
            focusPoint={focusPoint}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-96 flex-shrink-0 overflow-y-auto p-4 space-y-4 relative" style={{ borderRight: "1px solid var(--line)" }}>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          title="Hide dispatch panel"
          className="absolute top-3 right-3 rounded-md flex items-center justify-center"
          style={{ width: "22px", height: "22px", background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--text-dim)", fontSize: ".7rem" }}
        >
          ◀
        </button>
        <div>
          <h1 className="text-xl font-semibold text-white">{t("dispatch.title")}</h1>
          <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>{t("dispatch.subtitle")}</p>
        </div>

        {error && <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--red)" }}>{error}</div>}
        {success && <div className="rounded-lg p-3 text-sm" style={{ background: "rgba(21,156,131,0.08)", border: "1px solid rgba(21,156,131,0.18)", color: "#159c83" }}>{success}</div>}

        <div className="panel p-3 space-y-2">
          <button
            type="button"
            onClick={() => setLiveFleetOn((v) => !v)}
            className="w-full py-2 rounded-md text-sm font-semibold"
            style={{
              background: liveFleetOn ? "rgba(21,156,131,0.12)" : "var(--panel-2)",
              border: `1px solid ${liveFleetOn ? "#159c83" : "var(--line)"}`,
              color: liveFleetOn ? "#4ade80" : "var(--text-dim)",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <Radar size={14} strokeWidth={2.25} />
              Live Fleet {liveFleetOn ? "ON" : "OFF"}
            </span>
          </button>

          {liveFleetOn && (
            <>
              <div className="flex gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
                {(["dispatched", "idle", "offline", "all"] as const).map((f) => (
                  <label key={f} className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" name="fleet-filter" checked={fleetFilter === f} onChange={() => setFleetFilter(f)} />
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </label>
                ))}
              </div>
              <input
                type="text"
                value={fleetSearch}
                onChange={(e) => setFleetSearch(e.target.value)}
                placeholder="Search driver or truck ID..."
                className="search-input w-full"
                style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", padding: "6px 10px", color: "var(--text)", fontSize: ".82rem" }}
              />
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filteredFleet.length === 0 ? (
                  <p className="text-xs p-2" style={{ color: "var(--text-dim)" }}>No matching trucks.</p>
                ) : (
                  filteredFleet.map((tr) => (
                    <button
                      type="button"
                      key={tr.truck_id}
                      title="Show on map"
                      disabled={tr.lat == null || tr.lng == null}
                      onClick={() => tr.lat != null && tr.lng != null && setTruckFocus([tr.lat, tr.lng])}
                      className="w-full flex items-center justify-between rounded-md p-2 text-left disabled:opacity-40"
                      style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}
                    >
                      <div>
                        <div className="text-sm text-white font-medium">{tr.driver_name || "—"}</div>
                        <div className="flex items-center gap-1 text-xs" style={{ color: "var(--text-dim)" }}>
                          <span style={{ color: tr.status === "moving" ? "#4ade80" : tr.status === "idle" ? "#22d3ee" : "var(--text-dim)" }}>●</span>
                          {tr.status} {tr.speed} km/h
                        </div>
                      </div>
                      <span className="truck-id text-xs">{tr.truck_id}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

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
                    <span style={{ color: "var(--text-dim)" }}>{driverByTruckId.get(tr.truck_id) || "—"}</span>
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
            <select
              disabled
              className="w-full mb-3"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", padding: "6px 10px", color: "var(--text)", fontSize: ".82rem" }}
            >
              <option>{FACTORY_NAME}</option>
            </select>

            <label className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Destination — client or site name</label>
            <input
              type="text"
              value={siteSearch}
              onChange={(e) => { setSiteSearch(e.target.value); setSelectedSite(null); }}
              placeholder="Type client name or town..."
              className="search-input w-full mb-2"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", padding: "6px 10px", color: "var(--text)", fontSize: ".82rem" }}
            />
            <select
              size={6}
              value={selectedSite?.id ?? ""}
              onChange={(e) => {
                const s = sites.find((site) => site.id === e.target.value);
                if (s) selectSite(s);
              }}
              className="w-full mb-2"
              style={{ background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", color: "var(--text)", fontSize: ".82rem" }}
            >
              <option value="" disabled>-- Select Destination Site --</option>
              {siteListOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.client ? ` — ${s.client}` : ""}{s.lat == null ? " (no coords)" : ""}
                </option>
              ))}
            </select>
            <div
              className="rounded-md px-3 py-2 text-xs mb-1"
              style={{
                background: selectedSite ? "rgba(21,156,131,0.08)" : "rgba(88,101,242,0.08)",
                border: `1px solid ${selectedSite ? "rgba(21,156,131,0.3)" : "rgba(88,101,242,0.25)"}`,
                color: selectedSite ? "#4ade80" : "var(--indigo)",
              }}
            >
              {selectedSite ? `Destination set: ${selectedSite.name}. Ready to dispatch.` : "Choose a destination to prepare the route."}
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
          stationMarkers={stationMarkers}
          zones={geofences}
          routeLine={mostRecentRoute}
          focusPoint={focusPoint}
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
        <button onClick={onCheckPosition} disabled={checking} className="btn-sm" style={{ borderColor: "var(--indigo)", color: "var(--indigo)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          {checking ? "..." : (<><Radar size={13} strokeWidth={2.25} /> Fetch Live Position</>)}
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
