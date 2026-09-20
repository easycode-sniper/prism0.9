"use client";

import { Fragment, useEffect, useState } from "react";
import {
  getParcEntries,
  getGeoVisits,
  getGeoTotals,
  getReportableTrucks,
  getFleetSiteVisits,
  getFleetSiteTotals,
  getFleetLoadingVisits,
  getFleetLoadingTotals,
  getVoyageReport,
  getTruckDistances,
  type ParcEntry,
  type GeoVisit,
  type GeoTotalRow,
  type FleetSiteVisit,
  type FleetSiteTotalRow,
  type FleetLoadingVisit,
  type FleetLoadingTotalRow,
  type VoyageRow,
} from "@/lib/supabase/reports";
import {
  formatOpsDateTime,
  opsLocalToInstant,
  opsNowLocalValue,
  OPS_TIMEZONE,
  signedClass,
  signedValue,
  consumptionClassAgainst,
} from "@/lib/format";
import { UNLOADED_MIN_SECONDS } from "@/lib/constants";
import { ASSUMED_L_PER_100KM } from "@/lib/fuel/parse";
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
// Livraisons was added 2026-09-07: the same zone_visits log as Geo, read
// across the fleet with the plant left out. It is the fleet-wide report
// Rapport Usine used to be and is not a revival of it — Usine asked what
// the whole fleet did AT AMOUDA and could not see a client site, which
// is the exact half this one keeps.
//
// Chargements was added 2026-09-14, asked for as "the counter to
// Livraisons": the same fleet-wide read of the same log, at the plant
// end of the trip instead of the client end. It is not the old Rapport
// Usine coming back — that one showed the waiting area and the loading
// bay as two overlapping rows per stay, which is what made it
// unreadable. This shows the bay only, one row per load, with the wait
// folded into a column of that row.
type Report = "parc" | "geo" | "livraisons" | "chargements" | "voyages";
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
// What Copy table and Download CSV write for the parc — nothing more.
// The two look-only columns — Model (derived from the plate by
// truck_model) and Distance, whose window the toggle above the table
// sets — stay OFF-screen-off-the-page: Model is the owner's on-eye
// filter, Distance is his way of telling a fresh arrival from an
// errand, and neither belongs in a spreadsheet he pastes into his own
// records. Like the copy button staying out of GEO_COLUMNS, the arrays
// row builders READ are the screen's, and the exports are what this
// constant is.
//
// The on-screen columns are Model + these three, with Distance (24h)
// appended per-run because its header must name the window:
const PARC_SCREEN_COLUMNS = ["Model", ...PARC_COLUMNS] as const;
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

// Truck first, because the question is "where did each truck deliver"
// and the rows arrive grouped that way. Client sits under the site
// rather than beside it in the table, but stays its own column here —
// the export is read in a spreadsheet, where a merged cell is worse
// than a repeated one.
const LIV_COLUMNS = [
  "Truck ID", "Driver", "Site", "Client", "Heure d'entrée", "Heure sortie", "Temps passé",
] as const;

// No Zone column: there is one loading bay and a column repeating its
// name 300 times is width spent on a constant. It is named in the
// sentence under the heading instead, and carried on every row of the
// RPC so a second bay would have somewhere to appear.
//
// Avant chargement LAST, after the load's own times, because it is the
// figure that qualifies them rather than another timestamp to read in
// sequence: fifty minutes under the spout after ten minutes of queue and
// after three hours are different days.
const CHARG_COLUMNS = [
  "Truck ID", "Driver", "Heure d'entrée", "Heure sortie", "Temps de chargement", "Avant chargement",
] as const;

// The owner's order, from the CSV he specified it with, and it is the
// order the question is asked in: which truck, who drove it, what it
// cost, how far, how much fuel, at what rate, how far off the assumed
// rate that put it — and then the number the report exists for.
//
// Number of voyages LAST despite being the subject, because the seven
// columns before it are what make it mean anything: nine voyages on
// 42 L/100km and nine on 52 are different weeks.
const VOYAGE_COLUMNS = [
  "Truck ID", "Driver", "Amount (DA)", "Distance (km)", "Litres",
  "L/100km", "Variance (DA)", "Voyages",
] as const;

const nfr = (v: number) => v.toLocaleString("en-GB");

function voyageRows(rows: VoyageRow[]): string[][] {
  return rows.map((r) => [
    r.truck_id,
    // The whole list in the export. On screen the extra names collapse
    // to a "+2" the reader can hover; a spreadsheet has no hover, and a
    // truncated name there is the kind of thing that gets pasted into a
    // meeting.
    r.drivers,
    nfr(r.amount_da),
    nfr(r.km),
    nfr(r.litres),
    r.litres_per_100km == null ? "" : r.litres_per_100km.toFixed(2),
    nfr(r.variance_da),
    // Spelled out rather than left blank: a blank cell in a spreadsheet
    // is indistinguishable from a zero somebody deleted.
    r.voyages == null ? "Not available" : String(r.voyages),
  ]);
}

function chargRows(visits: FleetLoadingVisit[]): string[][] {
  return visits.map((v) => [
    v.truck_id,
    v.driver_name || "—",
    formatOpsDateTime(v.entered_at),
    // Blank, not a dash, on an open load: the truck has not left, so
    // there is no time to report. Same rule Livraisons and Geo follow.
    v.exited_at ? formatOpsDateTime(v.exited_at) : "",
    v.seconds_loading == null ? "" : hms(v.seconds_loading),
    // Blank rather than 0 where nothing encloses the load — the wait is
    // unknown, not zero, and a 0 in a spreadsheet column of durations is
    // read as "went straight in".
    v.queue_seconds == null ? "" : hms(v.queue_seconds),
  ]);
}

function livRows(visits: FleetSiteVisit[]): string[][] {
  return visits.map((v) => [
    v.truck_id,
    v.driver_name || "—",
    v.zone_name,
    v.client_name || "—",
    formatOpsDateTime(v.entered_at),
    // Blank, not a dash: the truck has not left, so there is no time to
    // report and inventing one reads as a zero-length delivery. Same
    // rule Geo's open rows follow.
    v.exited_at ? formatOpsDateTime(v.exited_at) : "",
    v.seconds_on_site == null ? "" : hms(v.seconds_on_site),
  ]);
}

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
  // The EXPORT shape: Truck ID / Driver / Entry date, and nothing else.
  // The screen's Model and Distance columns are look-only (073) and are
  // deliberately not carried into the clipboard or the CSV — see the
  // comment above PARC_COLUMNS.
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

  // The parc report's discriminator: how far each truck drove, which is
  // how the owner tells a truck back from a long run from one that
  // slipped out for an hour. The window is a choice (2h/12h/24h),
  // because a truck back from a long run is a different statement at
  // each resolution — 600 km says "got here" whether the window is 2
  // hours or 24, but an errand reads ~1 km across all of them and the
  // 12h figure is the one that separates "headed out an hour ago" from
  // "been gone since yesterday".
  const [distWindow, setDistWindow] = useState<"2h" | "12h" | "24h">("24h");
  const distHours = (w: "2h" | "12h" | "24h") => (w === "2h" ? 2 : w === "12h" ? 12 : 24);
  // truck_id → km, or null before the first run. Absent key = truck
  // never heard from in the window, printed as a dash.
  const [distances, setDistances] = useState<Record<string, number> | null>(null);

  const [trucks, setTrucks] = useState<{ truck_id: string; name: string | null }[]>([]);
  const [truckId, setTruckId] = useState("");
  const [geoVisits, setGeoVisits] = useState<GeoVisit[] | null>(null);
  const [geoTotals, setGeoTotals] = useState<GeoTotalRow[] | null>(null);

  const [livVisits, setLivVisits] = useState<FleetSiteVisit[] | null>(null);
  const [livTotals, setLivTotals] = useState<FleetSiteTotalRow[] | null>(null);

  const [chargVisits, setChargVisits] = useState<FleetLoadingVisit[] | null>(null);
  const [chargTotals, setChargTotals] = useState<FleetLoadingTotalRow[] | null>(null);

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

  // The flag AND the real number. The flag alone could only say "some
  // rows are missing"; the count comes from Postgres over the whole
  // matching set, so the notice can say how many there actually were.
  const [voyages, setVoyages] = useState<VoyageRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [total, setTotal] = useState(0);
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
    setDistances(null);
    setGeoVisits(null);
    setGeoTotals(null);
    setLivVisits(null);
    setLivTotals(null);
    setChargVisits(null);
    setChargTotals(null);
    setVoyages(null);
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

    if (report === "voyages") {
      // One round trip: the RPC already joins the fuel sheet to the zone
      // log, so there is no summary strip that could disagree with the
      // table under it.
      const result = await getVoyageReport(fromIso, toIso);
      if (result.error) {
        setError(result.error);
        setVoyages(null);
      } else {
        setVoyages(result.data);
        setTruncated(result.truncated);
        setTotal(result.total);
      }
    } else if (report === "livraisons") {
      // Both together, for the reason Geo fetches both together: the
      // strip describes the same answer as the table, and a second round
      // trip would paint a filled table over an empty strip.
      const [v, t] = await Promise.all([
        getFleetSiteVisits(fromIso, toIso),
        getFleetSiteTotals(fromIso, toIso),
      ]);
      if (v.error || t.error) {
        setError(v.error ?? t.error);
        setLivVisits(null);
        setLivTotals(null);
      } else {
        setLivVisits(v.data);
        setLivTotals(t.data);
        setTruncated(v.truncated);
        setTotal(v.total);
      }
    } else if (report === "chargements") {
      // Both together, for the reason Livraisons fetches both together:
      // the strip describes the same answer as the table under it.
      const [v, t] = await Promise.all([
        getFleetLoadingVisits(fromIso, toIso),
        getFleetLoadingTotals(fromIso, toIso),
      ]);
      if (v.error || t.error) {
        setError(v.error ?? t.error);
        setChargVisits(null);
        setChargTotals(null);
      } else {
        setChargVisits(v.data);
        setChargTotals(t.data);
        setTruncated(v.truncated);
        setTotal(v.total);
      }
    } else if (report === "geo") {
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
        setTotal(v.total);
      }
    } else {
      // Entries and the distance column together: the two describe the
      // same truck set and a second round trip would paint the table
      // without the figures it exists to carry.
      const [e, d] = await Promise.all([
        getParcEntries(fromIso, toIso),
        getTruckDistances(distHours(distWindow)),
      ]);
      if (e.error || d.error) {
        setError(e.error ?? d.error);
        setEntries(null);
        setDistances(null);
      } else {
        setEntries(e.data);
        setDistances(d.data);
        setTruncated(e.truncated);
        setTotal(e.total);
      }
    }
    setLoading(false);
  }

  // Re-reading just the distance column: switching the window must not
  // wipe the entries, which are a different question entirely.
  async function refreshDistances(hours: number) {
    const d = await getTruckDistances(hours);
    if (d.error) {
      setError(d.error);
      return;
    }
    setDistances(d.data);
  }

  function clear() {
    const r = startOfRange("today");
    setFrom(r.from);
    setTo(r.to);
    setEntries(null);
    setDistances(null);
    setGeoVisits(null);
    setGeoTotals(null);
    setLivVisits(null);
    setLivTotals(null);
    setChargVisits(null);
    setChargTotals(null);
    setVoyages(null);
    setError(null);
    setCopied(false);
  }

  // What the export buttons act on: whichever table is actually on
  // screen. Exporting the detail while looking at the summary is the
  // kind of thing nobody notices until the figures are in a meeting.
  const active: { columns: readonly string[]; rows: string[][]; slug: string } =
    report === "voyages"
      ? { columns: VOYAGE_COLUMNS, rows: voyageRows(voyages ?? []), slug: "rapport-voyages" }
      : report === "livraisons"
      ? { columns: LIV_COLUMNS, rows: livRows(livVisits ?? []), slug: "rapport-livraisons" }
      : report === "chargements"
      ? { columns: CHARG_COLUMNS, rows: chargRows(chargVisits ?? []), slug: "rapport-chargements" }
      : report === "geo"
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
  // Figures compare down a column by their last digit. Monospace so the
  // digits line up as columns of their own, which is the same reasoning
  // the truck id already uses.
  const numCell: React.CSSProperties = {
    textAlign: "right",
    fontFamily: "var(--font-mono)",
    whiteSpace: "nowrap",
  };

  const srOnly: React.CSSProperties = {
    position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
  };
  const hasRun =
    report === "parc" ? entries !== null
    : report === "voyages" ? voyages !== null
    : report === "livraisons" ? livVisits !== null
    : report === "chargements" ? chargVisits !== null
    : geoVisits !== null;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold t-primary">
        {report === "parc" ? "Rapport Parc"
          : report === "geo" ? "Rapport Geo"
          : report === "voyages" ? "Rapport Voyages"
          : report === "chargements" ? "Rapport Chargements"
          : "Rapport Livraisons"}
      </h1>
      <p className="mt-1 text-sm t-dim">
        {report === "parc"
          ? "Trucks that entered PARC OMD — headquarters & parking."
          : report === "voyages"
          ? "One row per truck: what it burned, what that cost against the assumed rate, and how many loaded trips it ran from the plant to a client."
          : report === "livraisons"
          ? `Every truck, every client site it stopped at for more than ${UNLOADED_MIN_SECONDS / 60} minutes — the plant is left out, so what remains is the deliveries.`
          : report === "chargements"
          ? "Every truck that entered Zone chargement – Usine AMOUDA Ciment, with how long it loaded and how long it waited to. The counterpart of Livraisons: that one is the fleet at the client end of a trip, this is the fleet at the plant end."
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
      {/* Said plainly, because the alternative is someone comparing this
          against Wialon's own zone report, finding it short, and
          deciding the app undercounts. It does not — it counts
          deliveries, and Wialon counts boundary crossings. */}
      {report === "livraisons" && (
        <p className="mt-1 text-xs t-faint">
          A stop under <strong>{UNLOADED_MIN_SECONDS / 60} minutes</strong> is not counted: a site
          polygon logs a truck that merely drove past, and on this fleet&rsquo;s first week 43 of 193
          site visits were that — several of them under two minutes. Same threshold as{" "}
          <strong>Déchargés</strong> on Monitoring, so the two agree on what a delivery is.
        </p>
      )}

      {/* Says the two things a reader would otherwise assume wrongly:
          that this counts every entry (Livraisons does not, and they sit
          next to each other), and that Avant chargement is not part of
          Temps de chargement. */}
      {report === "chargements" && (
        <p className="mt-1 text-xs t-faint">
          <strong>Every entry counts here</strong> — there is no minimum stop, unlike{" "}
          <strong>Livraisons</strong>. A site polygon sits beside a public road and logs trucks that
          merely drove past; the loading bay is drawn inside the waiting area, so a truck reaches it
          only by being sent there. <strong>Avant chargement</strong> is the wait before the load —
          this entry minus the moment the truck entered the waiting area — so it runs{" "}
          <em>before</em> Temps de chargement rather than inside it, and a dash means no waiting-area
          entry encloses the load.
        </p>
      )}

      {report === "voyages" && (
        <p className="mt-1 text-xs t-faint">
          A <strong>voyage</strong> is a load at the plant that reached a client — a stop of more
          than {UNLOADED_MIN_SECONDS / 60} minutes at a site, with a loading at Amouda between it
          and that truck&rsquo;s previous delivery. Trucks reading{" "}
          <strong>Not available</strong> are not trucks that did nothing: this app watches one
          plant, so a truck that loaded elsewhere is invisible to the count, and a zero there would
          claim more than the data knows. The fuel columns cover the fills that logged a distance —
          the same set the dashboard&rsquo;s variance table uses — so litres, L/100km and variance
          all describe the same fills and divide into each other correctly.
        </p>
      )}

      {report === "geo" && (
        <p className="mt-1 text-xs t-faint">
          The loading bay sits inside the waiting area, so an <strong>Attente</strong> row is the
          whole stay at the plant — loading included, not the wait before it. Its window contains the{" "}
          <strong>Chargement</strong> row rather than running before it, so the two do not add up.
        </p>
      )}

      <div className="panel mt-5 p-4">
        <div className="seg" style={{ width: "fit-content" }}>
          {(["parc", "geo", "livraisons", "chargements", "voyages"] as Report[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => switchReport(r)}
              className={`seg-item${report === r ? " is-active" : ""}`}
              aria-pressed={report === r}
            >
              {r === "parc" ? "Parc"
                : r === "geo" ? "Geo"
                : r === "voyages" ? "Voyages"
                : r === "chargements" ? "Chargements"
                : "Livraisons"}
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

      {report === "livraisons" && livTotals && livTotals.length > 0 && (
        // FOUR FLEET FIGURES, not one card per truck: there are 46 of
        // them, and a strip that long stops being a summary. The
        // per-truck detail is the table underneath.
        //
        // Summed from livTotals rather than from the visit list, and the
        // distinction is the point: the list is capped at MAX_ROWS and a
        // total taken from a truncated list is wrong without saying so.
        // fleet_site_totals returns one row per truck, which cannot be
        // truncated, so adding these up is safe.
        //
        // Achromatic throughout. Time on a client site is productive
        // time, and green means "moving, on-route" in this palette — it
        // is not free to spend on a truck standing still, however
        // usefully.
        <div className="kpi-strip mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))" }}>
          <div className="kpi-card">
            <div className="kpi-value">{livTotals.reduce((n, t) => n + t.deliveries, 0)}</div>
            <div className="kpi-label">Livraisons</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{livTotals.length}</div>
            <div className="kpi-label">
              {livTotals.length === 1 ? "Camion" : "Camions"}
            </div>
          </div>
          <div className="kpi-card">
            {/* Straight off the RPC, which carries the same fleet-wide
                figure on every row. Counting it here from livVisits
                would be a total taken from the capped list; summing the
                per-truck `sites` column would count a site once per
                truck that went there, which over one week read 152
                against a true 36. */}
            <div className="kpi-value">{livTotals[0].fleet_sites}</div>
            <div className="kpi-label">Sites</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{hms(livTotals.reduce((n, t) => n + t.total_seconds, 0))}</div>
            <div className="kpi-label">Temps sur site</div>
          </div>
        </div>
      )}

      {/* WHY auto-fit RATHER THAN repeat(4, …), on all three strips
          below. .kpi-strip clips (overflow: hidden, and it must — see
          globals.css), so four fixed tracks do not scroll when they stop
          fitting, they silently cut the figures off. Measured at 400px
          against the shipped Livraisons strip: its "412:18:05" lost 52px
          and "Temps sur site" 37px, and this report's longer labels
          would have lost 85px. minmax(min(150px, 100%), 1fr) keeps four
          across wherever there is room, folds to 2×2 on a phone and to
          one column at 320px, and the min() is what stops the track
          floor from overflowing a viewport narrower than 150px itself.
          Zero clipping at 1366 / 640 / 400 / 320 after the change. */}
      {report === "chargements" && chargTotals && chargTotals.length > 0 && (
        // The same four-slot shape as Livraisons, and summed the same
        // way: from chargTotals, which is one row per truck and cannot
        // be truncated, never from the capped visit list.
        <div className="kpi-strip mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))" }}>
          <div className="kpi-card">
            <div className="kpi-value">{chargTotals.reduce((n, t) => n + t.loadings, 0)}</div>
            <div className="kpi-label">Chargements</div>
          </div>
          <div className="kpi-card">
            {/* Straight off the RPC, which carries the same fleet-wide
                figure on every row. chargTotals.length is the same
                number here — one row per truck that loaded — but reading
                the column keeps this card right if the query ever grows
                a row for a truck with none. */}
            <div className="kpi-value">{chargTotals[0].fleet_trucks}</div>
            <div className="kpi-label">
              {chargTotals[0].fleet_trucks === 1 ? "Camion" : "Camions"}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value">{hms(chargTotals.reduce((n, t) => n + t.total_seconds, 0))}</div>
            <div className="kpi-label">Temps de chargement</div>
          </div>
          {/* AMBER, the one coloured card, on the same reading as Geo's
              Attente card: amber is the taxonomy's idle and a truck
              queueing at the plant is precisely idle. Loading time
              beside it stays achromatic — it is productive, and green
              means "moving, on-route".
              Divided by queued_visits, NOT by loadings: a load with no
              enclosing waiting row contributes no wait, and dividing by
              every load would quietly average those in as zero. */}
          <div className="kpi-card amber">
            <div className="kpi-value">
              {(() => {
                const waits = chargTotals.reduce((n, t) => n + t.queued_visits, 0);
                if (waits === 0) return "—";
                return hms(chargTotals.reduce((n, t) => n + t.total_queue_seconds, 0) / waits);
              })()}
            </div>
            <div className="kpi-label">Attente moyenne</div>
          </div>
        </div>
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
        // auto-fit replaces an explicit Math.min(length, 4) here, and
        // matches it wherever it mattered: with four cards or fewer the
        // row is identical at desktop width. Five zones now sit in one
        // row rather than four-then-one, which is the better of the two.
        <div className="kpi-strip mt-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))" }}>
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
            <div className="flex flex-wrap items-center gap-3">
            {report === "parc" && entries !== null && (
              // The window the Distance column measures. Segmented and
              // labelled in hours, not words: 2h/12h/24h is the unit
              // of the column header above it, and the four other
              // reports have no such control, so it rides here above
              // the table rather than in the shared filter row.
              <div className="seg" style={{ width: "fit-content" }}>
                {(["2h", "12h", "24h"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`seg-item${distWindow === w ? " is-active" : ""}`}
                    aria-pressed={distWindow === w}
                    onClick={() => {
                      setDistWindow(w);
                      refreshDistances(distHours(w));
                    }}
                  >
                    {w}
                  </button>
                ))}
              </div>
            )}
            <span className="text-sm t-dim">
              {active.rows.length}{" "}
              {report === "parc"
                ? active.rows.length === 1 ? "entry" : "entries"
                : report === "voyages"
                // The row count is TRUCKS here, not voyages — this
                // report is one row per truck, and calling them
                // "voyages" would read as a total that is not on screen.
                ? active.rows.length === 1 ? "truck" : "trucks"
                : report === "livraisons"
                ? active.rows.length === 1 ? "livraison" : "livraisons"
                : report === "chargements"
                ? active.rows.length === 1 ? "chargement" : "chargements"
                : active.rows.length === 1 ? "passage" : "passages"}
              {/* Names the real total, which is the whole reason the
                  count is now taken in Postgres: the old notice could
                  only say "the first 5000", and it never fired anyway
                  because the response was capped at 1000 long before
                  5001 rows could arrive to trigger it. */}
              {truncated && ` of ${total.toLocaleString("en-GB")} — narrow the range to see the rest`}
            </span>
            </div>
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
                : report === "livraisons"
                ? "No truck reached a client site in this period."
                : report === "chargements"
                ? "No truck loaded at the plant in this period."
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
          ) : report === "livraisons" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>
                    {/* Site and Client are one column on screen — the
                        client sits under the site, dimmed — because the
                        two are the same fact at different resolutions and
                        side by side they doubled the row width. The CSV
                        keeps them separate; a spreadsheet is not read the
                        same way. */}
                    {["Truck ID", "Driver", "Site", "Heure d'entrée", "Heure sortie", "Temps passé"].map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {livVisits!.map((v, i) => (
                    // Truck and entry time are not unique together: a
                    // truck can leave and re-enter one site inside a
                    // minute, and both rows carry that tick's timestamp.
                    <tr key={`${v.truck_id}-${v.entered_at}-${i}`}>
                      <td className="truck-id">{v.truck_id}</td>
                      <td style={{ color: v.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {v.driver_name || "—"}
                      </td>
                      <td>
                        <div>{v.zone_name}</div>
                        {v.client_name && (
                          <div className="text-xs t-dim" title={v.client_name}>{v.client_name}</div>
                        )}
                      </td>
                      <td style={monoCell}>{formatOpsDateTime(v.entered_at)}</td>
                      <td style={monoCell}>
                        {v.exited_at ? formatOpsDateTime(v.exited_at) : "encore sur place"}
                      </td>
                      <td style={monoCell}>{hms(v.seconds_on_site)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : report === "chargements" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>{CHARG_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {chargVisits!.map((v, i) => (
                    // Truck and entry time are not unique together: a
                    // truck can leave and re-enter the bay inside a
                    // minute, and both rows carry that tick's timestamp.
                    <tr key={`${v.truck_id}-${v.entered_at}-${i}`}>
                      <td className="truck-id">{v.truck_id}</td>
                      <td style={{ color: v.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {v.driver_name || "—"}
                      </td>
                      <td style={monoCell}>{formatOpsDateTime(v.entered_at)}</td>
                      <td style={monoCell}>
                        {v.exited_at ? formatOpsDateTime(v.exited_at) : "encore en charge"}
                      </td>
                      <td style={monoCell}>{hms(v.seconds_loading)}</td>
                      {/* A dash, not 0:00:00 — nothing encloses this
                          load, so the wait is unknown rather than none.
                          hms already prints a dash for null. */}
                      <td style={monoCell}>{hms(v.queue_seconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : report === "voyages" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>
                    {VOYAGE_COLUMNS.map((c) => (
                      // Every column but the first two is a number, so
                      // they are right-aligned: figures compare down a
                      // column by their last digit, not their first.
                      <th key={c} style={c === "Truck ID" || c === "Driver" ? undefined : { textAlign: "right" }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {voyages!.map((r) => (
                    <tr key={r.truck_id}>
                      <td className="truck-id">{r.truck_id}</td>
                      <td>
                        {/* One name plus a count, not a wrapped list: at
                            0.87rem three Algerian names is 40 characters
                            and would set the row height for the whole
                            table. The full list is in the title and in
                            the export. */}
                        <span title={r.drivers}>{r.drivers.split(", ")[0]}</span>
                        {r.driver_count > 1 && (
                          <span className="text-xs t-dim" title={r.drivers}> +{r.driver_count - 1}</span>
                        )}
                      </td>
                      <td style={numCell}>{nfr(r.amount_da)}</td>
                      <td style={numCell}>{nfr(r.km)}</td>
                      <td style={numCell}>{nfr(r.litres)}</td>
                      {/* Red above the rate the sheet prices the écart
                          from, green below it — the same signed-against-
                          a-known-baseline rule the variance column uses,
                          and the same one the dashboard's consumption
                          column already follows. */}
                      <td style={numCell} className={consumptionClassAgainst(r.litres_per_100km, ASSUMED_L_PER_100KM)}>
                        {r.litres_per_100km == null ? "—" : r.litres_per_100km.toFixed(2)}
                      </td>
                      <td style={numCell} className={signedClass(r.variance_da)}>
                        {signedValue(r.variance_da, "DA")}
                      </td>
                      {/* NOT ZERO. This app watches one plant, so a truck
                          with no voyages either made none or loaded
                          somewhere it cannot see — and printing 0 would
                          assert the first. The owner asked for exactly
                          this wording. */}
                      <td style={numCell} className={r.voyages == null ? "t-dim" : undefined}>
                        {r.voyages == null ? "Not available" : r.voyages}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : report === "parc" ? (
            <div className="mt-3 table-wrap">
              <table>
                <thead>
                  <tr>{[...PARC_SCREEN_COLUMNS, `Distance (${distWindow})`].map((c) => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {entries!.map((e) => (
                    <tr key={e.id}>
                      {/* Model first — the owner reads the parc by it.
                          Derived from the plate by truck_model, never
                          stored, so a truck with a null model prints a
                          dash rather than a blank that could read as a
                          column nobody filled in. */}
                      <td style={{ color: e.model ? "var(--text)" : "var(--text-dim)" }}>
                        {e.model ?? "—"}
                      </td>
                      <td className="truck-id">{e.truck_id}</td>
                      <td style={{ color: e.driver_name ? "var(--text)" : "var(--text-dim)" }}>
                        {e.driver_name || "—"}
                      </td>
                      <td style={monoCell}>{formatOpsDateTime(e.entered_at)}</td>
                      {/* Distance is SCREEN-ONLY: Copy table and CSV
                          write Truck ID / Driver / Entry date (see the
                          PARC_COLUMNS comment), so this figure can tell
                          the owner on screen without leaking into a
                          spreadsheet he pastes into his own records.
                          One decimal under 10 km, whole km over it, a
                          dash when the tracker never heard from the
                          truck in the window. The one colourless figure
                          is the one that does the work. */}
                      <td style={{ ...numCell, color: "var(--text-dim)" }}>
                        {(() => {
                          const d = distances?.[e.truck_id];
                          if (d == null) return "—";
                          return d < 10 ? `${d.toFixed(1)} km` : `${nfr(Math.round(d))} km`;
                        })()}
                      </td>
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
