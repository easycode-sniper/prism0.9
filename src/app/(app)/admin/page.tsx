"use client";

import { useState } from "react";
import Link from "next/link";
import { uploadKmlZones } from "@/lib/supabase/geofences";
import type { KmlUploadReport } from "@/lib/supabase/geofences";
import { useFleet } from "@/components/providers/FleetProvider";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { Users, Settings } from "lucide-react";

export default function AdminPage() {
  const { t } = useTranslation();
  const { geofences, refreshGeofences } = useFleet();
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<KmlUploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setReport(null); setUploading(true);

    try {
      const text = await file.text();
      const result = await uploadKmlZones(text);
      if (result.error) { setError(result.error); setUploading(false); return; }
      setReport(result.report ?? null);
      await refreshGeofences();
    } catch {
      setError("Failed to read the KML file");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

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

      <div className="flex gap-3">
        <Link href="/admin/users" className="btn-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <Users size={14} strokeWidth={2.25} /> User Management
        </Link>
        <Link href="/admin/settings" className="btn-sm" style={{ borderColor: "var(--accent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          <Settings size={14} strokeWidth={2.25} /> Wialon Settings
        </Link>
      </div>

      <div className="panel p-6">
        <div className="section-label mb-4">Upload Zone Export (KML)</div>
        <p className="text-sm mb-3" style={{ color: "var(--text-dim)" }}>
          The Wialon account export typically contains 500+ zones, most stale or belonging to
          other companies. Only zones whose name closely matches a known construction site are
          applied — everything else is reported as unmatched, nothing is silently dropped.
        </p>
        <input type="file" accept=".kml" onChange={handleFileChange} disabled={uploading} />
        {uploading && <p className="mt-2 text-sm" style={{ color: "var(--text-dim)" }}>Parsing and matching…</p>}
        {error && (
          <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: "var(--red-subtle, rgba(255,77,61,0.08))", border: "1px solid rgba(255,77,61,0.35)", color: "var(--red)" }}>
            {error}
          </div>
        )}
        {report && (
          <div className="mt-4 space-y-3">
            <div className="text-sm" style={{ color: "var(--text-dim)" }}>
              Matched <strong style={{ color: "var(--green)" }}>{report.matched.length}</strong> zone(s),
              {" "}<strong style={{ color: "var(--red)" }}>{report.unmatched.length}</strong> unmatched.
            </div>
            {report.matched.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-dim)" }}>Matched</div>
                <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                  {report.matched.map((m, i) => (
                    <li key={i}>
                      <span className="t-primary">{m.zoneName}</span>
                      <span style={{ color: "var(--text-dim)" }}> → {m.siteName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.unmatched.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide mb-1" style={{ color: "var(--text-dim)" }}>Unmatched (not applied)</div>
                <ul className="text-sm space-y-1 max-h-40 overflow-y-auto" style={{ color: "var(--text-dim)" }}>
                  {report.unmatched.map((m, i) => <li key={i}>{m.zoneName}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
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
