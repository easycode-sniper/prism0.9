"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

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

function statusColor(status: TruckMarkerData["status"], offRoute?: boolean): string {
  if (offRoute) return "#d92d42";
  if (status === "moving") return "#159c83";
  if (status === "idle") return "#167d8d";
  return "#6b7280";
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
      ? `<svg width="22" height="22" viewBox="0 0 24 24" style="transform:rotate(${course}deg); filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));"><path d="M12 1.5 L20 21 L12 16 L4 21 Z" fill="${color}" stroke="#0a0a14" stroke-width="1.75" stroke-linejoin="round"/></svg>`
      : `<div style="width:12px;height:12px;border-radius:50%;background:${color};border:${offRoute ? 3 : 1}px solid ${offRoute ? "#f87171" : "rgba(255,255,255,.85)"};box-shadow:0 0 6px ${color};"></div>`;

  const label = labelText
    ? `<div style="position:absolute; bottom:26px; left:50%; transform:translateX(-50%); white-space:nowrap; background:#fff; color:#222; font-size:11px; font-weight:600; padding:2px 6px; border-radius:4px; box-shadow:0 1px 3px rgba(0,0,0,.5); pointer-events:none;">${labelText}</div>`
    : "";

  const html = `<div style="position:relative; width:22px; height:22px; display:flex; align-items:center; justify-content:center;">${label}${shape}</div>`;
  return L.divIcon({ html, className: "", iconSize: [22, 22], iconAnchor: [11, 11] });
}

// The factory and home base are landmarks, not just another zone —
// always visible regardless of the Zones toggle or zoom level, with
// their own icon rather than a plain circle marker.
function buildLandmarkIcon(emoji: string, color: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:16px;">${emoji}</div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function buildSiteIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:9px;height:9px;border-radius:50%;background:#6d5bff;border:1px solid rgba(255,255,255,.7);"></div>`,
    className: "",
    iconSize: [9, 9],
    iconAnchor: [4, 4],
  });
}

// Matches the legacy app's cluster-bubble classes: site clusters gold,
// truck clusters purple/indigo. Stations are new — given their own
// distinct color (red-orange) so all three layers stay tellable apart.
function buildClusterIcon(gradient: string) {
  return (cluster: L.MarkerCluster) =>
    L.divIcon({
      html: `<div style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-weight:700;font-size:.85rem;color:#fff;border:2px solid rgba(255,255,255,.85);box-shadow:0 2px 8px rgba(0,0,0,.4);background:${gradient};">${cluster.getChildCount()}</div>`,
      className: "",
      iconSize: [34, 34],
    });
}

const SITE_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #ffcf4d, #ffb703)";
const TRUCK_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #a855f7, #6d5bff)";
const STATION_CLUSTER_GRADIENT = "radial-gradient(circle at 35% 30%, #fb923c, #dc2626)";

function buildStationIcon(occupied: boolean): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${occupied ? "#f59e0b" : "#334155"};border:2px solid rgba(255,255,255,.8);display:flex;align-items:center;justify-content:center;font-size:9px;">⛽</div>`,
    className: "",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function MapView({ truckMarkers, siteMarkers = [], stationMarkers = [], zones = [], routeLine = null, focusPoint = null }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const truckLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const siteLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const stationLayerRef = useRef<L.MarkerClusterGroup | null>(null);
  const zonesLayerRef = useRef<L.LayerGroup | null>(null);
  const landmarksLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const tileLayersRef = useRef<{ dark: L.TileLayer; satellite: L.TileLayer; satelliteLabels: L.TileLayer } | null>(null);

  const [baseLayer, setBaseLayer] = useState<"dark" | "satellite">("dark");
  const [showZones, setShowZones] = useState(true);
  const [showNames, setShowNames] = useState(true);
  const [showStations, setShowStations] = useState(true);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [35.25, 3.0],
      zoom: 7,
      zoomControl: true,
    });

    const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);

    const satellite = L.tileLayer(SATELLITE_TILES, {
      attribution: "&copy; Esri",
      maxZoom: 19,
    });

    // No place names on raw satellite imagery on its own — this reference
    // layer adds them back when satellite mode is active.
    const satelliteLabels = L.tileLayer(SATELLITE_LABELS_TILES, {
      maxZoom: 19,
    });

    tileLayersRef.current = { dark, satellite, satelliteLabels };

    truckLayerRef.current = L.markerClusterGroup({
      disableClusteringAtZoom: 11,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: buildClusterIcon(TRUCK_CLUSTER_GRADIENT),
    }).addTo(map);
    siteLayerRef.current = L.markerClusterGroup({
      disableClusteringAtZoom: 11,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: buildClusterIcon(SITE_CLUSTER_GRADIENT),
    }).addTo(map);
    // Always attached, like the other marker-cluster layers — toggling a
    // populated MarkerClusterGroup on/off the map (rather than just
    // clearing its markers) crashes mid-animation on `_leaflet_pos`.
    stationLayerRef.current = L.markerClusterGroup({
      disableClusteringAtZoom: 11,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: buildClusterIcon(STATION_CLUSTER_GRADIENT),
    }).addTo(map);
    zonesLayerRef.current = L.layerGroup().addTo(map);
    // Never gated behind the Zones toggle or clustering — these two are
    // landmarks the operator needs oriented against at any zoom level.
    landmarksLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Base layer switching (dark vs satellite + labels overlay)
  useEffect(() => {
    const map = mapRef.current;
    const tiles = tileLayersRef.current;
    if (!map || !tiles) return;

    if (baseLayer === "dark") {
      map.removeLayer(tiles.satellite);
      map.removeLayer(tiles.satelliteLabels);
      if (!map.hasLayer(tiles.dark)) tiles.dark.addTo(map);
    } else {
      map.removeLayer(tiles.dark);
      if (!map.hasLayer(tiles.satellite)) tiles.satellite.addTo(map);
      if (!map.hasLayer(tiles.satelliteLabels)) tiles.satelliteLabels.addTo(map);
    }
  }, [baseLayer]);

  // Zones + site markers visibility
  useEffect(() => {
    const map = mapRef.current;
    const siteLayer = siteLayerRef.current;
    const zonesLayer = zonesLayerRef.current;
    if (!map || !siteLayer || !zonesLayer) return;

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
    const layer = truckLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showNames) return;

    for (const m of truckMarkers) {
      const labelText = m.driverName ? `${m.driverName} · ${m.label}` : m.label;
      const marker = L.marker([m.lat, m.lng], { icon: buildTruckIcon(m.status, m.offRoute, m.course, labelText) });

      const eta = formatEta(m.etaSeconds);
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: #e7e7f5; min-width: 160px;">
          <strong style="font-size: 13px; color: #22d3ee;">${m.label}</strong>
          ${m.driverName ? `<div style="color: #9a9ab0; margin-top: 2px;">👤 ${m.driverName}</div>` : ""}
          <div style="margin-top: 6px; display: flex; justify-content: space-between;">
            <span style="color: ${statusColor(m.status, m.offRoute)}; text-transform: capitalize; font-weight: 600;">● ${m.status}</span>
            ${m.speed != null ? `<span>${Math.round(m.speed)} km/h</span>` : ""}
          </div>
          ${m.offRoute ? `<div style="color: #f87171; margin-top: 4px;">⚠ Off route</div>` : ""}
          ${m.siteName ? `<div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #26263c;">🎯 ${m.siteName}${m.client ? ` — ${m.client}` : ""}${eta ? `<br>ETA ${eta}` : ""}</div>` : ""}
          ${m.ageMinutes != null ? `<div style="color: #6b6b80; margin-top: 6px; font-size: 11px;">Updated ${m.ageMinutes < 1 ? "just now" : `${m.ageMinutes}m ago`}</div>` : ""}
        </div>`
      );

      layer.addLayer(marker);
    }
  }, [truckMarkers, showNames]);

  // Site markers
  useEffect(() => {
    const layer = siteLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const s of siteMarkers) {
      const marker = L.marker([s.lat, s.lng], { icon: buildSiteIcon() });
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: #e7e7f5;">
          <strong style="color: #a7a0ff;">${s.name}</strong>${s.client ? `<br>${s.client}` : ""}
        </div>`
      );
      layer.addLayer(marker);
    }
  }, [siteMarkers]);

  // Gas station markers — layer stays on the map; toggling just clears
  // vs. repopulates its markers (see mount effect for why).
  useEffect(() => {
    const layer = stationLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (!showStations) return;

    for (const s of stationMarkers) {
      const marker = L.marker([s.lat, s.lng], { icon: buildStationIcon(!!s.truckHere) });
      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: #e7e7f5;">
          <strong style="color: #f59e0b;">⛽ ${s.name}</strong>${s.truckHere ? `<br>🚚 ${s.truckHere} fueling` : ""}
        </div>`
      );
      layer.addLayer(marker);
    }
  }, [stationMarkers, showStations]);

  // Zone polygons/circles
  useEffect(() => {
    const layer = zonesLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const z of zones) {
      const color = z.kind === "factory" ? "#6d5bff" : "#22d3ee";
      const shape = z.ring
        ? L.polygon(z.ring, { color, weight: 2, fillOpacity: 0.12 })
        : z.centerLat != null && z.centerLng != null && z.radiusMeters != null
          ? L.circle([z.centerLat, z.centerLng], { radius: z.radiusMeters, color, weight: 2, fillOpacity: 0.12 })
          : null;
      if (!shape) continue;
      shape.bindPopup(`<strong style="color:#22d3ee;">${z.name}</strong>`);
      layer.addLayer(shape);
    }
  }, [zones]);

  // Factory + home base landmark icons — the base is the 'site' zone
  // with no siteId (a real customer site always has one).
  useEffect(() => {
    const layer = landmarksLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

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
        icon: buildLandmarkIcon(isFactory ? "🏭" : "🅿️", isFactory ? "#6d5bff" : "#22d3ee"),
      });
      marker.bindPopup(`<strong style="color:#22d3ee;">${z.name}</strong>`);
      layer.addLayer(marker);
    }
  }, [zones]);

  // Pan/zoom to a specific point on request (e.g. "Locate" from Monitoring)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) return;
    map.setView(focusPoint, 13);
  }, [focusPoint]);

  // Route polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (routeLine && routeLine.length >= 2) {
      routeLayerRef.current = L.polyline(routeLine, { color: "#22d3ee", weight: 4, opacity: 0.85 }).addTo(map);
    }
  }, [routeLine]);

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
        <ToggleButton active={baseLayer === "dark"} onClick={() => setBaseLayer("dark")} label="🌑 Dark" />
        <ToggleButton active={baseLayer === "satellite"} onClick={() => setBaseLayer("satellite")} label="🛰️ Satellite" />
        <span style={{ width: 1, background: "var(--line)", margin: "2px 2px" }} />
        <ToggleButton active={showZones} onClick={() => setShowZones((v) => !v)} label="📍 Zones" />
        <ToggleButton active={showNames} onClick={() => setShowNames((v) => !v)} label="🏷️ Names" />
        <ToggleButton active={showStations} onClick={() => setShowStations((v) => !v)} label="⛽ Stations" />
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "var(--indigo)" : "transparent",
        color: active ? "#fff" : "var(--text-dim)",
        border: "none",
        borderRadius: "5px",
        padding: "5px 9px",
        fontSize: ".72rem",
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
