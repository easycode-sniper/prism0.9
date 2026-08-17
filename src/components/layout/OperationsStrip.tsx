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
  const dotColor = fleetData.error ? "var(--red)" : trackingActive ? "var(--green)" : "#657077";

  return (
    <div id="operations-strip" aria-label="Operational status" style={{ display: 'flex', alignItems: 'center', gap: '18px', minHeight: '36px', padding: '7px 20px', background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '.72rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span className="ops-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 0 3px ${dotColor}1f` }}></span>
        <span>{statusLabel}</span>
      </div>
      <span style={{ width: '1px', height: '16px', background: 'var(--line)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        Active runs <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{activeRuns}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        Off route <strong style={{ color: offRouteCount > 0 ? '#d92d42' : 'var(--text)', fontSize: '.78rem' }}>{offRouteCount}</strong>
      </div>
      <span style={{ width: '1px', height: '16px', background: 'var(--line)' }}></span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        Last update <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{fleetData.lastUpdated ? formatTime(fleetData.lastUpdated) : "Not yet synced"}</strong>
      </div>
    </div>
  );
}
