"use client";

import { useEffect, useState } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { useFleet } from "@/components/providers/FleetProvider";
import { getDriverRatings, DriverRating } from "@/lib/supabase/history";

ChartJS.register(ArcElement, Tooltip, Legend);

export default function DashboardPage() {
  const { fleetData, refresh, isPolling } = useFleet();
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
    labels: ["Moving 🟢", "Idle/Stopped 🟠", "Offline/No Signal 🔴"],
    datasets: [{
      data: [moving, idle, offline],
      backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
      borderWidth: 0,
    }],
  };

  const geofenceChart = {
    labels: ["At PARC OMD 🔵", "At Customer Sites", "In Transit", "At Gas Stations"],
    datasets: [{
      data: [Math.floor(offline * 0.6), 0, moving, Math.floor(idle * 0.4)],
      backgroundColor: ["#3b82f6", "#8b5cf6", "#06b6d4", "#f97316"],
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
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '1.15rem', fontWeight: 600 }}>Dashboard</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '.85rem', marginTop: '4px' }}>Fleet status overview</p>
          <p style={{ fontSize: '.78rem', color: connectionStatus.includes('●') ? 'var(--green)' : 'var(--amber)', marginTop: '2px' }}>{connectionStatus}</p>
          <p style={{ fontSize: '.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>
            Live polling {isPolling ? "active" : "—"} {fleetData.lastUpdated ? `· ${fleetData.lastUpdated.toLocaleTimeString()}` : ""}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '16px' }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '10px' }}>Fleet Status Distribution</h3>
          <div style={{ position: 'relative', height: '220px' }}>
            <Doughnut data={statusChart} options={chartOptions} />
          </div>
        </div>
        <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '16px' }}>
          <h3 style={{ fontSize: '.85rem', fontWeight: 600, marginBottom: '10px' }}>Geofence Occupancy</h3>
          <div style={{ position: 'relative', height: '220px' }}>
            <Doughnut data={geofenceChart} options={chartOptions} />
          </div>
        </div>
      </div>

      {/* Driver Ratings */}
      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '12px', padding: '16px', marginTop: '16px' }}>
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
                        background: d.score >= 90 ? 'rgba(74,222,128,.15)' : d.score >= 70 ? 'rgba(109,91,255,.15)' : 'rgba(248,113,113,.15)',
                        color: d.score >= 90 ? 'var(--green)' : d.score >= 70 ? '#a7a0ff' : 'var(--red)',
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
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px 18px', minWidth: '130px', flex: 1 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '.75rem', color: 'var(--text-dim)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    </div>
  );
}
