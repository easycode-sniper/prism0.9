"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface MarkerData {
  lat: number;
  lng: number;
  label: string;
  status: "moving" | "idle" | "offline";
  dispatched?: boolean;
  offRoute?: boolean;
}

export function MapView({ markers }: { markers: MarkerData[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [35.25, 3.0],
      zoom: 7,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      maxZoom: 19,
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Force resize after mount
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    layer.clearLayers();

    for (const m of markers) {
      const isOffRoute = m.offRoute;
      const color = isOffRoute ? "#d92d42" : m.status === "moving" ? "#159c83" : m.status === "idle" ? "#167d8d" : "#6b7280";
      const radius = isOffRoute ? 8 : 6;

      const marker = L.circleMarker([m.lat, m.lng], {
        radius,
        fillColor: color,
        color: isOffRoute ? "#f87171" : "rgba(255,255,255,0.85)",
        weight: isOffRoute ? 3 : 1,
        fillOpacity: 0.9,
      });

      marker.bindPopup(
        `<div style="font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: #e7e7f5;">
          <strong style="color: #22d3ee;">${m.label}</strong><br>
          Status: <span style="color: ${color};">${m.status}</span>
          ${m.offRoute ? "<br><span style='color: #f87171;'>⚠ Off route</span>" : ""}
        </div>`
      );

      marker.addTo(layer);
    }
  }, [markers]);

  return <div ref={containerRef} className="h-full w-full" />;
}
