"use client";

import { useState, useEffect, useCallback } from "react";
import { getHistoryData, HistoryRecord } from "@/lib/supabase/history";

export default function HistoryPage() {
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
    const header = ["Truck", "Client", "Destination", "Dispatched", "Stopped", "Duration (min)", "Status", "Off Route", "Speeding", "Dispatcher"];
    const rows = records.map((r) => [
      r.truck_id,
      r.client || "",
      r.site_name || "",
      r.dispatched_at,
      r.stopped_at || "",
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

  function csvEscape(s: string | null | undefined): string {
    if (s == null) return "";
    const str = String(s);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading history...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">History</h1>
          <p className="mt-1 text-sm text-gray-400">
            {records.length} completed run{records.length === 1 ? "" : "s"}
          </p>
        </div>
        {records.length > 0 && (
          <button
            onClick={exportCsv}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800"
          >
            ⬇ Export CSV
          </button>
        )}
      </div>

      {error && <div className="mt-4 rounded-md bg-red-900/50 p-3 text-sm text-red-300">{error}</div>}

      {records.length === 0 ? (
        <p className="mt-8 text-center text-sm text-gray-500">No completed runs yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs uppercase text-gray-500">
                <th className="px-4 py-3">Truck</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Dispatched</th>
                <th className="px-4 py-3">Stopped</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Alerts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {records.map((r) => (
                <tr key={r.id} className="bg-gray-900/50">
                  <td className="px-4 py-3 font-mono text-cyan-400">{r.truck_id}</td>
                  <td className="px-4 py-3 text-white">{r.site_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{r.client || "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{new Date(r.dispatched_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-400">{r.stopped_at ? new Date(r.stopped_at).toLocaleString() : "—"}</td>
                  <td className="px-4 py-3 text-gray-400">{r.duration_minutes != null ? `${r.duration_minutes} min` : "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.ever_off_route && <span className="text-red-400">Off route</span>}
                    {r.ever_off_route && r.ever_speeding && " · "}
                    {r.ever_speeding && <span className="text-amber-400">Speeding</span>}
                    {!r.ever_off_route && !r.ever_speeding && <span className="text-gray-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: HistoryRecord["status"] }) {
  const styles = {
    completed: "bg-green-900/50 text-green-400",
    stopped: "bg-red-900/50 text-red-400",
  };
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}
