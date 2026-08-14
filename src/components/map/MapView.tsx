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

    const statusColors = {
      moving: "#4ade80",
      idle: "#22d3ee",
      offline: "#6b7280",
    };

    for (const m of markers) {
      const color = statusColors[m.status];
      const radius = m.offRoute ? 8 : 6;

      const marker = L.circleMarker([m.lat, m.lng], {
        radius,
        fillColor: color,
        color: m.offRoute ? "#f87171" : "#fff",
        weight: m.offRoute ? 3 : 1,
        fillOpacity: 0.9,
      });

      marker.bindPopup(
        `<div style="font-family: system-ui; font-size: 12px;">
          <strong>${m.label}</strong><br>
          Status: ${m.status}<br>
          ${m.dispatched ? "Dispatched" : "Not dispatched"}
          ${m.offRoute ? "<br><span style='color:#f87171'>⚠ Off route</span>" : ""}
        </div>`
      );

      marker.addTo(layer);
    }
  }, [markers]);

  return <div ref={containerRef} className="h-full w-full" />;
}
