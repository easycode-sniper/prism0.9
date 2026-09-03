"use client";

import { useFleet } from "@/components/providers/FleetProvider";
import { formatTime } from "@/lib/format";
import { useTranslation } from "@/lib/i18n/I18nProvider";

export function OperationsStrip() {
  const { fleetData, activeRuns, offRouteCount } = useFleet();
  const { t } = useTranslation();

  const trackingActive = fleetData.lastUpdated != null && !fleetData.error;
  const statusLabel = fleetData.error
    ? t("Live tracking error")
    : trackingActive
      ? t("Live tracking active")
      : t("Live tracking paused");
  const dotColor = fleetData.error ? "var(--red)" : trackingActive ? "var(--green)" : "var(--text-dim)";

  return (
    <div id="operations-strip" aria-label={t("Operational status")}>
      <div className="glass ops-pill" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="ops-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 0 3px ${dotColor}2b` }}></span>
        <span>{statusLabel}</span>
      </div>
      <div className="glass ops-pill">
        {t("Active runs")} <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{activeRuns}</strong>
      </div>
      <div className="glass ops-pill">
        {t("Off route")} <strong style={{ color: offRouteCount > 0 ? 'var(--red)' : 'var(--text)', fontSize: '.78rem' }}>{offRouteCount}</strong>
      </div>
      <div className="glass ops-pill">
        {t("Last update")} <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{fleetData.lastUpdated ? formatTime(fleetData.lastUpdated) : t("Not yet synced")}</strong>
      </div>
    </div>
  );
}
