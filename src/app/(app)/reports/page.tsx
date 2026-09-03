"use client";

import { Fragment, useEffect, useState } from "react";
import {
  getParcEntries,
  getGeoVisits,
  getGeoTotals,
  getReportableTrucks,
  type ParcEntry,
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
import TruckCombobox from "@/components/forms/TruckCombobox";

// Wialon's report screen was the reference for the shape of this: a
// Template selector over quick range buttons over an explicit From/To
// with minute precision.
//
// That Template selector was dropped when this page shipped, on the
// reasoning that one report needs no chooser. There are two — the parc,
// and one truck's own movements across every zone — so it is back, and
// the range controls below it are shared because they mean the same
// thing to both.
//
// Rapport Usine sat here too until the owner dropped it on 2026-09-01:
// Geo answers the same question per truck and reads the plant's two
// zones from the same zone_visits rows, so the fleet-wide version was
// a second view nobody opened. The LOGGING it depended on stays — Geo's
// Attente and Chargement rows are exactly those rows — and so do the
// factory_zone_* RPCs, which are simply no longer called.
//
// Wialon's Object selector was dropped too, because there is one parc
// and one plant and it would have been a dropdown with a single option.
// Geo brings it back for that template alone: the whole question it
// answers is "where did THIS truck spend its time", so the truck is not
// a filter over the report, it is the report's subject.
type Report = "parc" | "geo";
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

// Zones are told apart by their label, not by colour. The plant's two
// are one thing in the taxonomy — spending a second hue on the
// distinction would say they are different kinds of place rather than
// two parts of one.
const PARC_COLUMNS = ["Truck ID", "Driver", "Entry date"] as const;
// The owner's Wialon export — zone, entrée, sortie, temps — plus three
// columns it does not have.
//
// Type, because a client site and the two plant zones interleave here
// and the names alone do not say which is which at a glance.
//
// Driver, because the question being asked is about a person as much as
// a vehicle. It is stamped per visit rather than resolved now, so a
// truck that changed hands mid-period shows both names on the rows they
// actually drove.
//
// Avant chargement was REMOVED on 2026-09-03 at the owner's request —
// he does not use the figure. Nothing was dropped from the database to
// do it: geo_zone_visits still computes queue_seconds and it still
// arrives on GeoVisit, so restoring the column is an edit to this array
// and one cell, with no migration.
const GEO_COLUMNS = [
  "Zone", "Type", "Driver", "Heure d'entrée", "Heure sortie", "Temps passé",
] as const;

// The per-row copy button is spliced into the HEADER after this column,
// and into the body in the matching place. It is a control rather than
// data, so it deliberately stays out of GEO_COLUMNS — that array is what
// Copy table and Download CSV write, and an extra empty field would land
// in every exported row.
const GEO_COPY_AFTER = "Heure sortie";

const GEO_ZONE_LABEL: Record<GeoVisit["zone_kind"], string> = {
  factory: "Attente",
  factory_loading: "Chargement",
  site: "Client",
};

function geoRows(visits: GeoVisit[]): string[][] {
  return visits.map((v) => [
    v.zone_name,
    GEO_ZONE_LABEL[v.zone_kind],
    v.driver_name || "—",
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
  const [from, setFrom] = useState(() => startOfRange("today").from);
  const [to, setTo] = useState(() => startOfRange("today").to);

  const [entries, setEntries] = useState<ParcEntry[] | null>(null);

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
  // Keyed by row rather than a boolean: two rows copied in quick
  // succession must not leave the tick sitting on the first one.
  const [copiedRow, setCopiedRow] = useState<string | null>(null);

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
      // Both together: the strip sits above the table and describes the
      // same answer, so a second round trip would show a filled table
      // over an empty strip.
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
    } else {
      const result = await getParcEntries(fromIso, toIso);
      if (result.error) {
        setError(result.error);
        setEntries(null);
      } else {
        setEntries(result.data);
        setTruncated(result.truncated);
      }
    }
    setLoading(false);
  }

  function clear() {
    const r = startOfRange("today");
    setFrom(r.from);
    setTo(r.to);
    setEntries(null);
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
      : { columns: PARC_COLUMNS, rows: parcRows(entries ?? []), slug: "rapport-parc" };

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

  // One row's two timestamps, and nothing else — the owner pastes them
  // into his own sheet beside the Wialon figures.
  //
  // Tab-separated for the same reason toClipboardText is: a tab lands
  // entrée and sortie in two cells in Excel or Sheets, where a comma
  // lands them in one. An OPEN visit copies its entry and an empty
  // second cell, matching what Download CSV writes for that row — the
  // truck has not left, and copying the words on screen ("encore sur
  // place") would paste a sentence into a date column.
  async function copyRowTimes(v: GeoVisit, key: string) {
    const text = [
      formatOpsDateTime(v.entered_at),
      v.exited_at ? formatOpsDateTime(v.exited_at) : "",
    ].join("\t");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRow(key);
      // Clears only if this row is still the one showing the tick, so a
      // later copy's confirmation cannot be cancelled by an earlier timer.
      setTimeout(() => setCopiedRow((current) => (current === key ? null : current)), 2000);
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
  // NO nowrap here, and that is a measured decision rather than an
  // oversight. The timestamps wrap into date-over-time, and pinning them
  // with nowrap looked like the fix and made it worse: the zone column
  // absorbed the squeeze and went to three lines, taking rows from 65px
  // to 107px. Measured at 1366 over the six real rows of 00033-523-35 on
  // 2026-09-01, when Avant chargement was still here and the table was
  // therefore WIDER than it is now:
  //
  //   all wrap (this)     65px rows, 443px table, no h-scroll
  //   timestamps nowrap  107px rows, 572px table, no h-scroll
  //   everything nowrap   44px rows, 301px table, SCROLLS (1289 > 1102)
  //
  // Dropping Avant chargement on 2026-09-03 and adding the copy control
  // in its place only took width OUT — a 13px glyph for a column that
  // held "0:37:18" under a sixteen-character heading — so the wrapping
  // choice still holds and the scroll margin is strictly wider than the
  // numbers above. CLAUDE.md's density rule is about dispatch fitting
  // forty trucks on one screen; this is a per-truck report showing a
  // handful of rows a day, so legibility with nothing hidden wins.
  const monoCell: React.CSSProperties = { fontFamily: "var(--font-mono)", color: "var(--text-dim)" };
  // The copy column's heading is empty to the eye but not to a screen
  // reader, which would otherwise announce an unlabelled column.
  const srOnly: React.CSSProperties = {
    position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
  };
  const hasRun = report === "parc" ? entries !== null : geoVisits !== null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold t-primary">
        {report === "parc" ? "Rapport Parc" : report === "geo" ? "Rapport Geo" : "Rapport Usine"}
      </h1>
      <p className="mt-1 text-sm t-dim">
        {report === "parc"
          ? "Trucks that entered PARC OMD — headquarters & parking."
          : "One truck, every zone it entered — the plant's waiting area and loading bay alongside the client sites."}{" "}
        Times in Algeria local time ({OPS_TIMEZONE}).
      </p>
      {/* Said once, plainly, because Attente is the figure a reader is
          most likely to take for something it is not — and it matters
          more here than it did on the old fleet-wide report, because
          the two rows sit next to each other in one table and look like
          consecutive stages. They overlap: the bay is drawn INSIDE the
          waiting area, so a truck at the pump is in both zones at once
          and its Attente row spans the whole stay. Adding the two
          durations together double-counts the loading. */}
      {report === "geo" && (
        <p className="mt-1 text-xs t-faint">
          The loading bay sits inside the waiting area, so an <strong>Attente</strong> row is the
          whole stay at the plant — loading included, not the wait before it. Its window contains the{" "}
          <strong>Chargement</strong> row rather than running before it, so the two do not add up.
        </p>
      )}

      <div className="panel mt-5 p-4">
        <div className="seg" style={{ width: "fit-content" }}>
          {(["parc", "geo"] as Report[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => switchReport(r)}
              className={`seg-item${report === r ? " is-active" : ""}`}
              aria-pressed={report === r}
            >
              {r === "parc" ? "Parc" : "Geo"}
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
            <div className="flex flex-col gap-1">
              {/* A plain <span>, not a <label>: the combobox owns its
                  own input and a label pointing at a wrapper would
                  associate with nothing. The input carries the
                  placeholder that names it. */}
              <span className="text-xs t-dim">Truck</span>
              <TruckCombobox
                trucks={trucks}
                value={truckId}
                onChange={(id) => { setTruckId(id); setError(null); }}
                style={{ width: "240px" }}
              />
            </div>
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

      {hasRun && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm t-dim">
              {active.rows.length}{" "}
              {report === "parc"
                ? active.rows.length === 1 ? "entry" : "entries"
                : active.rows.length === 1 ? "passage" : "passages"}
              {truncated && " (showing the first 5000 — narrow the range)"}
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
                : `${truckId} entered no zone in this period.`}
            </p>
          ) : report === "geo" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>
                    {GEO_COLUMNS.map((c) => (
                      <Fragment key={c}>
                        <th>{c}</th>
                        {c === GEO_COPY_AFTER && (
                          <th><span style={srOnly}>Copier les heures</span></th>
                        )}
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {geoVisits!.map((v, i) => {
                    // entered_at is not unique on its own: the waiting
                    // area and the loading bay can both be entered on
                    // the same tick, and both carry that tick's
                    // timestamp to the millisecond.
                    const rowKey = `${v.zone_kind}-${v.entered_at}-${i}`;
                    return (
                    <tr key={rowKey}>
                      <td>{v.zone_name}</td>
                      <td style={{ color: "var(--text-dim)" }}>{GEO_ZONE_LABEL[v.zone_kind]}</td>
                      <td style={{ color: v.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {v.driver_name || "—"}
                      </td>
                      <td style={monoCell}>{formatOpsDateTime(v.entered_at)}</td>
                      <td style={monoCell}>
                        {v.exited_at ? formatOpsDateTime(v.exited_at) : "encore sur place"}
                      </td>
                      {/* Directly after the pair it copies, rather than at
                          the end of the row: a control in the last column
                          reads as acting on the whole row, and this one
                          takes the two timestamps to its left and nothing
                          else. Achromatic on purpose — .icon-ghost is
                          chrome, and every hue here belongs to a truck
                          state. */}
                      <td style={{ width: "1%", whiteSpace: "nowrap" }}>
                        <button
                          type="button"
                          onClick={() => copyRowTimes(v, rowKey)}
                          className="icon-ghost"
                          title="Copier entrée + sortie"
                          aria-label={`Copier l'heure d'entrée et l'heure de sortie — ${v.zone_name}`}
                        >
                          {copiedRow === rowKey ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </td>
                      <td style={monoCell}>{hms(v.seconds_in_zone)}</td>
                    </tr>
                    );
                  })}
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
          ) : null}
        </div>
      )}
    </div>
  );
}
