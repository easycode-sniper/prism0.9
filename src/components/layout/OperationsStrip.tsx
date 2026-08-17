"use client";

import { useFleet } from "@/components/providers/FleetProvider";
import { formatTime } from "@/lib/format";

export function OperationsStrip() {
  const { fleetData, activeRuns, offRouteCount } = useFleet();

  const trackingActive = fleetData.lastUpdated != null && !fleetData.error;
  const statusLabel = fleetData.error
    ? "Live tracking error"
    : trackingActive
      ? "Live tracking active"
      : "Live tracking paused";
  const dotColor = fleetData.error ? "var(--red)" : trackingActive ? "var(--green)" : "var(--text-dim)";

  return (
    <div id="operations-strip" aria-label="Operational status" style={{ display: 'flex', alignItems: 'center', gap: '18px', minHeight: '36px', padding: '7px 20px', background: 'var(--surface-raised)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid var(--glass-border)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span className="ops-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 0 3px ${dotColor}2b` }}></span>
        <span>{statusLabel}</span>
      </div>
      <span style={{ width: '1px', height: '16px', background: 'var(--glass-border)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        Active runs <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{activeRuns}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        Off route <strong style={{ color: offRouteCount > 0 ? 'var(--red)' : 'var(--text)', fontSize: '.78rem' }}>{offRouteCount}</strong>
      </div>
      <span style={{ width: '1px', height: '16px', background: 'var(--glass-border)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        Last update <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{fleetData.lastUpdated ? formatTime(fleetData.lastUpdated) : "Not yet synced"}</strong>
      </div>
    </div>
  );
}
