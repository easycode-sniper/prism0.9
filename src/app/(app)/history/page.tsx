"use client";

import { useState, useEffect, useCallback } from "react";
import { getHistoryData, HistoryRecord } from "@/lib/supabase/history";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { Printer } from "lucide-react";
import { formatTime, formatDateTime, formatDateLong } from "@/lib/format";

export default function HistoryPage() {
  const { t } = useTranslation();
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await getHistoryData();
    setRecords(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function exportCsv() {
    if (records.length === 0) return;
    const header = ["Truck", "Driver", "Client", "Destination", "Dispatched", "Ended", "Duration (min)", "Status", "Off Route", "Speeding", "Dispatcher"];
    const rows = records.map((r) => [
      r.truck_id,
      r.driver_name || "",
      r.client || "",
      r.site_name || "",
      r.dispatched_at,
      r.ended_at || "",
      r.duration_minutes?.toString() || "",
      r.status,
      r.ever_off_route ? "Yes" : "No",
      r.ever_speeding ? "Yes" : "No",
      r.dispatcher_name || "",
    ]);

    const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function isToday(iso: string): boolean {
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  const todaysRecords = records.filter((r) => isToday(r.dispatched_at));
  const todaysStats = {
    total: todaysRecords.length,
    completed: todaysRecords.filter((r) => r.status === "completed").length,
    stopped: todaysRecords.filter((r) => r.status === "stopped").length,
    offRoute: todaysRecords.filter((r) => r.ever_off_route).length,
    speeding: todaysRecords.filter((r) => r.ever_speeding).length,
  };

  function printDailySummary() {
    window.print();
  }

  function csvEscape(s: string | null | undefined): string {
    if (s == null) return "";
    const str = String(s);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm t-dim">Loading history...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold t-primary">{t("history.title")}</h1>
          <p className="mt-1 text-sm t-dim">
            {records.length} completed run{records.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={printDailySummary}
            className="inline-flex items-center gap-2 rounded-md border bd px-3 py-1.5 text-sm t-primary transition bg-raised-hover"
          >
            <Printer size={14} strokeWidth={2} /> Print Daily Summary
          </button>
          {records.length > 0 && (
            <button
              onClick={exportCsv}
              className="rounded-md border bd px-3 py-1.5 text-sm t-primary transition bg-raised-hover"
            >
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      {error && <div className="mt-4 rounded-md tint-red p-3 text-sm c-red">{error}</div>}

      {records.length === 0 ? (
        <p className="mt-8 text-center text-sm t-dim">No completed runs yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border bd">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bd bg-panel text-left text-xs uppercase t-dim">
                <th className="px-4 py-3">Truck</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Dispatched</th>
                <th className="px-4 py-3">Ended</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-token">
              {records.map((r) => (
                <tr key={r.id} className="bg-panel/50">
                  <td className="px-4 py-3 font-mono c-cyan">{r.truck_id}</td>
                  <td className="px-4 py-3 t-primary">{r.site_name || "—"}</td>
                  <td className="px-4 py-3 t-dim">{r.client || "—"}</td>
                  <td className="px-4 py-3 t-dim">{formatDateTime(r.dispatched_at)}</td>
                  <td className="px-4 py-3 t-dim">{r.ended_at ? formatDateTime(r.ended_at) : "—"}</td>
                  <td className="px-4 py-3 t-dim">{r.duration_minutes != null ? `${r.duration_minutes} min` : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.ever_off_route && <span className="c-red">Off route</span>}
                    {r.ever_off_route && r.ever_speeding && " · "}
                    {r.ever_speeding && <span className="c-amber">Speeding</span>}
                    {!r.ever_off_route && !r.ever_speeding && <span className="t-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Print-only daily summary — hidden on screen, shown via @media print (#print-area rule in globals.css) */}
      <div id="print-area">
        <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: 4 }}>OMD Transport — Daily Dispatch Summary</h1>
        <p style={{ fontSize: "13px", marginBottom: 16 }}>{formatDateLong(new Date())}</p>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20, fontSize: "13px" }}>
          <tbody>
            <tr>
              <td style={{ padding: "4px 12px 4px 0" }}>Total runs today</td>
              <td style={{ fontWeight: 700 }}>{todaysStats.total}</td>
              <td style={{ padding: "4px 12px 4px 24px" }}>Completed</td>
              <td style={{ fontWeight: 700 }}>{todaysStats.completed}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 12px 4px 0" }}>Stopped</td>
              <td style={{ fontWeight: 700 }}>{todaysStats.stopped}</td>
              <td style={{ padding: "4px 12px 4px 24px" }}>Off-route incidents</td>
              <td style={{ fontWeight: 700 }}>{todaysStats.offRoute}</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 12px 4px 0" }}>Speeding incidents</td>
              <td style={{ fontWeight: 700 }}>{todaysStats.speeding}</td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>

        {todaysRecords.length === 0 ? (
          <p style={{ fontSize: "13px" }}>No completed or stopped runs today.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--line-strong)", textAlign: "left" }}>
                <th style={{ padding: "4px" }}>Truck</th>
                <th style={{ padding: "4px" }}>Driver</th>
                <th style={{ padding: "4px" }}>Destination</th>
                <th style={{ padding: "4px" }}>Dispatched</th>
                <th style={{ padding: "4px" }}>Duration</th>
                <th style={{ padding: "4px" }}>Status</th>
                <th style={{ padding: "4px" }}>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {todaysRecords.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "4px" }}>{r.truck_id}</td>
                  <td style={{ padding: "4px" }}>{r.driver_name || "—"}</td>
                  <td style={{ padding: "4px" }}>{r.site_name || "—"}</td>
                  <td style={{ padding: "4px" }}>{formatTime(r.dispatched_at)}</td>
                  <td style={{ padding: "4px" }}>{r.duration_minutes != null ? `${r.duration_minutes} min` : "—"}</td>
                  <td style={{ padding: "4px" }}>{r.status}</td>
                  <td style={{ padding: "4px" }}>
                    {[r.ever_off_route && "Off route", r.ever_speeding && "Speeding"].filter(Boolean).join(", ") || "—"}
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

function StatusBadge({ status }: { status: HistoryRecord["status"] }) {
  const styles = {
    completed: "tint-green c-green",
    stopped: "tint-red c-red",
  };
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}
