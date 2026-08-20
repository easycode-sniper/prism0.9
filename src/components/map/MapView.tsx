"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Moon, Satellite as SatelliteIcon, MapPin, Tag, Fuel } from "lucide-react";
import { formatAge } from "@/lib/format";

// Leaflet markers/popups are raw HTML strings, not React — these are
// inline stroke-style SVGs (lucide's visual language: 24x24, stroke
// currentColor, round caps) for the icons baked into that HTML.
const SVG_ICONS = {
  fuel: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M4 22V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v18"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V7l-3-3"/></svg>`,
  factory: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20"/><path d="M4 20V10l6 4v-4l6 4V6l4 3v11"/><path d="M4 20V10"/></svg>`,
  parking: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 16V8h4a2.5 2.5 0 0 1 0 5H9"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>`,
  target: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.9 18a1.5 1.5 0 0 0 1.3 2.2h17.6a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  truck: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h13v13H1z"/><path d="M14 8h4l3 3v5h-7V8Z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/></svg>`,
};

export interface TruckMarkerData {
  lat: number;
  lng: number;
  label: string;
  status: "moving" | "idle" | "offline";
  course?: number | null;
  offRoute?: boolean;
  driverName?: string | null;
  speed?: number | null;
  ageMinutes?: number | null;
  siteName?: string | null;
  client?: string | null;
  etaSeconds?: number | null;
}

function formatEta(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export interface SiteMarkerData {
  lat: number;
  lng: number;
  name: string;
  client?: string | null;
}

export interface StationMarkerData {
  lat: number;
  lng: number;
  name: string;
  truckHere?: string | null;
}

export interface ZoneData {
  id: string;
  name: string;
  kind: "factory" | "site";
  siteId?: string | null;
  ring: [number, number][] | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
}

function ringCentroid(ring: [number, number][]): [number, number] {
  const [latSum, lngSum] = ring.reduce(([la, ln], [lat, lng]) => [la + lat, ln + lng], [0, 0]);
  return [latSum / ring.length, lngSum / ring.length];
}

interface MapViewProps {
  truckMarkers: TruckMarkerData[];
  siteMarkers?: SiteMarkerData[];
  stationMarkers?: StationMarkerData[];
  zones?: ZoneData[];
  routeLine?: [number, number][] | null;
  focusPoint?: [number, number] | null;
}

const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_LABELS_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

// Marker fill, painted over map tiles. Saturated on purpose — these have
// to hold up against both the dark and light basemaps, so they are not
// theme tokens and should not become them.
function statusColor(status: TruckMarkerData["status"], offRoute?: boolean): string {
  if (offRoute) return "#ff4d3d";
  if (status === "moving") return "#0ae448";
  if (status === "idle") return "#ff8709";
  return "#7c7c6f";
}

// The same status as popup text, which sits on --panel rather than on
// tiles. Reusing the marker fill here put "moving" at 3.4:1 on the light
// theme's white panel; the status tokens already carry a darker sibling
// for exactly this, so the popup reads off those instead.
function statusTextColor(status: TruckMarkerData["status"], offRoute?: boolean): string {
  if (offRoute) return "var(--red)";
  if (status === "moving") return "var(--green)";
  if (status === "idle") return "var(--amber)";
  return "var(--text-dim)";
}

// Directional arrow rotated to the truck's actual compass heading when
// known; a plain dot otherwise. Ported from the original single-file
// app's marker rendering.
//
// The name label is baked directly into the icon's own HTML rather than
// bound as a separate Leaflet tooltip. Permanent tooltips on markers
// inside a MarkerClusterGroup don't reliably get torn down by
// clearLayers() — they can leak/persist as orphaned DOM elements after
// the marker they belonged to is gone (e.g. once a dispatch stops).
// Baking the label into the marker's own icon means it's created and
// destroyed atomically with the marker — nothing separate to leak.
function buildTruckIcon(
  status: TruckMarkerData["status"],
  offRoute: boolean | undefined,
  course: number | null | undefined,
  labelText: string | null
): L.DivIcon {
  const color = statusColor(status, offRoute);
  const shape =
    course != null
      ? `<svg width="22" height="22" viewBox="0 0 24 24" style="transform:rotate(${course}deg); filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));"><path d="M12 1.5 L20 21 L12 16 L4 21 Z" fill="${color}" stroke="#0e100f" stroke-width="1.75" stroke-linejoin="round"/></svg>`
      : `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:${offRoute ? 3 : 1}px solid ${offRoute ? "#ff4d3d" : "rgba(255,252,225,.85)"};box-shadow:0 0 6px ${color};"></div>`;

  const label = labelText
    ? `<div style="position:absolute; bottom:26px; left:50%; transform:translateX(-50%); white-space:nowrap; background:#fff; color:#222; font-size:11px; font-weight:600; padding:2px 6px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,.5); pointer-events:none;">${labelText}</div>`
    : "";

  const html = `<div style="position:relative; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">${label}${shape}</div>`;
  return L.divIcon({ html, className: "", iconSize: [22, 22], iconAnchor: [11, 11] });
}

// The factory and home base are landmarks, not just another zone —
// always visible regardless of the Zones toggle or zoom level, with
// their own icon rather than a plain circle marker.
function buildLandmarkIcon(svg: string, color: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;">${svg}</div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function buildSiteIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:9px;height:9px;border-radius:50%;background:#fec5fb;border:1px solid rgba(255,252,225,.7);"></div>`,
    className: "",
    iconSize: [9, 9],
    iconAnchor: [4, 4],
  });
}

// Matches the legacy app's cluster-bubble classes: site clusters gold,
// truck clusters a violet gradient. Stations are new — given their own
// distinct color (red-orange) so all three layers stay tellable apart.
function buildClusterIcon(gradient: string) {
  return (cluster: L.MarkerCluster) =>
    L.divIcon({
      html: `<div style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:.85rem;color:#0e100f;border:2px solid rgba(255,252,225,.85);box-shadow:0 2px 8px rgba(0,0,0,.45);background:${gradient};">${cluster.getChildCount()}</div>`,
      className: "",
      iconSize: [34, 34],
    });
}

const SITE_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #fec5fb, #f79bf1)";
const TRUCK_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #fffce1, #95958a)";
const STATION_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #5fd8f0, #00bae2)";

function buildStationIcon(occupied: boolean): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${occupied ? "#ff8709" : "#42433d"};border:2px solid rgba(255,252,225,.8);display:flex;align-items:center;justify-content:center;color:#0e100f;">${SVG_ICONS.fuel}</div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// ── Persistent map singleton ──
// The Dispatch page (the only consumer of MapView) gets unmounted by
// Next.js every time you navigate away and remounted when you come
// back — that used to mean a brand new Leaflet map every visit: fresh
// tile fetches, rebuilt marker layers, and Dark/Zones/Names/Stations
// toggles reset to their defaults, even though nothing about the map
// actually needed to change. The map (and its container DOM node) now
// live in this module-level singleton instead of component state, so
// they survive unmount — MapView just re-parents the same persistent
// container into wherever it's rendered this time, instead of
// rebuilding it. Only one MapView is ever on screen at once, so a
// single singleton (not a pool) is enough.
interface MapCore {
  container: HTMLDivElement;
  map: L.Map;
  truckLayer: L.MarkerClusterGroup;
  siteLayer: L.MarkerClusterGroup;
  stationLayer: L.MarkerClusterGroup;
  zonesLayer: L.LayerGroup;
  landmarksLayer: L.LayerGroup;
  routeLayer: L.Polyline | null;
  tileLayers: { dark: L.TileLayer; light: L.TileLayer; satellite: L.TileLayer; satelliteLabels: L.TileLayer };
  ui: { baseLayer: "dark" | "satellite"; showZones: boolean; showNames: boolean; showStations: boolean };
}

let core: MapCore | null = null;
let hiddenHolder: HTMLDivElement | null = null;

function getHiddenHolder(): HTMLDivElement {
  if (!hiddenHolder) {
    hiddenHolder = document.createElement("div");
    hiddenHolder.style.display = "none";
    document.body.appendChild(hiddenHolder);
  }
  return hiddenHolder;
}

function getOrCreateMapCore(): MapCore {
  if (core) return core;

  const container = document.createElement("div");
  container.style.height = "100%";
  container.style.width = "100%";
  getHiddenHolder().appendChild(container);

  const map = L.map(container, { center: [35.25, 3.0], zoom: 7, zoomControl: true });

  const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 19,
  }).addTo(map);

  // CARTO's light sibling of the dark basemap — same cartography and
  // label placement, so switching theme changes the value of the map
  // rather than its shape.
  const light = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 19,
  });

  const satellite = L.tileLayer(SATELLITE_TILES, { attribution: "&copy; Esri", maxZoom: 19 });

  // No place names on raw satellite imagery on its own — this reference
  // layer adds them back when satellite mode is active.
  const satelliteLabels = L.tileLayer(SATELLITE_LABELS_TILES, { maxZoom: 19 });

  const truckLayer = L.markerClusterGroup({
    disableClusteringAtZoom: 11,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: buildClusterIcon(TRUCK_CLUSTER_GRADIENT),
  }).addTo(map);
  const siteLayer = L.markerClusterGroup({
    disableClusteringAtZoom: 11,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: buildClusterIcon(SITE_CLUSTER_GRADIENT),
  }).addTo(map);
  // Always attached, like the other marker-cluster layers — toggling a
  // populated MarkerClusterGroup on/off the map (rather than just
  // clearing its markers) crashes mid-animation on `_leaflet_pos`.
  const stationLayer = L.markerClusterGroup({
    disableClusteringAtZoom: 11,
    spiderfyOnMaxZoom: true,
    iconCreateFunction: buildClusterIcon(STATION_CLUSTER_GRADIENT),
  }).addTo(map);
  const zonesLayer = L.layerGroup().addTo(map);
  // Never gated behind the Zones toggle or clustering — these two are
  // landmarks the operator needs oriented against at any zoom level.
  const landmarksLayer = L.layerGroup().addTo(map);

  core = {
    container,
    map,
    truckLayer,
    siteLayer,
    stationLayer,
    zonesLayer,
    landmarksLayer,
    routeLayer: null,
    tileLayers: { dark, light, satellite, satelliteLabels },
    ui: { baseLayer: "dark", showZones: true, showNames: true, showStations: true },
  };
  return core;
}

export function MapView({ truckMarkers, siteMarkers = [], stationMarkers = [], zones = [], routeLine = null, focusPoint = null }: MapViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [baseLayer, setBaseLayer] = useState<"dark" | "satellite">(() => getOrCreateMapCore().ui.baseLayer);
  const [showZones, setShowZones] = useState(() => getOrCreateMapCore().ui.showZones);
  const [showNames, setShowNames] = useState(() => getOrCreateMapCore().ui.showNames);
  const [showStations, setShowStations] = useState(() => getOrCreateMapCore().ui.showStations);

  // Re-parent the persistent map container into this mount point; on
  // unmount, park it in the hidden holder instead of destroying it.
  useEffect(() => {
    const c = getOrCreateMapCore();
    if (wrapperRef.current) {
      wrapperRef.current.appendChild(c.container);
      c.map.invalidateSize();
    }
    return () => {
      getHiddenHolder().appendChild(c.container);
    };
  }, []);

  // Base layer switching (basemap vs satellite + labels overlay). The app
  // is dark-only now, so the basemap is always the dark one — the light
  // tile layer is kept built but unused rather than deleted, because it
  // costs nothing idle and is the whole of what a light mode would need.
  useEffect(() => {
    const { map, tileLayers } = getOrCreateMapCore();
    core!.ui.baseLayer = baseLayer;

    if (baseLayer === "dark") {
      map.removeLayer(tileLayers.satellite);
      map.removeLayer(tileLayers.satelliteLabels);
      map.removeLayer(tileLayers.light);
      if (!map.hasLayer(tileLayers.dark)) tileLayers.dark.addTo(map);
    } else {
      map.removeLayer(tileLayers.dark);
      map.removeLayer(tileLayers.light);
      if (!map.hasLayer(tileLayers.satellite)) tileLayers.satellite.addTo(map);
      if (!map.hasLayer(tileLayers.satelliteLabels)) tileLayers.satelliteLabels.addTo(map);
    }
  }, [baseLayer]);

  // Zones + site markers visibility
  useEffect(() => {
    const { map, siteLayer, zonesLayer } = getOrCreateMapCore();
    core!.ui.showZones = showZones;

    if (showZones) {
      if (!map.hasLayer(siteLayer)) siteLayer.addTo(map);
      if (!map.hasLayer(zonesLayer)) zonesLayer.addTo(map);
    } else {
      if (map.hasLayer(siteLayer)) map.removeLayer(siteLayer);
      if (map.hasLayer(zonesLayer)) map.removeLayer(zonesLayer);
    }
  }, [showZones]);

  // Truck markers — hidden entirely until Names is on, not just their
  // labels (Names is the master toggle for the truck layer).
  useEffect(() => {
    const { truckLayer } = getOrCreateMapCore();
    core!.ui.showNames = showNames;
    truckLayer.clearLayers();

    if (!showNames) return;

    for (const m of truckMarkers) {
      const labelText = m.driverName ? `${m.driverName} · ${m.label}` : m.label;
      const marker = L.marker([m.lat, m.lng], { icon: buildTruckIcon(m.status, m.offRoute, m.course, labelText) });

      const eta = formatEta(m.etaSeconds);
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: var(--text); min-width: 160px;">
          <strong style="font-size: 13px; color: var(--cyan);">${m.label}</strong>
          ${m.driverName ? `<div style="color: var(--text-dim); margin-top: 2px; display: flex; align-items: center; gap: 5px;">${SVG_ICONS.user} ${m.driverName}</div>` : ""}
          <div style="margin-top: 6px; display: flex; justify-content: space-between;">
            <span style="color: ${statusTextColor(m.status, m.offRoute)}; text-transform: capitalize; font-weight: 600;">● ${m.status}</span>
            ${m.speed != null ? `<span>${Math.round(m.speed)} km/h</span>` : ""}
          </div>
          ${m.offRoute ? `<div style="color: var(--red); margin-top: 4px; display: flex; align-items: center; gap: 5px;">${SVG_ICONS.alert} Off route</div>` : ""}
          ${m.siteName ? `<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); display: flex; align-items: center; gap: 5px;">${SVG_ICONS.target} <span>${m.siteName}${m.client ? ` — ${m.client}` : ""}${eta ? `<br>ETA ${eta}` : ""}</span></div>` : ""}
          ${m.ageMinutes != null ? `<div style="color: var(--text-dim); margin-top: 6px; font-size: 11px;">Updated ${formatAge(m.ageMinutes)}</div>` : ""}
        </div>`
      );

      truckLayer.addLayer(marker);
    }
  }, [truckMarkers, showNames]);

  // Site markers
  useEffect(() => {
    const { siteLayer } = getOrCreateMapCore();
    siteLayer.clearLayers();

    for (const s of siteMarkers) {
      const marker = L.marker([s.lat, s.lng], { icon: buildSiteIcon() });
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: var(--text);">
          <strong style="color: var(--pink);">${s.name}</strong>${s.client ? `<br>${s.client}` : ""}
        </div>`
      );
      siteLayer.addLayer(marker);
    }
  }, [siteMarkers]);

  // Gas station markers — layer stays on the map; toggling just clears
  // vs. repopulates its markers (see getOrCreateMapCore for why).
  useEffect(() => {
    const { stationLayer } = getOrCreateMapCore();
    core!.ui.showStations = showStations;
    stationLayer.clearLayers();

    if (!showStations) return;

    for (const s of stationMarkers) {
      const marker = L.marker([s.lat, s.lng], { icon: buildStationIcon(!!s.truckHere) });
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: var(--text);">
          <strong style="color: var(--cyan); display: inline-flex; align-items: center; gap: 5px;">${SVG_ICONS.fuel} ${s.name}</strong>${s.truckHere ? `<div style="margin-top: 4px; display: flex; align-items: center; gap: 5px;">${SVG_ICONS.truck} ${s.truckHere} fueling</div>` : ""}
        </div>`
      );
      stationLayer.addLayer(marker);
    }
  }, [stationMarkers, showStations]);

  // Zone polygons/circles
  useEffect(() => {
    const { zonesLayer } = getOrCreateMapCore();
    zonesLayer.clearLayers();

    for (const z of zones) {
      const color = z.kind === "factory" ? "#fec5fb" : "#00bae2";
      const shape = z.ring
        ? L.polygon(z.ring, { color, weight: 2, fillOpacity: 0.12 })
        : z.centerLat != null && z.centerLng != null && z.radiusMeters != null
          ? L.circle([z.centerLat, z.centerLng], { radius: z.radiusMeters, color, weight: 2, fillOpacity: 0.12 })
          : null;
      if (!shape) continue;
      shape.bindPopup(`<strong style="color:var(--cyan);">${z.name}</strong>`);
      zonesLayer.addLayer(shape);
    }
  }, [zones]);

  // Factory + home base landmark icons — the base is the 'site' zone
  // with no siteId (a real customer site always has one).
  useEffect(() => {
    const { landmarksLayer } = getOrCreateMapCore();
    landmarksLayer.clearLayers();

    for (const z of zones) {
      const isFactory = z.kind === "factory";
      const isBase = z.kind === "site" && z.siteId == null;
      if (!isFactory && !isBase) continue;

      const point: [number, number] | null =
        z.centerLat != null && z.centerLng != null
          ? [z.centerLat, z.centerLng]
          : z.ring
            ? ringCentroid(z.ring)
            : null;
      if (!point) continue;

      const marker = L.marker(point, {
        icon: buildLandmarkIcon(isFactory ? SVG_ICONS.factory : SVG_ICONS.parking, isFactory ? "#fec5fb" : "#00bae2"),
      });
      marker.bindPopup(`<strong style="color:var(--cyan);">${z.name}</strong>`);
      landmarksLayer.addLayer(marker);
    }
  }, [zones]);

  // Pan/zoom to a specific point on request (e.g. "Locate" from Monitoring)
  useEffect(() => {
    if (!focusPoint) return;
    getOrCreateMapCore().map.setView(focusPoint, 13);
  }, [focusPoint]);

  // Route polyline
  useEffect(() => {
    const c = getOrCreateMapCore();

    if (c.routeLayer) {
      c.map.removeLayer(c.routeLayer);
      c.routeLayer = null;
    }

    if (routeLine && routeLine.length >= 2) {
      c.routeLayer = L.polyline(routeLine, { color: "#00bae2", weight: 4, opacity: 0.85 }).addTo(c.map);
    }
  }, [routeLine]);

  function toggleBaseLayer(v: "dark" | "satellite") { setBaseLayer(v); }
  function toggleZones() { setShowZones((v) => !v); }
  function toggleNames() { setShowNames((v) => !v); }
  function toggleStations() { setShowStations((v) => !v); }

  return (
    <div className="relative h-full w-full">
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 1000,
          display: "flex",
          gap: "4px",
          background: "var(--panel-2)",
          border: "1px solid var(--line)",
          borderRadius: "8px",
          padding: "4px",
        }}
      >
        <ToggleButton active={baseLayer === "dark"} onClick={() => toggleBaseLayer("dark")} label="Dark" icon={Moon} />
        <ToggleButton active={baseLayer === "satellite"} onClick={() => toggleBaseLayer("satellite")} label="Satellite" icon={SatelliteIcon} />
        <span style={{ width: 1, background: "var(--line)", margin: "2px 2px" }} />
        <ToggleButton active={showZones} onClick={toggleZones} label="Zones" icon={MapPin} />
        <ToggleButton active={showNames} onClick={toggleNames} label="Names" icon={Tag} />
        <ToggleButton active={showStations} onClick={toggleStations} label="Stations" icon={Fuel} />
      </div>
      <div ref={wrapperRef} className="h-full w-full" />
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof Moon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--bg)" : "var(--text-dim)",
        border: "none",
        borderRadius: "5px",
        padding: "5px 9px",
        fontSize: ".72rem",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
      }}
    >
      <Icon size={13} strokeWidth={2.25} />
      {label}
    </button>
  );
}
