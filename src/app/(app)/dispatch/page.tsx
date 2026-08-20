"use client";

import { useState, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { createBatchDispatch, stopDispatch } from "@/lib/supabase/actions";
import { checkPositionForDispatch, checkPositionManual } from "@/lib/supabase/positions";
import { FACTORY_NAME } from "@/lib/constants";
import { haversineMeters } from "@/lib/geometry";
import { useFleet } from "@/components/providers/FleetProvider";
import { joinFleetWithDispatches } from "@/lib/fleetJoin";
import type { SiteRecord, DispatchRecord } from "@/lib/supabase/actions";
import type { PositionCheckResult } from "@/lib/supabase/positions";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { Radar, Check, AlertTriangle, ChevronLeft, ChevronRight, Crosshair, ArrowRight, MapPin, Square } from "lucide-react";
import { formatDateTime, formatAge } from "@/lib/format";

// A truck within this distance of a station is treated as "at the pump".
const STATION_PROXIMITY_METERS = 150;

// Shared by the live-fleet list and the truck picker so a truck reads
// the same colour in both — they used to carry their own copies.
function statusColor(status: string): string {
  if (status === "moving") return "var(--green)";
  if (status === "idle") return "var(--cyan)";
  return "var(--text-dim)";
}

/**
 * Route compliance for a run, as the app already knows it.
 *
 * pg_cron runs the position check every minute and writes the result back
 * onto the dispatch row, so `last_on_route`, `last_deviation_meters` and
 * `last_eta_seconds` are current without anyone pressing anything. The
 * panel used to ignore all three and show route status only after a manual
 * per-truck check, which meant the one question this app exists to answer
 * was sitting in the data and not on the screen.
 *
 * A manual check result, when present, is fresher than the last tick and
 * takes precedence.
 */
function runCompliance(d: DispatchRecord, manual?: PositionCheckResult) {
  if (manual) {
    return {
      onRoute: manual.onRoute,
      deviationMeters: manual.deviationMeters ?? null,
      etaLabel: manual.etaLabel ?? null,
      speed: manual.speed ?? null,
      checkedAt: new Date().toISOString(),
      manual: true,
    };
  }
  return {
    onRoute: d.last_on_route,
    deviationMeters: d.last_deviation_meters,
    etaLabel: d.last_eta_seconds != null ? formatEtaSeconds(d.last_eta_seconds) : null,
    speed: null as number | null,
    checkedAt: d.last_checked_at,
    manual: false,
  };
}

function formatEtaSeconds(total: number): string {
  const mins = Math.max(0, Math.round(total / 60));
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** The tick is a one-minute cycle, so nothing fresh should be older than
 *  a few of them. Past that the feed itself is the problem, not the truck. */
function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

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
  const { fleetData, dispatches, geofences, gasStations, sites, refreshDispatches } = useFleet();

  // One search and one filter now drive the single truck list. The panel
  // previously had two of each, over the same 101 trucks.
  // Watching runs is this app's primary job — creating one is what you do
  // to start it. So the panel opens on whichever is actually relevant:
  // the runs if any are on the road, the form if the yard is empty.
  const [panelMode, setPanelMode] = useState<"dispatch" | "active">("active");
  const [modePinned, setModePinned] = useState(false);
  const [truckSearch, setTruckSearch] = useState("");
  const [selectedTrucks, setSelectedTrucks] = useState<string[]>([]);

  const [siteSearch, setSiteSearch] = useState("");
  const [selectedSite, setSelectedSite] = useState<SiteRecord | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [fleetFilter, setFleetFilter] = useState<"all" | "dispatched" | "idle" | "offline">("all");

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Map<string, PositionCheckResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fleet positions come from the app-wide FleetProvider context
  // (already polling Wialon in the background), joined with the
  // dispatches that same context already fetches — not a second
  // independent Wialon fetch just for this page. Sites, trucks,
  // geofences, and gas stations are all shared from that same context
  // too, so this page does no data-fetching of its own on mount.
  const fleetTrucks = useMemo(
    () => joinFleetWithDispatches(fleetData.trucks, dispatches),
    [fleetData.trucks, dispatches]
  );

  // Off-route count drives the tab badge, so a truck leaving its route is
  // visible from the form without switching to look for it.
  const offRouteCount = useMemo(
    () => dispatches.filter((d) => d.last_on_route === false).length,
    [dispatches]
  );

  // Runs that need attention sort to the top; the rest keep dispatch order.
  const sortedDispatches = useMemo(
    () => [...dispatches].sort((a, b) => {
      const rank = (d: DispatchRecord) => (d.last_on_route === false ? 0 : d.last_on_route == null ? 1 : 2);
      return rank(a) - rank(b);
    }),
    [dispatches]
  );

  // Only auto-follow until the dispatcher picks a side themselves.
  useEffect(() => {
    if (modePinned) return;
    setPanelMode(dispatches.length > 0 ? "active" : "dispatch");
  }, [dispatches.length, modePinned]);

  function toggleTruck(truckId: string) {
    setSelectedTrucks((prev) =>
      prev.includes(truckId) ? prev.filter((id) => id !== truckId) : [...prev, truckId]
    );
  }

  // The browser list and the picker were the same feed filtered twice.
  // One list does both jobs: the row selects, the trailing button locates.
  const visibleTrucks = useMemo(() => {
    let list = fleetTrucks;
    if (fleetFilter === "dispatched") list = list.filter((tr) => tr.dispatched);
    else if (fleetFilter === "idle") list = list.filter((tr) => tr.status === "idle");
    else if (fleetFilter === "offline") list = list.filter((tr) => tr.status === "offline");

    const q = truckSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (tr) => tr.truck_id.toLowerCase().includes(q) || (tr.driver_name && tr.driver_name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [fleetTrucks, fleetFilter, truckSearch]);

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
    setPanelMode("active");
    setLoading(false);
    await refreshDispatches();
  }

  async function handleStop(dispatchId: string) {
    const result = await stopDispatch(dispatchId);
    if (result.error) { setError(result.error); return; }
    await refreshDispatches();
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
    await refreshDispatches();
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
    await refreshDispatches();
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
      <div className="dispatch-layout">
        <button
          type="button"
          onClick={() => setSidebarCollapsed(false)}
          title="Show dispatch panel"
          className="flex-shrink-0 flex items-start justify-center pt-4"
          aria-label="Show dispatch panel"
          style={{ width: "28px", borderRight: "1px solid var(--line)", background: "var(--panel)", color: "var(--text-dim)" }}
        >
          <ChevronRight size={14} strokeWidth={2.5} />
        </button>
        <div className="dispatch-layout__map">
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
    <div className="dispatch-layout">
      {/* Sidebar — one column, two modes, a fixed action bar. */}
      <form onSubmit={handleCreateDispatch} className="dispatch-panel">
        <header className="dispatch-panel__head">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold t-primary">{t("dispatch.title")}</h1>
              <p className="mt-0.5 text-xs" style={{ color: "var(--text-dim)" }}>{t("dispatch.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              title="Hide dispatch panel"
              aria-label="Hide dispatch panel"
              className="icon-btn"
            >
              <ChevronLeft size={14} strokeWidth={2.5} />
            </button>
          </div>

          {/* Creating a run and watching one are different jobs; the panel
              does one at a time instead of stacking both forever. */}
          <div className="seg seg--sm mt-3" style={{ display: "flex" }}>
            <button
              type="button"
              onClick={() => { setPanelMode("dispatch"); setModePinned(true); }}
              aria-pressed={panelMode === "dispatch"}
              className={`seg-item${panelMode === "dispatch" ? " is-active" : ""}`}
              style={{ flex: 1, justifyContent: "center" }}
            >
              New run
            </button>
            <button
              type="button"
              onClick={() => { setPanelMode("active"); setModePinned(true); }}
              aria-pressed={panelMode === "active"}
              className={`seg-item${panelMode === "active" ? " is-active" : ""}`}
              style={{ flex: 1, justifyContent: "center" }}
            >
              Active {dispatches.length > 0 && `(${dispatches.length})`}
              {offRouteCount > 0 && (
                <span
                  title={`${offRouteCount} off route`}
                  style={{
                    marginLeft: 2, width: 6, height: 6, borderRadius: "50%",
                    background: "var(--red)", flex: "none",
                  }}
                />
              )}
            </button>
          </div>
        </header>

        <div className="dispatch-panel__body">
          {error && (
            <div className="rounded-md p-2.5 text-xs" style={{ background: "rgba(255,77,61,0.08)", border: "1px solid rgba(255,77,61,0.35)", color: "var(--red)" }}>{error}</div>
          )}
          {success && (
            <div className="rounded-md p-2.5 text-xs" style={{ background: "rgba(10,228,72,0.08)", border: "1px solid rgba(10,228,72,0.22)", color: "var(--green)" }}>{success}</div>
          )}

          {panelMode === "dispatch" ? (
            <>
              <section className="psection psection--grow">
                <div className="psection__head">
                  <span className="psection__title">Trucks</span>
                  <span className={`psection__count${selectedTrucks.length ? " psection__count--on" : ""}`}>
                    {selectedTrucks.length ? `${selectedTrucks.length} selected` : `${visibleTrucks.length} shown`}
                  </span>
                </div>

                <div className="seg seg--sm mb-2" style={{ display: "flex" }}>
                  {(["all", "idle", "dispatched", "offline"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFleetFilter(f)}
                      aria-pressed={fleetFilter === f}
                      className={`seg-item${fleetFilter === f ? " is-active" : ""}`}
                      style={{ flex: 1, justifyContent: "center" }}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={truckSearch}
                  onChange={(e) => setTruckSearch(e.target.value)}
                  placeholder="Search driver or truck ID..."
                  className="field mb-2"
                />

                <div className="fleet-list">
                  {visibleTrucks.length === 0 ? (
                    <p className="panel-empty" style={{ border: "none" }}>No truck matches that filter.</p>
                  ) : (
                    visibleTrucks.map((tr) => {
                      const selected = selectedTrucks.includes(tr.truck_id);
                      const locatable = tr.lat != null && tr.lng != null;
                      return (
                        <div key={tr.truck_id} className={`fleet-row${selected ? " is-selected" : ""}`}>
                          <label className="fleet-row__pick">
                            <input
                              type="checkbox"
                              className="fleet-row__input"
                              checked={selected}
                              onChange={() => toggleTruck(tr.truck_id)}
                            />
                            <span className="fleet-row__box" aria-hidden="true">
                              <Check size={11} strokeWidth={3} />
                            </span>
                            <span className="fleet-row__body">
                              <span className={`fleet-row__name${tr.driver_name ? "" : " fleet-row__name--empty"}`}>
                                {tr.driver_name || "Unnamed driver"}
                              </span>
                              <span className="fleet-row__meta">
                                <span className="fleet-row__dot" style={{ background: statusColor(tr.status) }} />
                                {tr.status}
                                {tr.status === "moving" && tr.speed != null ? ` · ${Math.round(tr.speed)} km/h` : ""}
                                {tr.dispatched ? " · on run" : ""}
                              </span>
                            </span>
                            <span className="fleet-row__id">{tr.truck_id}</span>
                          </label>
                          <button
                            type="button"
                            className="fleet-row__locate"
                            disabled={!locatable}
                            title={locatable ? "Centre on map" : "No position"}
                            aria-label={`Centre ${tr.truck_id} on map`}
                            onClick={() => locatable && setTruckFocus([tr.lat!, tr.lng!])}
                          >
                            <Crosshair size={13} strokeWidth={2} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              <section className="psection psection--grow">
                <div className="psection__head">
                  {/* Every run leaves from the same factory, so the origin is
                      context on the label rather than a control that cannot
                      be changed. */}
                  <span className="psection__title">
                    Destination
                    <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--text-faint)" }}>
                      {" "}· from {FACTORY_NAME}
                    </span>
                  </span>
                  <span className={`psection__count${selectedSite ? " psection__count--on" : ""}`}>
                    {selectedSite ? "1 selected" : `${siteListOptions.length} sites`}
                  </span>
                </div>

                <input
                  type="text"
                  value={siteSearch}
                  onChange={(e) => { setSiteSearch(e.target.value); setSelectedSite(null); }}
                  placeholder="Search client or town..."
                  className="field mb-2"
                />

                <div className="site-picker">
                  <div className="site-picker__scroll" role="radiogroup" aria-label="Destination site">
                    {siteListOptions.length === 0 ? (
                      <p className="site-picker__empty">No site matches that search.</p>
                    ) : (
                      siteListOptions.map((site) => {
                        const isSelected = selectedSite?.id === site.id;
                        return (
                          <label key={site.id} className={`site-option${isSelected ? " is-selected" : ""}`}>
                            <input
                              type="radio"
                              name="destination-site"
                              className="site-option__input"
                              checked={isSelected}
                              onChange={() => selectSite(site)}
                            />
                            <span className="site-option__radio" aria-hidden />
                            <span className="site-option__body">
                              <span className="site-option__name" title={site.name}>{site.name}</span>
                              {site.client && (
                                <span className="site-option__client" title={site.client}>{site.client}</span>
                              )}
                              {site.lat == null && (
                                <span className="site-option__warn">
                                  <AlertTriangle size={10} strokeWidth={2.5} />
                                  No coordinates
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section>
              <div className="psection__head">
                <span className="psection__title">Active runs</span>
                <span className={`psection__count${offRouteCount ? "" : " psection__count--on"}`}
                      style={offRouteCount ? { color: "var(--red)" } : undefined}>
                  {offRouteCount ? `${offRouteCount} off route` : "all on route"}
                </span>
              </div>
              {dispatches.length === 0 ? (
                <p className="panel-empty">
                  Nothing on the road.<br />Start a run from the New run tab.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {sortedDispatches.map((d) => (
                    <ActiveRunCard
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
            </section>
          )}
        </div>

        {/* The one thing that never scrolls: what is about to happen,
            and the button that does it. */}
        {panelMode === "dispatch" && (
          <div className="dispatch-panel__action">
            <div className="dispatch-summary">
              <span className="dispatch-summary__part">
                <span className={`dispatch-summary__value${selectedTrucks.length ? " dispatch-summary__value--set" : ""}`}>
                  {selectedTrucks.length || "No"}
                </span>
                truck{selectedTrucks.length === 1 ? "" : "s"}
              </span>
              <ArrowRight size={12} strokeWidth={2} style={{ color: "var(--text-faint)", flex: "none" }} />
              <span className="dispatch-summary__part" style={{ minWidth: 0 }}>
                <span
                  className={`dispatch-summary__value${selectedSite ? " dispatch-summary__value--set" : ""}`}
                  title={selectedSite?.name}
                >
                  {selectedSite ? selectedSite.name : "No destination"}
                </span>
              </span>
            </div>
            <button
              type="submit"
              disabled={loading || selectedTrucks.length === 0 || !selectedSite}
              className="btn-brand w-full"
            >
              {loading
                ? "Dispatching…"
                : selectedTrucks.length === 0
                  ? "Select trucks to dispatch"
                  : !selectedSite
                    ? "Choose a destination"
                    : `Dispatch ${selectedTrucks.length} truck${selectedTrucks.length === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </form>

      {/* Map */}
      <div className="dispatch-layout__map">
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

function ActiveRunCard({
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
  // The manual-coordinate path is a fallback for when the telemetry feed
  // goes stale, not something a dispatcher reaches for on every run — so
  // it stays closed behind one icon instead of a <details> on every card.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const siteName = dispatch.site?.name ?? "Unknown destination";
  const c = runCompliance(dispatch, check);
  const staleMinutes = minutesSince(c.checkedAt);

  function submitManual() {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) onManualCheck(lat, lng);
  }

  return (
    <div className={`run-card${c.onRoute === false ? " run-card--alert" : ""}`}>
      <div className="run-card__top">
        <span className="fleet-row__id">{dispatch.truck_id}</span>
        <ArrowRight size={11} strokeWidth={2} className="run-card__arrow" />
        <span className="run-card__site" title={siteName}>{siteName}</span>
      </div>

      <div className="run-card__meta">
        <span
          className={`status-pill ${
            c.onRoute ? "on-route" : c.onRoute === false ? "off-route" : "pending"
          }`}
        >
          {c.onRoute
            ? "On route"
            : c.onRoute === false
              ? `Off route · ${((c.deviationMeters ?? 0) / 1000).toFixed(1)} km`
              : "Awaiting first check"}
        </span>
        {c.etaLabel && <span>ETA {c.etaLabel}</span>}
        {c.speed != null && <span>{c.speed} km/h</span>}
        {/* The tick runs every minute, so a check older than a few of them
            means the feed stopped, not that the truck is fine. */}
        {staleMinutes != null && staleMinutes > 3 ? (
          <span style={{ color: "var(--amber)" }}>
            Last check {formatAge(staleMinutes)}
          </span>
        ) : c.checkedAt ? (
          <span>Checked {formatAge(minutesSince(c.checkedAt))}</span>
        ) : (
          <span>Since {formatDateTime(dispatch.dispatched_at)}</span>
        )}
      </div>

      <div className="run-card__actions">
        <button type="button" onClick={onCheckPosition} disabled={checking} className="btn-sm">
          <Radar size={12} strokeWidth={2} />
          {checking ? "Checking…" : "Check position"}
        </button>
        <button type="button" onClick={onStop} className="btn-sm danger">
          <Square size={10} strokeWidth={3} />
          Stop
        </button>
        <button
          type="button"
          onClick={() => setManualOpen((v) => !v)}
          className="icon-btn"
          style={{ marginLeft: "auto" }}
          aria-expanded={manualOpen}
          title="Enter coordinates manually"
          aria-label="Enter coordinates manually"
        >
          <MapPin size={12} strokeWidth={2} />
        </button>
      </div>

      {manualOpen && (
        <div className="run-card__manual">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Latitude"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="Longitude"
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
          />
          <button type="button" onClick={submitManual} disabled={checking} className="btn-sm" style={{ flex: "none" }}>
            Check
          </button>
        </div>
      )}
    </div>
  );
}
