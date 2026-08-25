"use client";

import Link from "next/link";
import { useFleet } from "@/components/providers/FleetProvider";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { Users, Settings, Fuel, Building2 } from "lucide-react";

export default function AdminPage() {
  const { t } = useTranslation();
  const { geofences } = useFleet();

  const siteGeofences = geofences.filter((g) => g.kind === "site");
  const factoryGeofences = geofences.filter((g) => g.kind === "factory");

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold t-primary">{t("admin.title")}</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
          {t("admin.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/users" className="btn-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <Users size={14} strokeWidth={2} /> User Management
        </Link>
        <Link href="/admin/settings" className="btn-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <Settings size={14} strokeWidth={2} /> Wialon Settings
        </Link>
        <Link href="/admin/stations" className="btn-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <Fuel size={14} strokeWidth={2} /> Gas Stations
        </Link>
        <Link href="/admin/sites" className="btn-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <Building2 size={14} strokeWidth={2} /> Clients &amp; Sites
        </Link>
      </div>

      <div className="panel p-6">
        <div className="section-label mb-4">Active Geofences</div>
        <p className="text-sm mb-3" style={{ color: "var(--text-dim)" }}>
          Factory: {factoryGeofences.length} · Sites with a real polygon: {siteGeofences.length}
        </p>
        {siteGeofences.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            No site geofences yet. Sites without one fall back to a 300m radius buffer for arrival detection.
          </p>
        ) : (
          <ul className="text-sm space-y-1 max-h-64 overflow-y-auto">
            {siteGeofences.map((g) => <li key={g.id} className="t-primary">{g.name}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
