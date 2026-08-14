"use client";

import { useState, useEffect, useCallback } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { getMonitoringData } from "@/lib/supabase/monitoring";

ChartJS.register(ArcElement, Tooltip, Legend);

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);

  const loadData = useCallback(async () => {
    const result = await getMonitoringData();
    setData(result);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const total = data?.total ?? 84;
  const moving = data?.moving ?? 0;
  const idle = data?.idle ?? 0;
  const offline = total - moving - idle;
  const activeDispatches = data?.dispatched ?? 0;

  const statusChart = {
    labels: ["Moving", "Idle/Stopped", "Offline/No Signal"],
    datasets: [{
      data: [moving, idle, offline],
      backgroundColor: ["#22c55e", "#f59e0b", "#ef4444"],
      borderWidth: 0,
    }],
  };

  const geofenceChart = {
    labels: ["At PARC OMD", "At Customer Sites", "In Transit", "At Gas Stations"],
    datasets: [{
      data: [offline, 0, moving, idle],
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
          <p style={{ fontSize: '.78rem', color: 'var(--text-dim)', marginTop: '2px' }}>Wialon configured</p>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: '14px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <KPICard value={total} label="Total fleet" color="var(--indigo)" />
        <KPICard value={moving} label="Moving" color="var(--green)" />
        <KPICard value={idle} label="Idle" color="var(--cyan)" />
        <KPICard value={offline} label="Offline" color="var(--purple)" />
        <KPICard value={activeDispatches} label="Active dispatches" color="var(--amber)" />
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
    </div>
  );
}

function KPICard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: '10px', padding: '14px 18px', minWidth: '150px', flex: 1 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '.75rem', color: 'var(--text-dim)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
    </div>
  );
}
