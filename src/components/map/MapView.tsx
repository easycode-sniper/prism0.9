"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Moon, Satellite as SatelliteIcon, MapPin, Tag, Fuel, ArrowRight, X } from "lucide-react";
import { formatAge } from "@/lib/format";
import { stationWatchRadius } from "@/lib/constants";

// Marker HTML is assembled as strings, so anything coming out of the
// database — site names, client names — has to be escaped on the way in.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

// Leaflet markers/popups are raw HTML strings, not React — these are
// inline stroke-style SVGs (lucide's visual language: 24x24, stroke
// currentColor, round caps) for the icons baked into that HTML.
const SVG_ICONS = {
  fuel: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M4 22V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v18"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V7l-3-3"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>`,
  target: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.9 18a1.5 1.5 0 0 0 1.3 2.2h17.6a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  // The two fixed landmarks get their own glyphs rather than sharing the
  // generic set: a cement plant with its silo and stack, and a depot with
  // a gated forecourt. Drawn on the same 24px grid, same 2.2 stroke.
  plant: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21h20"/><path d="M17 21V6a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v15"/><path d="M13 21v-7l-4.5 3V14L4 17v4"/><path d="M15 5V2.5"/><path d="M6.5 10.5c0-1.5 1.5-1.5 1.5-3"/></svg>`,
  depot: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M4 21V9.5L12 4l8 5.5V21"/><path d="M9 21v-6h6v6"/><path d="M9 11h6"/></svg>`,
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
  id: string;
  lat: number;
  lng: number;
  name: string;
  truckHere?: string | null;
  /** Forecourt radius. The circle is drawn at the WATCH radius, which is
   *  wider when the station is blacklisted — see stationWatchRadius. */
  radiusMeters: number;
  blacklisted: boolean;
  blacklistNote?: string | null;
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

/**
 * One run's planned road route, drawn on request.
 *
 * `id` is the dispatch id and is what the map keys its redraw and its
 * fit-to-bounds off: the dispatch list refreshes on every poll, so the
 * object identity changes constantly while the geometry does not, and
 * refitting on identity would yank the map out from under whoever is
 * panning it.
 */
export interface RouteOverlayData {
  id: string;
  truckId: string;
  line: [number, number][];
  startLabel: string;
  endLabel: string;
  distanceMeters: number | null;
  durationSeconds: number | null;
}

interface MapViewProps {
  truckMarkers: TruckMarkerData[];
  siteMarkers?: SiteMarkerData[];
  stationMarkers?: StationMarkerData[];
  zones?: ZoneData[];
  route?: RouteOverlayData | null;
  onRouteClear?: () => void;
  focusPoint?: [number, number] | null;
  /** Admins only. Absent for everyone else, which is what hides the
   *  button — the server action and the RLS policy both re-check. */
  onToggleStationBlacklist?: (stationId: string, next: boolean) => void;
}

const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_LABELS_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

/**
 * CARTO started requiring a key on its basemaps, and without one every
 * tile comes back stamped "API KEY REQUIRED" — which is what put that
 * watermark across the dispatch map.
 *
 * The key comes from the environment and is NOT committed. It has to be
 * NEXT_PUBLIC_, because Leaflet assembles these URLs in the browser, so
 * the key is readable from the network tab whatever we do — that is what
 * a basemap key is, and CARTO issues it on that understanding. The env
 * var is not hiding it from users; it is keeping it out of a PUBLIC git
 * repository, where a committed key gets scraped and its quota spent by
 * strangers, and it means rotating the key is a Vercel setting rather
 * than a commit.
 *
 * Missing key degrades rather than breaks: the URL is simply built
 * without the parameter, and the map still draws, watermarked. Only the
 * two CARTO layers need this — satellite is Esri and is unaffected.
 */
const CARTO_KEY = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY;

const cartoTiles = (style: "dark_all" | "light_all") =>
  `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png` +
  (CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : "");

// Marker fill, painted over map tiles. Saturated on purpose — these have
// to hold up against both the dark and light basemaps, so they are not
// theme tokens and should not become them.
function statusColor(status: TruckMarkerData["status"], offRoute?: boolean): string {
  if (offRoute) return "#ff2d3f";
  if (status === "moving") return "#00ff7b";
  if (status === "idle") return "#ffb300";
  return "#95958a";
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
      : `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:${offRoute ? 3 : 1}px solid ${offRoute ? "#ff2d3f" : "rgba(255,252,225,.85)"};box-shadow:0 0 6px ${color};"></div>`;

  const label = labelText
    ? `<div style="position:absolute; bottom:26px; left:50%; transform:translateX(-50%); white-space:nowrap; background:#fff; color:#222; font-size:11px; font-weight:600; padding:2px 6px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,.5); pointer-events:none;">${labelText}</div>`
    : "";

  const html = `<div style="position:relative; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">${label}${shape}</div>`;
  return L.divIcon({ html, className: "", iconSize: [22, 22], iconAnchor: [11, 11] });
}

// The factory and the yard are fixed infrastructure, not vehicles, so they
// get a shape nothing else on this map uses. Every other marker here is a
// circle — trucks, clusters, sites, stations — which is exactly why the old
// 30px circle for these read as just another cluster bubble.
//
// A squared badge on a stem reads as "a place" instead, the stem points at
// the real coordinate rather than the marker's middle, and the name rides
// underneath so a dispatcher never has to click to tell the plant from the
// yard. There are only two of these on the map, so a permanent label costs
// nothing in clutter.
function buildLandmarkIcon(svg: string, color: string, label: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center;">
      <div style="width:34px;height:34px;border-radius:10px;background:${color};box-shadow:0 0 0 2px rgba(14,16,15,.85), 0 3px 10px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;color:#0e100f;">${svg}</div>
      <div style="width:0;height:0;margin-top:-2px;border-left:5px solid transparent;border-right:5px solid transparent;border-top:7px solid ${color};filter:drop-shadow(0 1px 0 rgba(14,16,15,.85));"></div>
      <div style="margin-top:3px;padding:1px 7px;border-radius:100px;background:#0e100f;color:${color};font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;font-weight:700;letter-spacing:.06em;white-space:nowrap;box-shadow:0 0 0 1px rgba(66,67,61,.9);">${label}</div>
    </div>`,
    className: "",
    iconSize: [34, 60],
    // Anchored at the stem tip, not the badge centre, so the pin sits on
    // the coordinate the way a pin is supposed to.
    iconAnchor: [17, 41],
  });
}

// The two ends of a drawn route. Deliberately achromatic: every hue on
// this map already means something about a truck, and "where this run
// starts and finishes" is not a vehicle state. A hollow ring leaves, a
// filled one arrives, and the place name rides underneath so the answer
// to "from where to where" is on the map itself, not just in the panel.
function buildRouteEndIcon(label: string, role: "from" | "to"): L.DivIcon {
  const dot =
    role === "from"
      ? `<div style="width:12px;height:12px;border-radius:50%;background:#0e100f;border:2.5px solid #fffce1;"></div>`
      : `<div style="width:12px;height:12px;border-radius:50%;background:#fffce1;box-shadow:0 0 0 2px #0e100f, 0 0 0 4px rgba(255,252,225,.55);"></div>`;

  const text = label.length > 30 ? `${label.slice(0, 29)}…` : label;

  return L.divIcon({
    html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center;">
      ${dot}
      <div style="margin-top:5px;padding:1.5px 7px;border-radius:100px;background:#0e100f;color:#fffce1;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:9.5px;font-weight:700;letter-spacing:.05em;white-space:nowrap;box-shadow:0 0 0 1px rgba(66,67,61,.9);">${role === "from" ? "FROM" : "TO"} ${escapeHtml(text.toUpperCase())}</div>
    </div>`,
    className: "",
    iconSize: [12, 32],
    iconAnchor: [6, 6],
  });
}

function buildSiteIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:9px;height:9px;border-radius:50%;background:#ff2fd0;border:1px solid rgba(255,252,225,.7);"></div>`,
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

const SITE_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #ff2fd0, #e01ab4)";
const TRUCK_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #fffce1, #95958a)";
const STATION_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #6fe3ff, #00cfff)";

// An unoccupied station used to paint --line, the hairline colour, which
// made a lone pump on a dark basemap almost impossible to find — and it
// disagreed with its own cluster bubble, which has always been cyan.
// Stations are cyan now, the hue the taxonomy already gives them; amber
// stays as the exception that means a truck is at the pump right now.
function buildStationIcon(occupied: boolean, blacklisted = false): L.DivIcon {
  // Blacklisted wins over occupied: a truck sitting at a station that
  // takes money from drivers is precisely the case worth seeing in red.
  const fill = blacklisted ? "#ff2d3f" : occupied ? "#ffb300" : "#00cfff";
  return L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${fill};border:2px solid rgba(14,16,15,.9);box-shadow:0 0 0 1px rgba(255,252,225,.5);display:flex;align-items:center;justify-content:center;color:#0e100f;">${SVG_ICONS.fuel}</div>`,
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
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
  routeLayer: L.LayerGroup;
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

  const dark = L.tileLayer(cartoTiles("dark_all"), {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 19,
  }).addTo(map);

  // CARTO's light sibling of the dark basemap — same cartography and
  // label placement, so switching theme changes the value of the map
  // rather than its shape.
  const light = L.tileLayer(cartoTiles("light_all"), {
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
  // Above the cluster layers: a landmark disappearing behind a bubble of
  // trucks is the one thing that must never happen to it.
  const landmarksLayer = L.layerGroup().addTo(map);
  // The route sits under the landmarks and the trucks — it is the thing
  // they are measured against, not the thing being watched.
  const routeLayer = L.layerGroup().addTo(map);

  core = {
    container,
    map,
    truckLayer,
    siteLayer,
    stationLayer,
    zonesLayer,
    landmarksLayer,
    routeLayer,
    tileLayers: { dark, light, satellite, satelliteLabels },
    ui: { baseLayer: "dark", showZones: true, showNames: true, showStations: true },
  };
  return core;
}

export function MapView({ truckMarkers, siteMarkers = [], stationMarkers = [], zones = [], route = null, onRouteClear, focusPoint = null, onToggleStationBlacklist }: MapViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Both route effects key off the dispatch id, not the object, so a
  // poll that hands back an identical route doesn't redraw it or move
  // the viewport. The ref is how they still reach the current geometry.
  const routeRef = useRef(route);
  routeRef.current = route;
  const routeId = route?.id ?? null;

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

  const toggleBlacklistRef = useRef(onToggleStationBlacklist);
  toggleBlacklistRef.current = onToggleStationBlacklist;

  // Gas station markers — layer stays on the map; toggling just clears
  // vs. repopulates its markers (see getOrCreateMapCore for why).
  useEffect(() => {
    const { stationLayer } = getOrCreateMapCore();
    core!.ui.showStations = showStations;
    stationLayer.clearLayers();

    if (!showStations) return;

    for (const s of stationMarkers) {
      // The watch circle, at the radius the tick actually uses — wider
      // when blacklisted, so what is drawn is what is enforced rather
      // than a decorative ring that means something else.
      const watch = stationWatchRadius(s.radiusMeters, s.blacklisted);
      stationLayer.addLayer(
        L.circle([s.lat, s.lng], {
          radius: watch,
          color: s.blacklisted ? "#ff2d3f" : "#00cfff",
          weight: 1,
          fillOpacity: s.blacklisted ? 0.1 : 0.05,
          interactive: false,
        })
      );

      const marker = L.marker([s.lat, s.lng], {
        icon: buildStationIcon(!!s.truckHere, s.blacklisted),
      });

      const canToggle = !!toggleBlacklistRef.current;
      const label = s.blacklisted ? "Remove from blacklist" : "Blacklist this station";
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: var(--text); min-width: 190px;">
          <strong style="color: ${s.blacklisted ? "var(--red)" : "var(--cyan)"}; display: inline-flex; align-items: center; gap: 5px;">${SVG_ICONS.fuel} ${escapeHtml(s.name)}</strong>
          ${s.blacklisted ? `<div style="margin-top:4px;color:var(--red);font-size:11px;">Blacklisted · watched to ${watch}m</div>` : `<div style="margin-top:4px;color:var(--text-dim);font-size:11px;">Watched to ${watch}m</div>`}
          ${s.blacklisted && s.blacklistNote ? `<div style="margin-top:3px;color:var(--text-dim);font-size:11px;">${escapeHtml(s.blacklistNote)}</div>` : ""}
          ${s.truckHere ? `<div style="margin-top: 4px; display: flex; align-items: center; gap: 5px;">${SVG_ICONS.truck} ${escapeHtml(s.truckHere)} fueling</div>` : ""}
          ${canToggle ? `<button type="button" data-blacklist-id="${escapeHtml(s.id)}" data-blacklist-next="${s.blacklisted ? "0" : "1"}" style="margin-top:8px;width:100%;padding:5px 8px;font:inherit;font-size:11px;cursor:pointer;border-radius:6px;border:1px solid ${s.blacklisted ? "var(--line)" : "var(--red)"};background:transparent;color:${s.blacklisted ? "var(--text-dim)" : "var(--red)"};">${label}</button>` : ""}
        </div>`
      );

      // Leaflet popups are HTML strings, not React, so the button is
      // wired on open rather than with onClick. Bound per open and torn
      // down with the popup, so it cannot accumulate listeners.
      marker.on("popupopen", (e) => {
        const btn = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>(
          "button[data-blacklist-id]"
        );
        if (!btn) return;
        btn.onclick = () => {
          const id = btn.dataset.blacklistId;
          if (!id) return;
          btn.disabled = true;
          btn.textContent = "Saving…";
          toggleBlacklistRef.current?.(id, btn.dataset.blacklistNext === "1");
          marker.closePopup();
        };
      });

      stationLayer.addLayer(marker);
    }
  }, [stationMarkers, showStations]);

  // Zone polygons/circles
  useEffect(() => {
    const { zonesLayer } = getOrCreateMapCore();
    zonesLayer.clearLayers();

    for (const z of zones) {
      const color = z.kind === "factory" ? "#ff2fd0" : "#00cfff";
      const shape = z.ring
        ? L.polygon(z.ring, { color, weight: 2, fillOpacity: 0.12 })
        : z.centerLat != null && z.centerLng != null && z.radiusMeters != null
          ? L.circle([z.centerLat, z.centerLng], { radius: z.radiusMeters, color, weight: 2, fillOpacity: 0.12 })
          : null;
      if (!shape) continue;
      shape.bindPopup(
        `<strong style="color:${z.kind === "factory" ? "var(--pink)" : "var(--cyan)"};">${z.name}</strong>`
      );
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
        // Cluster bubbles are added after this layer as trucks stream in;
        // a z-offset keeps the landmark on top regardless of layer order.
        zIndexOffset: 1000,
        icon: buildLandmarkIcon(
          isFactory ? SVG_ICONS.plant : SVG_ICONS.depot,
          // Taxonomy holds: the factory is a destination (pink), the yard
          // is parking (cyan).
          isFactory ? "#ff2fd0" : "#00cfff",
          isFactory ? "USINE" : "PARC OMD",
        ),
      });
      marker.bindPopup(
        `<strong style="color:${isFactory ? "var(--pink)" : "var(--cyan)"};">${z.name}</strong>`
      );
      landmarksLayer.addLayer(marker);
    }
  }, [zones]);

  // Pan/zoom to a specific point on request (e.g. "Locate" from Monitoring)
  useEffect(() => {
    if (!focusPoint) return;
    getOrCreateMapCore().map.setView(focusPoint, 13);
  }, [focusPoint]);

  // The route line, its casing, and its two labelled ends.
  useEffect(() => {
    const { routeLayer } = getOrCreateMapCore();
    routeLayer.clearLayers();

    const r = routeRef.current;
    if (!r || r.line.length < 2) return;

    // A dark casing under the cyan line: over satellite imagery a 4px
    // stroke on its own disappears into pale ground.
    L.polyline(r.line, { color: "#0e100f", weight: 9, opacity: 0.45 }).addTo(routeLayer);
    L.polyline(r.line, { color: "#00cfff", weight: 4, opacity: 0.95 }).addTo(routeLayer);

    const start = r.line[0];
    const end = r.line[r.line.length - 1];
    L.marker(start, { icon: buildRouteEndIcon(r.startLabel, "from"), zIndexOffset: 900 }).addTo(routeLayer);
    L.marker(end, { icon: buildRouteEndIcon(r.endLabel, "to"), zIndexOffset: 900 }).addTo(routeLayer);
  }, [routeId]);

  // Frame the whole run when one is picked — the point of the button is
  // to see the route end to end, and the map is usually sitting on the
  // factory at zoom 7 when it's pressed.
  useEffect(() => {
    const r = routeRef.current;
    if (!routeId || !r || r.line.length < 2) return;
    getOrCreateMapCore().map.fitBounds(L.latLngBounds(r.line), { padding: [56, 56] });
  }, [routeId]);

  function toggleBaseLayer(v: "dark" | "satellite") { setBaseLayer(v); }
  function toggleZones() { setShowZones((v) => !v); }
  function toggleNames() { setShowNames((v) => !v); }
  function toggleStations() { setShowStations((v) => !v); }

  return (
    <div className="relative h-full w-full">
      {/* Floats over live tiles, so it is the documented .glass--float
          exception: a surface step cannot separate a panel from imagery
          moving underneath it. */}
      <div
        className="glass glass--float"
        style={{
          position: "absolute",
          top: 10,
          left: 52,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          gap: "2px",
          borderRadius: "var(--r-pill)",
          padding: "4px",
        }}
      >
        <ToggleButton active={baseLayer === "dark"} onClick={() => toggleBaseLayer("dark")} label="Dark" icon={Moon} />
        <ToggleButton active={baseLayer === "satellite"} onClick={() => toggleBaseLayer("satellite")} label="Satellite" icon={SatelliteIcon} />
        <span aria-hidden style={{ width: 1, alignSelf: "stretch", background: "var(--line)", margin: "0 4px" }} />
        <ToggleButton active={showZones} onClick={toggleZones} label="Zones" icon={MapPin} />
        <ToggleButton active={showNames} onClick={toggleNames} label="Names" icon={Tag} />
        <ToggleButton active={showStations} onClick={toggleStations} label="Stations" icon={Fuel} />
      </div>

      {/* Naming the two ends in text as well as on the pins: the labels
          on the map can sit off-screen once you pan, and this is the
          question the button was added to answer. */}
      {route && (
        <div className="glass glass--float route-caption">
          <div className="route-caption__head">
            <span className="route-caption__eyebrow">Route</span>
            <span className="route-caption__truck">{route.truckId}</span>
            {onRouteClear && (
              <button type="button" onClick={onRouteClear} className="icon-btn" aria-label="Hide route" title="Hide route">
                <X size={12} strokeWidth={2.5} />
              </button>
            )}
          </div>
          <div className="route-caption__leg">
            <span className="route-caption__place" title={route.startLabel}>{route.startLabel}</span>
            <ArrowRight size={11} strokeWidth={2} style={{ color: "var(--text-faint)", flex: "none" }} />
            <span className="route-caption__place route-caption__place--to" title={route.endLabel}>{route.endLabel}</span>
          </div>
          {(route.distanceMeters != null || route.durationSeconds != null) && (
            <div className="route-caption__stats">
              {route.distanceMeters != null && <span>{(route.distanceMeters / 1000).toFixed(0)} km</span>}
              {route.durationSeconds != null && <span>{formatDuration(route.durationSeconds)} driving</span>}
            </div>
          )}
        </div>
      )}

      <div ref={wrapperRef} className="h-full w-full" />
    </div>
  );
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
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
      aria-pressed={active}
      className={`seg-item${active ? " is-active" : ""}`}
      style={{ padding: "5px 10px", fontSize: ".72rem" }}
    >
      <Icon size={13} strokeWidth={2} />
      {label}
    </button>
  );
}
