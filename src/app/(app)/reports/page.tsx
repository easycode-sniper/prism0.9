"use client";

import { useState } from "react";
import {
  getParcEntries,
  getFactoryVisits,
  getFactorySummary,
  type ParcEntry,
  type FactoryVisit,
  type FactorySummaryRow,
} from "@/lib/supabase/reports";
import {
  formatOpsDateTime,
  opsLocalToInstant,
  opsNowLocalValue,
  OPS_TIMEZONE,
} from "@/lib/format";
import { Copy, Download, Check } from "lucide-react";

// Wialon's report screen was the reference for the shape of this: a
// Template selector over quick range buttons over an explicit From/To
// with minute precision.
//
// That Template selector was dropped when this page shipped, on the
// reasoning that one report needs no chooser. There are two now — the
// parc, and time at the Amouda plant — so it is back, and the range
// controls below it are shared because they mean the same thing to both.
// Wialon's Object selector stays dropped: there is one parc and one
// plant, so it would be a dropdown with a single option.

type Report = "parc" | "usine";
type UsineView = "detail" | "resume";
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

// H:MM:SS, matching the Wialon report the owner reads this against —
// "4:03:28", not "4h 3min". formatDuration elsewhere in the app rounds
// to the minute, which is right for an ETA and wrong for a figure
// someone is going to compare column by column against another report.
function hms(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const ZONE_LABEL: Record<FactoryVisit["zone_kind"], string> = {
  factory: "Attente",
  factory_loading: "Chargement",
};

// The two zones are told apart by their label, not by colour. Both are
// the factory, and the factory is one thing in the taxonomy — spending a
// second hue on the distinction would say they are different kinds of
// place rather than two parts of one.
const PARC_COLUMNS = ["Truck ID", "Driver", "Entry date"] as const;
const VISIT_COLUMNS = ["Truck ID", "Driver", "Zone", "Heure d'entrée", "Heure sortie", "Temps passé"] as const;
const SUMMARY_COLUMNS = ["Truck ID", "Driver", "Zone", "Passages", "Total", "Médiane", "Max"] as const;

function parcRows(entries: ParcEntry[]): string[][] {
  return entries.map((e) => [e.truck_id, e.driver_name || "—", formatOpsDateTime(e.entered_at)]);
}

function visitRows(visits: FactoryVisit[]): string[][] {
  return visits.map((v) => [
    v.truck_id,
    v.driver_name || "—",
    ZONE_LABEL[v.zone_kind] ?? v.zone_name,
    formatOpsDateTime(v.entered_at),
    v.exited_at ? formatOpsDateTime(v.exited_at) : "encore sur place",
    hms(v.seconds_in_zone),
  ]);
}

function summaryRows(rows: FactorySummaryRow[]): string[][] {
  return rows.map((r) => [
    r.truck_id,
    r.driver_name || "—",
    ZONE_LABEL[r.zone_kind] ?? r.zone_kind,
    String(r.visits),
    hms(r.total_seconds),
    hms(r.median_seconds),
    hms(r.max_seconds),
  ]);
}

// Tab-separated, because that is what spreadsheets expect from the
// clipboard — pasting comma-separated text into Excel or Sheets lands
// everything in one column.
function toClipboardText(columns: readonly string[], rows: string[][]): string {
  return [columns.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

function toCsv(columns: readonly string[], rows: string[][]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
}

/** Median of the values present, for the fleet-wide strip. Computed here
 *  rather than averaging the per-truck medians the RPC returns, which
 *  would weight a truck with one visit the same as one with twenty. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default function ReportsPage() {
  const [report, setReport] = useState<Report>("parc");
  const [usineView, setUsineView] = useState<UsineView>("detail");
  const [from, setFrom] = useState(() => startOfRange("today").from);
  const [to, setTo] = useState(() => startOfRange("today").to);

  const [entries, setEntries] = useState<ParcEntry[] | null>(null);
  const [visits, setVisits] = useState<FactoryVisit[] | null>(null);
  const [summary, setSummary] = useState<FactorySummaryRow[] | null>(null);

  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function applyQuickRange(range: QuickRange) {
    const r = startOfRange(range);
    setFrom(r.from);
    setTo(r.to);
  }

  // Switching template clears the result rather than leaving the other
  // report's rows on screen under a new heading, which would read as
  // this report having returned them.
  function switchReport(next: Report) {
    if (next === report) return;
    setReport(next);
    setEntries(null);
    setVisits(null);
    setSummary(null);
    setError(null);
    setCopied(false);
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

    if (report === "parc") {
      const result = await getParcEntries(fromIso, toIso);
      if (result.error) {
        setError(result.error);
        setEntries(null);
      } else {
        setEntries(result.data);
        setTruncated(result.truncated);
      }
    } else {
      // Both halves in one round trip: the strip is built from the
      // summary and is shown above either view, so fetching it only when
      // the Résumé tab is open would leave the strip empty on Détail.
      const [v, s] = await Promise.all([
        getFactoryVisits(fromIso, toIso),
        getFactorySummary(fromIso, toIso),
      ]);
      if (v.error || s.error) {
        setError(v.error ?? s.error);
        setVisits(null);
        setSummary(null);
      } else {
        setVisits(v.data);
        setSummary(s.data);
        setTruncated(v.truncated);
      }
    }
    setLoading(false);
  }

  function clear() {
    const r = startOfRange("today");
    setFrom(r.from);
    setTo(r.to);
    setEntries(null);
    setVisits(null);
    setSummary(null);
    setError(null);
    setCopied(false);
  }

  // What the export buttons act on: whichever table is actually on
  // screen. Exporting the detail while looking at the summary is the
  // kind of thing nobody notices until the figures are in a meeting.
  const active: { columns: readonly string[]; rows: string[][]; slug: string } =
    report === "parc"
      ? { columns: PARC_COLUMNS, rows: parcRows(entries ?? []), slug: "rapport-parc" }
      : usineView === "detail"
        ? { columns: VISIT_COLUMNS, rows: visitRows(visits ?? []), slug: "rapport-usine-detail" }
        : { columns: SUMMARY_COLUMNS, rows: summaryRows(summary ?? []), slug: "rapport-usine-resume" };

  async function copyTable() {
    if (active.rows.length === 0) return;
    try {
      await navigator.clipboard.writeText(toClipboardText(active.columns, active.rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not reach the clipboard — use Download CSV instead");
    }
  }

  function downloadCsv() {
    if (active.rows.length === 0) return;
    // ﻿ so Excel opens it as UTF-8; without it, accented driver
    // names arrive mangled.
    const blob = new Blob(["﻿" + toCsv(active.columns, active.rows)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.slug}_${from.replace(/[:T]/g, "-")}_${to.replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-sm)",
    padding: "6px 10px",
    color: "var(--text)",
    fontSize: ".82rem",
    fontFamily: "var(--font-mono)",
    // globals.css:393 makes every input width:100%, which is right for
    // the admin forms it was written for and wrong here: these two sit
    // in a flex row, so 100% resolved to the whole container and each
    // input rendered 1201px wide, pushing the page 21px past the
    // viewport at every width. The page has scrolled sideways since it
    // shipped — measuring it is the only way this shows up, because the
    // controls still look correct.
    width: "190px",
  };
  const monoCell: React.CSSProperties = { fontFamily: "var(--font-mono)", color: "var(--text-dim)" };
  const hasRun = report === "parc" ? entries !== null : visits !== null;

  // Fleet-wide figures for the strip, over closed visits only.
  const waitSecs = (summary ?? []).filter((r) => r.zone_kind === "factory");
  const loadSecs = (summary ?? []).filter((r) => r.zone_kind === "factory_loading");
  const medianWait = medianOf(waitSecs.map((r) => r.median_seconds).filter((n): n is number => n != null));
  const medianLoad = medianOf(loadSecs.map((r) => r.median_seconds).filter((n): n is number => n != null));
  const maxWait = waitSecs.reduce<number | null>(
    (a, r) => (r.max_seconds != null && (a == null || r.max_seconds > a) ? r.max_seconds : a),
    null
  );
  const trucksSeen = new Set((summary ?? []).map((r) => r.truck_id)).size;
  const plantVisits = waitSecs.reduce((a, r) => a + r.visits, 0);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold t-primary">
        {report === "parc" ? "Rapport Parc" : "Rapport Usine"}
      </h1>
      <p className="mt-1 text-sm t-dim">
        {report === "parc"
          ? "Trucks that entered PARC OMD — headquarters & parking."
          : "Time at Usine Amouda, split between the waiting area and the loading bay."}{" "}
        Times in Algeria local time ({OPS_TIMEZONE}).
      </p>

      <div className="panel mt-5 p-4">
        <div className="seg" style={{ width: "fit-content" }}>
          {(["parc", "usine"] as Report[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => switchReport(r)}
              className={`seg-item${report === r ? " is-active" : ""}`}
              aria-pressed={report === r}
            >
              {r === "parc" ? "Parc" : "Usine"}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {(["today", "yesterday", "week", "month"] as QuickRange[]).map((r) => (
            <button key={r} type="button" onClick={() => applyQuickRange(r)} className="btn-sm">
              {r === "week" ? "Last 7 days" : r === "month" ? "Last 30 days" : r === "today" ? "Today" : "Yesterday"}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs t-dim">From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs t-dim">To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} />
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={clear} className="btn-sm">Clear</button>
            <button
              type="button"
              onClick={execute}
              disabled={loading}
              className="btn-sm"
              style={{ background: "var(--accent)", borderColor: "var(--accent)", color: "var(--bg)" }}
            >
              {loading ? "Running…" : "Execute"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md p-3 text-sm tint-red c-red">{error}</div>
      )}

      {report === "usine" && summary && (
        <>
          {/* Amber is the taxonomy's idle, which is exactly what a truck
              in the waiting area is. Loading time stays achromatic: it is
              productive time, not a vehicle state, and green would claim
              a meaning the palette reserves for on-route and healthy. */}
          <div className="kpi-strip mt-5">
            <div className="kpi-card">
              <div className="kpi-value">{trucksSeen || "—"}</div>
              <div className="kpi-label">Camions</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{plantVisits || "—"}</div>
              <div className="kpi-label">Passages usine</div>
            </div>
            <div className="kpi-card amber">
              <div className="kpi-value">{hms(medianWait)}</div>
              <div className="kpi-label">Attente médiane</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{hms(medianLoad)}</div>
              <div className="kpi-label">Chargement médian</div>
            </div>
            <div className="kpi-card amber">
              <div className="kpi-value">{hms(maxWait)}</div>
              <div className="kpi-label">Attente la plus longue</div>
            </div>
          </div>

          <div className="seg mt-4" style={{ width: "fit-content" }}>
            {(["detail", "resume"] as UsineView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setUsineView(v); setCopied(false); }}
                className={`seg-item${usineView === v ? " is-active" : ""}`}
                aria-pressed={usineView === v}
              >
                {v === "detail" ? "Détail" : "Résumé"}
              </button>
            ))}
          </div>
        </>
      )}

      {hasRun && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm t-dim">
              {active.rows.length}{" "}
              {report === "parc"
                ? active.rows.length === 1 ? "entry" : "entries"
                : usineView === "detail"
                  ? active.rows.length === 1 ? "passage" : "passages"
                  : active.rows.length === 1 ? "ligne" : "lignes"}
              {truncated && usineView === "detail" && " (showing the first 5000 — narrow the range)"}
            </span>
            {active.rows.length > 0 && (
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

          {active.rows.length === 0 ? (
            <p className="mt-8 text-center text-sm t-dim">
              {report === "parc"
                ? "No trucks entered the parc in this period."
                : "No truck entered either plant zone in this period."}
            </p>
          ) : report === "parc" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>{PARC_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {entries!.map((e) => (
                    <tr key={e.id}>
                      <td className="truck-id">{e.truck_id}</td>
                      <td style={{ color: e.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {e.driver_name || "—"}
                      </td>
                      <td style={monoCell}>{formatOpsDateTime(e.entered_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : usineView === "detail" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>{VISIT_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {visits!.map((v, i) => {
                    // A truck's rows are contiguous — the RPC orders by
                    // truck then entry — so the first row of each group
                    // takes a top border. Against the row above's bottom
                    // border that reads as one heavier rule, which is
                    // enough to separate trucks without a second colour
                    // or a header row. Over a day it is a nicety; over
                    // "Last 30 days" it is the difference between a
                    // table and a wall.
                    const newTruck = i > 0 && visits![i - 1].truck_id !== v.truck_id;
                    const group: React.CSSProperties = newTruck
                      ? { borderTop: "1px solid var(--line)" }
                      : {};
                    return (
                      <tr key={`${v.truck_id}-${v.zone_kind}-${v.entered_at}-${i}`}>
                        <td className="truck-id" style={group}>{v.truck_id}</td>
                        <td style={{ ...group, color: v.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                          {v.driver_name || "—"}
                        </td>
                        <td style={group}>{ZONE_LABEL[v.zone_kind] ?? v.zone_name}</td>
                        <td style={{ ...monoCell, ...group }}>{formatOpsDateTime(v.entered_at)}</td>
                        {/* An open visit says so rather than showing a
                            blank, which reads as missing data, or a zero,
                            which reads as a truck that never stayed. */}
                        <td style={{ ...monoCell, ...group }}>
                          {v.exited_at ? formatOpsDateTime(v.exited_at) : <span className="t-faint">encore sur place</span>}
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", ...group }}>{hms(v.seconds_in_zone)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>{SUMMARY_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {summary!.map((r) => (
                    <tr key={`${r.truck_id}-${r.zone_kind}`}>
                      <td className="truck-id">{r.truck_id}</td>
                      <td style={{ color: r.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {r.driver_name || "—"}
                      </td>
                      <td>{ZONE_LABEL[r.zone_kind] ?? r.zone_kind}</td>
                      <td style={monoCell}>
                        {r.visits}
                        {/* Only worth saying when they differ: it is why
                            the medianes beside it are over fewer visits
                            than the count suggests. */}
                        {r.closed_visits < r.visits && (
                          <span className="t-faint"> ({r.closed_visits} terminés)</span>
                        )}
                      </td>
                      <td style={monoCell}>{hms(r.total_seconds)}</td>
                      <td style={{ fontFamily: "var(--font-mono)" }}>{hms(r.median_seconds)}</td>
                      <td style={monoCell}>{hms(r.max_seconds)}</td>
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
