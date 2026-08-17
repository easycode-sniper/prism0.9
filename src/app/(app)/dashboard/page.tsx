"use client";

import { useEffect, useState } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { Truck } from "lucide-react";
import { useFleet } from "@/components/providers/FleetProvider";
import { getDriverRatings, DriverRating } from "@/lib/supabase/history";
import type { GeofenceRecord } from "@/lib/supabase/geofences";
import { isWithinGeofence, haversineMeters } from "@/lib/geometry";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { formatTime } from "@/lib/format";

// A truck within this distance of a station is treated as "at the pump".
const STATION_PROXIMITY_METERS = 150;

const GEOFENCE_EDGE_BUFFER_METERS = 150;

function isWithinCircle(lat: number, lng: number, centerLat: number, centerLng: number, radiusMeters: number): boolean {
  return haversineMeters(lat, lng, centerLat, centerLng) <= radiusMeters;
}

function classifyTruckLocation(
  lat: number,
  lng: number,
  geofences: GeofenceRecord[]
): "factory" | "base" | "customer_site" | "in_transit" {
  const factory = geofences.find((g) => g.kind === "factory");
  if (factory) {
    if (factory.ring && isWithinGeofence([lat, lng], factory.ring, GEOFENCE_EDGE_BUFFER_METERS)) return "factory";
    if (!factory.ring && factory.centerLat != null && factory.centerLng != null) {
      if (isWithinCircle(lat, lng, factory.centerLat, factory.centerLng, factory.radiusMeters ?? 300)) return "factory";
    }
  }

  for (const g of geofences) {
    if (g.kind !== "site") continue;
    const within = g.ring
      ? isWithinGeofence([lat, lng], g.ring, GEOFENCE_EDGE_BUFFER_METERS)
      : g.centerLat != null && g.centerLng != null
        ? isWithinCircle(lat, lng, g.centerLat, g.centerLng, g.radiusMeters ?? GEOFENCE_EDGE_BUFFER_METERS)
        : false;
    if (within) return g.siteId ? "customer_site" : "base";
  }

  return "in_transit";
}

ChartJS.register(ArcElement, Tooltip, Legend);

export default function DashboardPage() {
  const { t } = useTranslation();
  const { fleetData, isPolling, geofences, gasStations, notifications } = useFleet();
  const [connectionStatus, setConnectionStatus] = useState<string>("—");
  const [ratings, setRatings] = useState<DriverRating[]>([]);
  const [ratingsError, setRatingsError] = useState<string | null>(null);

  useEffect(() => {
    if (fleetData.error) {
      setConnectionStatus(fleetData.error);
    } else if (fleetData.lastUpdated) {
      setConnectionStatus(`● Wialon configured`);
    }
  }, [fleetData]);

  useEffect(() => {
    getDriverRatings().then(({ data, error }) => {
      setRatings(data);
      setRatingsError(error);
    });
  }, []);

  const trucks = fleetData.trucks;
  const total = trucks.length || 84;
  const moving = trucks.filter((t) => t.status === "moving").length;
  const idle = trucks.filter((t) => t.status === "idle").length;
  const offline = trucks.filter((t) => t.status === "offline").length;

  const statusChart = {
    labels: ["Moving", "Idle/Stopped", "Offline/No Signal"],
    datasets: [{
      data: [moving, idle, offline],
      backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
      borderWidth: 0,
    }],
  };

  const trucksWithPosition = trucks.filter((t) => t.lat != null && t.lng != null);
  const occupancy = { factory: 0, base: 0, customer_site: 0, in_transit: 0 };
  for (const t of trucksWithPosition) {
    occupancy[classifyTruckLocation(t.lat!, t.lng!, geofences)]++;
  }

  const geofenceChart = {
    labels: ["At Factory", "At Base (PARC OMD)", "At Customer Site", "In Transit"],
    datasets: [{
      data: [occupancy.factory, occupancy.base, occupancy.customer_site, occupancy.in_transit],
      backgroundColor: ["#3b82f6", "#8b5cf6", "#22c55e", "#06b6d4"],
      borderWidth: 0,
    }],
  };

  const fuelingTrucks = trucksWithPosition
    .map((t) => {
      const station = gasStations.find(
        (s) => haversineMeters(t.lat!, t.lng!, s.lat, s.lng) <= STATION_PROXIMITY_METERS
      );
      return station ? { truckId: t.truck_id, stationName: station.name } : null;
    })
    .filter((x): x is { truckId: string; stationName: string } => x !== null);

  const fuelChart = {
    labels: ["At Gas Station", "Not at Gas Station"],
    datasets: [{
      data: [fuelingTrucks.length, trucksWithPosition.length - fuelingTrucks.length],
      backgroundColor: ["#f59e0b", "#334155"],
      borderWidth: 0,
    }],
  };

  const alertCounts = { off_route: 0, speeding: 0, site_arrival: 0, factory_arrival: 0, hq_arrival: 0 };
  for (const n of notifications) alertCounts[n.kind]++;

  const alertChart = {
    labels: ["Off Route", "Speeding", "Site Arrival", "Factory Arrival", "HQ Arrival"],
    datasets: [{
      data: [alertCounts.off_route, alertCounts.speeding, alertCounts.site_arrival, alertCounts.factory_arrival, alertCounts.hq_arrival],
      backgroundColor: ["#ef4444", "#f97316", "#22c55e", "#3b82f6", "var(--cyan)"],
      borderWidth: 0,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' as const, labels: { color: '#ccc', font: { size: 11 } } },
    },
  };

  return (
    <div style={{ padding: '24px 28px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '18px' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 600 }}>{t("dashboard.title")}</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '.85rem', marginTop: '4px' }}>{t("dashboard.subtitle")}</p>
          <p style={{ fontSize: '.78rem', color: connectionStatus.includes('●') ? 'var(--green)' : 'var(--amber)', marginTop: '2px' }}>{connectionStatus}</p>
          <p style={{ fontSize: '.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
            Live polling {isPolling ? "active" : "—"} {fleetData.lastUpdated ? `· ${formatTime(fleetData.lastUpdated)}` : ""}
          </p>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <KPICard value={total} label="Total fleet" color="var(--indigo)" />
        <KPICard value={moving} label="Moving" color="var(--green)" />
        <KPICard value={idle} label="Idle" color="var(--cyan)" />
        <KPICard value={offline} label="Offline" color="var(--purple)" />
      </div>

      {/* Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', gridAutoRows: 'min-content' }}>
        <div className="surface" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '10px' }}>Fleet Status Distribution</h3>
          <div style={{ position: 'relative', height: '220px' }}>
            <Doughnut data={statusChart} options={chartOptions} />
          </div>
        </div>
        <div className="surface" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '10px' }}>Geofence Occupancy</h3>
          <div style={{ position: 'relative', height: '220px' }}>
            <Doughnut data={geofenceChart} options={chartOptions} />
          </div>
        </div>
        <div className="surface" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '4px' }}>Fuel Stop Analysis</h3>
          <p style={{ fontSize: '.72rem', color: 'var(--text-dim)', marginBottom: '6px' }}>
            Live proximity to a known station (&lt;{STATION_PROXIMITY_METERS}m)
          </p>
          <div style={{ position: 'relative', height: '190px' }}>
            <Doughnut data={fuelChart} options={chartOptions} />
          </div>
          {fuelingTrucks.length > 0 && (
            <ul style={{ marginTop: '8px', fontSize: '.78rem', color: 'var(--text-dim)', listStyle: 'none', padding: 0 }}>
              {fuelingTrucks.map((f) => (
                <li key={f.truckId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Truck size={13} strokeWidth={2.25} />
                  <strong style={{ color: 'var(--amber)' }}>{f.truckId}</strong> — {f.stationName}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="surface" style={{ padding: '16px' }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '10px' }}>Alert Types Distribution</h3>
          <div style={{ position: 'relative', height: '220px' }}>
            <Doughnut data={alertChart} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Driver Ratings */}
      <div className="surface" style={{ padding: '16px', marginTop: '16px' }}>
        <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '4px' }}>
          Driver ratings{' '}
          <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: '.75rem' }}>
            — % of runs with no route deviation and no speeding over 90km/h
          </span>
        </h3>
        {ratingsError && (
          <p style={{ color: 'var(--amber)', fontSize: '.8rem', marginTop: '8px' }}>{ratingsError}</p>
        )}
        {!ratingsError && ratings.length === 0 && (
          <p style={{ color: 'var(--text-dim)', fontSize: '.85rem', padding: '20px 0', textAlign: 'center' }}>
            No completed runs yet — ratings build up as runs finish.
          </p>
        )}
        {ratings.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px', fontSize: '.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-dim)', fontSize: '.72rem', textTransform: 'uppercase' }}>
                <th style={{ padding: '8px 6px' }}>Driver</th>
                <th style={{ padding: '8px 6px' }}>Total runs</th>
                <th style={{ padding: '8px 6px' }}>Deviations</th>
                <th style={{ padding: '8px 6px' }}>Speeding (&gt;90km/h)</th>
                <th style={{ padding: '8px 6px' }}>Score</th>
              </tr>
            </thead>
            <tbody>
              {ratings.map((d) => (
                <tr key={d.name} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '8px 6px' }}>{d.name}</td>
                  <td style={{ padding: '8px 6px' }}>{d.totalRuns}</td>
                  <td style={{ padding: '8px 6px' }}>{d.deviations}</td>
                  <td style={{ padding: '8px 6px', color: d.speedingCount > 0 ? 'var(--red)' : undefined }}>
                    {d.speedingCount}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <span
                      style={{
                        padding: '3px 10px', borderRadius: '20px', fontSize: '.78rem', fontWeight: 600,
                        background: d.score >= 90 ? 'rgba(74,222,128,.15)' : d.score >= 70 ? 'rgba(88,101,242,.15)' : 'rgba(248,113,113,.15)',
                        color: d.score >= 90 ? 'var(--green)' : d.score >= 70 ? 'var(--indigo)' : 'var(--red)',
                      }}
                    >
                      {d.score}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function KPICard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="kpi-card">
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '.75rem', color: 'var(--text-dim)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    </div>
  );
}
