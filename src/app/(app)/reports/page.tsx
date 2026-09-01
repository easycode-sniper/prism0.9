"use client";

import { useEffect, useState } from "react";
import {
  getParcEntries,
  getFactoryVisits,
  getFactorySummary,
  getFactoryTotals,
  getGeoVisits,
  getGeoTotals,
  getReportableTrucks,
  type ParcEntry,
  type FactoryVisit,
  type FactorySummaryRow,
  type FactoryTotals,
  type GeoVisit,
  type GeoTotalRow,
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
// reasoning that one report needs no chooser. There are three now — the
// parc, time at the Amouda plant fleet-wide, and one truck's own
// movements across every zone — so it is back, and the range controls
// below it are shared because they mean the same thing to all three.
//
// Wialon's Object selector was dropped too, because there is one parc
// and one plant and it would have been a dropdown with a single option.
// Geo brings it back for that template alone: the whole question it
// answers is "where did THIS truck spend its time", so the truck is not
// a filter over the report, it is the report's subject.
type Report = "parc" | "usine" | "geo";
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
const VISIT_COLUMNS = [
  "Truck ID", "Driver", "Zone", "Heure d'entrée", "Heure sortie", "Temps passé", "Avant chargement",
] as const;
const SUMMARY_COLUMNS = [
  "Truck ID", "Driver", "Zone", "Passages", "Total", "Médiane", "Max", "Avant chargement",
] as const;

// The owner's Wialon export verbatim — zone, entrée, sortie, temps —
// plus Type, because in this table a client site and the two plant
// zones interleave and the zone names alone do not say which is which
// at a glance.
const GEO_COLUMNS = ["Zone", "Type", "Heure d'entrée", "Heure sortie", "Temps passé"] as const;

const GEO_ZONE_LABEL: Record<GeoVisit["zone_kind"], string> = {
  factory: "Attente",
  factory_loading: "Chargement",
  site: "Client",
};

function geoRows(visits: GeoVisit[]): string[][] {
  return visits.map((v) => [
    v.zone_name,
    GEO_ZONE_LABEL[v.zone_kind],
    formatOpsDateTime(v.entered_at),
    // An open visit is blank rather than a dash: the truck has not left,
    // so there is no time to report, and inventing one would be read as
    // a zero-length stay. Same rule the Attente rows follow.
    v.exited_at ? formatOpsDateTime(v.exited_at) : "",
    v.seconds_in_zone == null ? "" : hms(v.seconds_in_zone),
  ]);
}

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
    // Blank, not a dash, on an Attente row — matching the table, and
    // because an empty spreadsheet cell reads as "not applicable" while
    // a dash reads as a value that failed to arrive.
    v.zone_kind === "factory_loading" ? hms(v.queue_seconds) : "",
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
    r.zone_kind === "factory_loading" ? hms(r.median_queue_seconds) : "",
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

export default function ReportsPage() {
  const [report, setReport] = useState<Report>("parc");
  const [usineView, setUsineView] = useState<UsineView>("detail");
  const [from, setFrom] = useState(() => startOfRange("today").from);
  const [to, setTo] = useState(() => startOfRange("today").to);

  const [entries, setEntries] = useState<ParcEntry[] | null>(null);
  const [visits, setVisits] = useState<FactoryVisit[] | null>(null);
  const [summary, setSummary] = useState<FactorySummaryRow[] | null>(null);
  const [totals, setTotals] = useState<FactoryTotals | null>(null);

  const [trucks, setTrucks] = useState<{ truck_id: string; name: string | null }[]>([]);
  const [truckId, setTruckId] = useState("");
  const [geoVisits, setGeoVisits] = useState<GeoVisit[] | null>(null);
  const [geoTotals, setGeoTotals] = useState<GeoTotalRow[] | null>(null);

  // Fetched once on mount rather than when Geo is selected: the list is
  // ~40 rows, and loading it on switch would put a spinner inside the
  // selector at the moment someone reaches for it.
  useEffect(() => {
    let cancelled = false;
    getReportableTrucks().then((result) => {
      if (cancelled || result.error) return;
      setTrucks(result.data);
    });
    return () => { cancelled = true; };
  }, []);

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
    setTotals(null);
    setGeoVisits(null);
    setGeoTotals(null);
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

    if (report === "geo") {
      // Both together for the reason the Usine branch fetches three: the
      // strip sits above the table and describes the same answer, so a
      // second round trip would show a filled table over an empty strip.
      const [v, t] = await Promise.all([
        getGeoVisits(truckId, fromIso, toIso),
        getGeoTotals(truckId, fromIso, toIso),
      ]);
      if (v.error || t.error) {
        setError(v.error ?? t.error);
        setGeoVisits(null);
        setGeoTotals(null);
      } else {
        setGeoVisits(v.data);
        setGeoTotals(t.data);
        setTruncated(v.truncated);
      }
    } else if (report === "parc") {
      const result = await getParcEntries(fromIso, toIso);
      if (result.error) {
        setError(result.error);
        setEntries(null);
      } else {
        setEntries(result.data);
        setTruncated(result.truncated);
      }
    } else {
      // All three together: the strip sits above both views, so fetching
      // the totals only when Résumé is open would leave it empty on
      // Détail, and the two tables are a tab switch apart — fetching on
      // switch would put a spinner between two views of one answer.
      const [v, s, t] = await Promise.all([
        getFactoryVisits(fromIso, toIso),
        getFactorySummary(fromIso, toIso),
        getFactoryTotals(fromIso, toIso),
      ]);
      if (v.error || s.error || t.error) {
        setError(v.error ?? s.error ?? t.error);
        setVisits(null);
        setSummary(null);
        setTotals(null);
      } else {
        setVisits(v.data);
        setSummary(s.data);
        setTotals(t.data);
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
    setTotals(null);
    setGeoVisits(null);
    setGeoTotals(null);
    setError(null);
    setCopied(false);
  }

  // What the export buttons act on: whichever table is actually on
  // screen. Exporting the detail while looking at the summary is the
  // kind of thing nobody notices until the figures are in a meeting.
  const active: { columns: readonly string[]; rows: string[][]; slug: string } =
    report === "geo"
      ? {
          columns: GEO_COLUMNS,
          rows: geoRows(geoVisits ?? []),
          // The truck in the filename, because these get saved per truck
          // and a folder of identically named files is unusable.
          slug: `rapport-geo-${truckId || "truck"}`,
        }
      : report === "parc"
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
  const hasRun =
    report === "parc" ? entries !== null : report === "geo" ? geoVisits !== null : visits !== null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold t-primary">
        {report === "parc" ? "Rapport Parc" : report === "geo" ? "Rapport Geo" : "Rapport Usine"}
      </h1>
      <p className="mt-1 text-sm t-dim">
        {report === "parc"
          ? "Trucks that entered PARC OMD — headquarters & parking."
          : report === "geo"
            ? "One truck, every zone it entered — the plant's waiting area and loading bay alongside the client sites."
            : "Time at Usine Amouda, split between the waiting area and the loading bay."}{" "}
        Times in Algeria local time ({OPS_TIMEZONE}).
      </p>
      {/* Said once, plainly, because the Attente figure is the one a
          reader is most likely to take for something it is not. The bay
          is drawn inside the waiting area, so an Attente row's duration
          counts the loading too — "Avant chargement" is the wait on its
          own. */}
      {report === "usine" && (
        <p className="mt-1 text-xs t-faint">
          The loading bay sits inside the waiting area, so an <strong>Attente</strong> duration is the
          whole stay at the plant, loading included. <strong>Avant chargement</strong> is arrival to
          the start of loading — the wait on its own.
        </p>
      )}

      <div className="panel mt-5 p-4">
        <div className="seg" style={{ width: "fit-content" }}>
          {(["parc", "usine", "geo"] as Report[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => switchReport(r)}
              className={`seg-item${report === r ? " is-active" : ""}`}
              aria-pressed={report === r}
            >
              {r === "parc" ? "Parc" : r === "usine" ? "Usine" : "Geo"}
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
          {/* First in the row, before the dates, because it is the
              subject of the report rather than another filter on it —
              and because leaving it empty is the one thing that makes
              Execute fail. */}
          {report === "geo" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs t-dim">Truck</span>
              <select
                value={truckId}
                onChange={(e) => setTruckId(e.target.value)}
                style={{ ...inputStyle, width: "220px" }}
              >
                <option value="">Choose a truck…</option>
                {trucks.map((t) => (
                  <option key={t.truck_id} value={t.truck_id}>
                    {t.name ? `${t.truck_id} — ${t.name}` : t.truck_id}
                  </option>
                ))}
              </select>
            </label>
          )}
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

      {report === "geo" && geoTotals && geoTotals.length > 0 && (
        // One card per zone actually visited, so the strip is as long as
        // the truck's day rather than a fixed set of slots — a truck
        // that never reached a client site should not be shown an empty
        // "Client" figure implying the data is missing.
        //
        // Amber on the waiting area only: that is the taxonomy's idle,
        // and a truck queueing at the plant is precisely idle. Loading
        // and time on a client site stay achromatic — both are
        // productive time, and green would claim the palette's
        // "moving, on-route" for something standing still.
        <div
          className="kpi-strip mt-5"
          style={{ gridTemplateColumns: `repeat(${Math.min(geoTotals.length, 4)}, minmax(0, 1fr))` }}
        >
          {geoTotals.map((t) => (
            <div
              key={`${t.zone_kind}-${t.site_id ?? "plant"}`}
              className={`kpi-card${t.zone_kind === "factory" ? " amber" : ""}`}
            >
              <div className="kpi-value">{hms(t.total_seconds)}</div>
              <div className="kpi-label" title={t.zone_name}>
                {GEO_ZONE_LABEL[t.zone_kind]} · {t.visits} {t.visits === 1 ? "passage" : "passages"}
              </div>
            </div>
          ))}
        </div>
      )}

      {report === "usine" && totals && (
        <>
          {/* Amber is the taxonomy's idle, which is exactly what a truck
              in the waiting area is. Loading time stays achromatic: it is
              productive time, not a vehicle state, and green would claim
              a meaning the palette reserves for on-route and healthy. */}
          {/* .kpi-strip is a fixed five-column grid because the
              dashboard needs exactly five. This report has six figures
              and the class is shared, so the extra column is an override
              here rather than a change to the rule. */}
          <div className="kpi-strip mt-5" style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
            <div className="kpi-card">
              <div className="kpi-value">{totals.trucks || "—"}</div>
              <div className="kpi-label">Camions</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{totals.plant_visits || "—"}</div>
              <div className="kpi-label">Passages</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{hms(totals.median_presence)}</div>
              <div className="kpi-label">Présence médiane</div>
            </div>
            <div className="kpi-card amber">
              <div className="kpi-value">{hms(totals.median_queue)}</div>
              <div className="kpi-label">Avant chargement</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-value">{hms(totals.median_load)}</div>
              <div className="kpi-label">Chargement médian</div>
            </div>
            <div className="kpi-card amber">
              <div className="kpi-value">{hms(totals.max_presence)}</div>
              <div className="kpi-label">Présence max</div>
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
                : report === "geo"
                  ? `${truckId} entered no zone in this period.`
                  : "No truck entered either plant zone in this period."}
            </p>
          ) : report === "geo" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>{GEO_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {geoVisits!.map((v, i) => (
                    // entered_at is not unique on its own: the waiting
                    // area and the loading bay can both be entered on
                    // the same tick, and both carry that tick's
                    // timestamp to the millisecond.
                    <tr key={`${v.zone_kind}-${v.entered_at}-${i}`}>
                      <td>{v.zone_name}</td>
                      <td style={{ color: "var(--text-dim)" }}>{GEO_ZONE_LABEL[v.zone_kind]}</td>
                      <td style={monoCell}>{formatOpsDateTime(v.entered_at)}</td>
                      <td style={monoCell}>
                        {v.exited_at ? formatOpsDateTime(v.exited_at) : "encore sur place"}
                      </td>
                      <td style={monoCell}>{hms(v.seconds_in_zone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                        {/* Only a loading row can have one — it is the
                            gap back to the enclosing waiting entry. On
                            an Attente row the cell is blank rather than
                            a dash, because a dash there would read as a
                            missing value rather than an inapplicable
                            one. Amber: this is queueing, which is idle. */}
                        <td style={{ ...group, fontFamily: "var(--font-mono)", color: "var(--amber)" }}>
                          {v.zone_kind === "factory_loading" ? hms(v.queue_seconds) : ""}
                        </td>
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
                      <td style={{ fontFamily: "var(--font-mono)", color: "var(--amber)" }}>
                        {r.zone_kind === "factory_loading" ? hms(r.median_queue_seconds) : ""}
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
