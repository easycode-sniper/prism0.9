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
    <div id="operations-strip" aria-label="Operational status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', margin: '12px 16px 14px', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '.73rem' }}>
      <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 14px', borderRadius: '999px' }}>
        <span className="ops-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 0 3px ${dotColor}2b` }}></span>
        <span>{statusLabel}</span>
      </div>
      <div className="glass" style={{ padding: '7px 14px', borderRadius: '999px' }}>
        Active runs <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{activeRuns}</strong>
      </div>
      <div className="glass" style={{ padding: '7px 14px', borderRadius: '999px' }}>
        Off route <strong style={{ color: offRouteCount > 0 ? 'var(--red)' : 'var(--text)', fontSize: '.78rem' }}>{offRouteCount}</strong>
      </div>
      <div className="glass" style={{ padding: '7px 14px', borderRadius: '999px' }}>
        Last update <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{fleetData.lastUpdated ? formatTime(fleetData.lastUpdated) : "Not yet synced"}</strong>
      </div>
    </div>
  );
}
