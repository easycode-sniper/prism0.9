"use client";

import { useState } from "react";
import { getParcEntries, type ParcEntry } from "@/lib/supabase/reports";
import {
  formatOpsDateTime,
  opsLocalToInstant,
  opsNowLocalValue,
  OPS_TIMEZONE,
} from "@/lib/format";
import { Copy, Download, Check } from "lucide-react";

// Wialon's report screen was the reference for the shape of this: quick
// range buttons over an explicit From/To with minute precision. Its
// Template and Object selectors are dropped — there is one report and
// one parc, so those would be two dropdowns with a single option each.

type QuickRange = "today" | "yesterday" | "week" | "month";

function startOfRange(range: QuickRange): { from: string; to: string } {
  switch (range) {
    case "today":
      return { from: opsNowLocalValue(0), to: opsNowLocalValue(0, true) };
    case "yesterday":
      return { from: opsNowLocalValue(-1), to: opsNowLocalValue(-1, true) };
    case "week":
      return { from: opsNowLocalValue(-6), to: opsNowLocalValue(0, true) };
    case "month":
      return { from: opsNowLocalValue(-29), to: opsNowLocalValue(0, true) };
  }
}

const COLUMNS = ["Truck ID", "Driver", "Entry date"] as const;

function toRows(entries: ParcEntry[]): string[][] {
  return entries.map((e) => [e.truck_id, e.driver_name || "—", formatOpsDateTime(e.entered_at)]);
}

// Tab-separated, because that is what spreadsheets expect from the
// clipboard — pasting comma-separated text into Excel or Sheets lands
// everything in one column.
function toClipboardText(entries: ParcEntry[]): string {
  return [COLUMNS.join("\t"), ...toRows(entries).map((r) => r.join("\t"))].join("\n");
}

function toCsv(entries: ParcEntry[]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [COLUMNS, ...toRows(entries)].map((r) => r.map(escape).join(",")).join("\r\n");
}

export default function ReportsPage() {
  const [from, setFrom] = useState(() => startOfRange("today").from);
  const [to, setTo] = useState(() => startOfRange("today").to);
  const [entries, setEntries] = useState<ParcEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function applyQuickRange(range: QuickRange) {
    const r = startOfRange(range);
    setFrom(r.from);
    setTo(r.to);
  }

  async function execute() {
    setLoading(true);
    setError(null);
    setCopied(false);

    const fromIso = opsLocalToInstant(from);
    const toIso = opsLocalToInstant(to);
    if (!fromIso || !toIso) {
      setError("Enter a valid start and end time");
      setLoading(false);
      return;
    }

    const result = await getParcEntries(fromIso, toIso);
    if (result.error) {
      setError(result.error);
      setEntries(null);
    } else {
      setEntries(result.data);
      setTruncated(result.truncated);
    }
    setLoading(false);
  }

  function clear() {
    const r = startOfRange("today");
    setFrom(r.from);
    setTo(r.to);
    setEntries(null);
    setError(null);
    setCopied(false);
  }

  async function copyTable() {
    if (!entries?.length) return;
    try {
      await navigator.clipboard.writeText(toClipboardText(entries));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not reach the clipboard — use Download CSV instead");
    }
  }

  function downloadCsv() {
    if (!entries?.length) return;
    // ﻿ so Excel opens it as UTF-8; without it, accented driver
    // names arrive mangled.
    const blob = new Blob(["﻿" + toCsv(entries)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rapport-parc_${from.replace(/[:T]/g, "-")}_${to.replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    padding: "6px 10px",
    color: "var(--text)",
    fontSize: ".82rem",
    fontFamily: "var(--font-mono)",
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold text-white">Rapport Parc</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
        Trucks that entered PARC OMD — headquarters &amp; parking. Times in Algeria local time ({OPS_TIMEZONE}).
      </p>

      <div className="panel mt-5 p-4">
        <div className="flex flex-wrap gap-2">
          {(["today", "yesterday", "week", "month"] as QuickRange[]).map((r) => (
            <button key={r} type="button" onClick={() => applyQuickRange(r)} className="btn-sm">
              {r === "week" ? "Last 7 days" : r === "month" ? "Last 30 days" : r === "today" ? "Today" : "Yesterday"}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs" style={{ color: "var(--text-dim)" }}>To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={clear} className="btn-sm">Clear</button>
            <button
              type="button"
              onClick={execute}
              disabled={loading}
              className="btn-sm"
              style={{ background: "var(--indigo)", borderColor: "var(--indigo)", color: "#fff" }}
            >
              {loading ? "Running…" : "Execute"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md p-3 text-sm" style={{ background: "rgba(248,113,113,.12)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      {entries && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm" style={{ color: "var(--text-dim)" }}>
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
              {truncated && " (showing the first 5000 — narrow the range)"}
            </span>
            {entries.length > 0 && (
              <div className="flex gap-2">
                <button type="button" onClick={copyTable} className="btn-sm inline-flex items-center gap-1.5">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy table"}
                </button>
                <button type="button" onClick={downloadCsv} className="btn-sm inline-flex items-center gap-1.5">
                  <Download size={13} /> Download CSV
                </button>
              </div>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="mt-8 text-center text-sm" style={{ color: "var(--text-dim)" }}>
              No trucks entered the parc in this period.
            </p>
          ) : (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="truck-id">{e.truck_id}</td>
                      <td style={{ color: e.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {e.driver_name || "—"}
                      </td>
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
                        {formatOpsDateTime(e.entered_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
