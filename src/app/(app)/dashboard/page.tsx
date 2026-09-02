"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Chart as ChartJS,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import type { ChartData } from "chart.js";
// <Chart>, not <Bar>, for the mixed cost chart: <Bar> is typed to "bar"
// datasets only, and that one carries a line dataset on a second axis.
import { Bar, Chart, Doughnut, Line } from "react-chartjs-2";
import { ArrowRight, Gauge, MapPinOff, Route, ShieldAlert } from "lucide-react";
import { useFleet } from "@/components/providers/FleetProvider";
import {
  getFuelPeriodStats,
  getDashboardSeries,
  getDriverVariance,
  getTruckVariance,
  getDriverSpeeding,
  type FuelPeriodStats,
  type DashboardSeries,
  type DriverVariance,
  type TruckVariance,
  type DriverSpeeding,
} from "@/lib/supabase/dashboard";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import {
  CHART_COLORS,
  doughnutOptions,
  installChartDefaults,
  timeSeriesOptions,
  dualAxisTimeSeriesOptions,
  AREA_SERIES,
  BAR_SERIES,
  LINE_SERIES,
  areaFill,
  crosshairPlugin,
  doughnutCentrePlugin,
} from "@/lib/chartTheme";
import RangeBar, { buildPresets, describeRange } from "@/components/dashboard/RangeBar";
import type { OpsRange } from "@/lib/dashboard/range";
import { metaFor } from "@/lib/notifications/kinds";
import { formatDuration } from "@/lib/geometry";
import { opsToday } from "@/lib/format";
import { ASSUMED_L_PER_100KM } from "@/lib/fuel/parse";
import { SPEED_LIMIT_KMH } from "@/lib/constants";

// BarController and LineController are registered EXPLICITLY, not left to
// react-chartjs-2's per-component auto-registration. The cost chart is a
// mixed dataset — bars on one axis, a line on the other — rendered
// through <Bar>, so it needs the line controller too; that arrives for
// free today only because this page also renders a <Line> elsewhere.
// Naming both here means dropping that other chart cannot silently break
// this one.
ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
);
installChartDefaults();

// The 7/14/30 segmented control that used to live on the "Distance per
// day" header is gone. It could only say "the last N days ending today",
// which cannot express August — a window ending in the past — or a
// single day. RangeBar replaces it at page level and governs every
// historical panel, not just the charts.

const nf = (n: number) => Math.round(n).toLocaleString("en-GB");

/** "2026-08-25" -> "25 Aug", for an axis that has to fit thirty of them. */
function axisLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function relativeTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/** Every driver and every truck the sheet names is rendered. The panel
 *  keeps the height of about eight rows (.table-wrap--capped) and the
 *  rest are a scroll away, so a long list cannot push the tier below it
 *  off the screen and nobody has to leave the dashboard to read it. */

interface SortColumn<T> {
  key: string;
  label: string;
  /** What to sort on. Null sorts to the bottom in both directions. */
  value: (row: T) => string | number | null;
  render: (row: T) => React.ReactNode;
  /** Cell class, so a column can colour itself from its own value. */
  cellClass?: (row: T) => string;
}

/**
 * A table whose columns sort, used for both variance panels.
 *
 * Written once rather than twice because the second copy is where the
 * two drift: the null handling and the direction-on-first-click rule are
 * easy to get subtly different, and a driver table that sorts nulls to
 * the bottom beside a truck table that sorts them to the top would be
 * worse than either alone.
 */
function SortableTable<T>({
  rows,
  columns,
  initialKey,
  rowKey,
  unit,
  noteSuffix,
}: {
  rows: T[];
  columns: SortColumn<T>[];
  initialKey: string;
  rowKey: (row: T) => string;
  /** What the rows are, for the count line: "drivers", "trucks". */
  unit: string;
  /** Appended to the count line when sorted on the initial column, so the
   *  panel can say "worst first" in its own words. */
  noteSuffix?: (dir: "asc" | "desc") => string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: initialKey,
    dir: "desc",
  });

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const sign = sort.dir === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      const x = col.value(a);
      const y = col.value(b);
      // A row with no figure has nothing to rank on, so it sorts to the
      // bottom whichever way the column runs — at the top of an ascending
      // sort a null would read as the best score on the board.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y);
      return sign * (Number(x) - Number(y));
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : // A new column opens the way that column is read: text from A,
          // numbers from the largest.
          { key, dir: columns.find((c) => c.key === key)?.key === columns[0].key ? "asc" : "desc" }
    );

  return (
    <>
      <div className="table-wrap table-wrap--capped" style={{ border: "none", borderRadius: 0 }}>
        <table>
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort.key === col.key;
                return (
                  <th
                    key={col.key}
                    className={`th-sort${active ? " is-sorted" : ""}`}
                    onClick={() => toggle(col.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(col.key);
                      }
                    }}
                    tabIndex={0}
                    role="columnheader"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    title={`Sort by ${col.label.toLowerCase()}`}
                  >
                    {col.label}
                    <span className="th-sort__caret" aria-hidden="true">
                      {active ? (sort.dir === "asc" ? "▲" : "▼") : "▼"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  <td key={col.key} className={col.cellClass ? col.cellClass(row) : "t-dim"}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-foot-note">
        {rows.length} {unit}
        {sort.key === initialKey && noteSuffix ? noteSuffix(sort.dir) : ""}.
      </div>
    </>
  );
}

/**
 * Who crossed the limit most often this month, as a ranked bar list.
 *
 * The bar length is the driver's share of the worst offender, not of the
 * fleet total — the question this panel answers is "who stands out", and
 * against a total of a few dozen crossings every bar would otherwise be a
 * stub. The floor of 4% keeps a single crossing visible as a mark rather
 * than nothing at all.
 *
 * One row is one crossing of the limit, not one run and not one minute
 * spent over it: the tick raises the alert on a false->true transition of
 * is_speeding, so slowing down and speeding up again counts twice. The
 * footer says so, because "9 times" is otherwise ambiguous enough to
 * argue with.
 */
function SpeedingPanel({ rows }: { rows: DriverSpeeding[] | null }) {
  const worst = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.times)) : 0;
  const total = rows ? rows.reduce((sum, r) => sum + r.times, 0) : 0;

  return (
    <section className="panel dash-panel">
      <header className="dash-panel__head">
        <div>
          <div className="dash-panel__title">Over the limit, by driver</div>
          <div className="dash-panel__sub">
            Times above {SPEED_LIMIT_KMH} km/h this month, anywhere in the fleet.
          </div>
        </div>
      </header>
      <div className="dash-panel__body dash-panel__body--flush">
        {rows === null ? (
          <VarianceWaiting />
        ) : rows.length === 0 ? (
          <p className="dash-empty">
            <span>
              <Gauge size={15} style={{ display: "block", margin: "0 auto 7px" }} />
              Nobody has crossed {SPEED_LIMIT_KMH} km/h this month.
            </span>
          </p>
        ) : (
          <div className="rank-list">
            {rows.map((r) => (
              <div key={r.driverName} className="rank-row">
                <div className="rank-row__track">
                  <div
                    className="rank-row__fill"
                    style={{ width: `${Math.max((r.times / worst) * 100, 4)}%` }}
                  />
                  <span className="rank-row__name">{r.driverName}</span>
                </div>
                <span className="rank-row__meta">
                  {r.truckCount > 1 ? `${r.truckCount} trucks` : (r.trucks ?? "")}
                </span>
                <span className="rank-row__value">{r.times}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {rows !== null && rows.length > 0 && (
        <div className="table-foot-note">
          {total} crossing{total === 1 ? "" : "s"} of the limit by {rows.length}{" "}
          driver{rows.length === 1 ? "" : "s"}. Slowing down and speeding up again counts twice.
        </div>
      )}
    </section>
  );
}

/** Red over the sheet's assumed rate, green under it, dim at exactly
 *  zero or with no figure at all. Shared so the two tables cannot drift
 *  apart on what a colour means. */
const signedClass = (v: number | null) =>
  v == null ? "t-dim" : v > 0 ? "c-red" : v < 0 ? "c-green" : "t-dim";

const signed = (v: number | null, unit: string) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${nf(v)} ${unit}`;

const consumptionClass = (v: number | null) =>
  v == null ? "t-dim" : v > ASSUMED_L_PER_100KM ? "c-red" : "c-green";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { fleetData, notifications, dispatches } = useFleet();

  const [fuel, setFuel] = useState<FuelPeriodStats | null>(null);
  const [series, setSeries] = useState<DashboardSeries | null>(null);
  // Defaults to the last 30 ops days: the widest window the old control
  // offered, so a returning reader sees roughly what they saw before
  // rather than the whole sheet at once.
  const [range, setRange] = useState<OpsRange>(() => buildPresets().find((p) => p.key === "30d")!.range);
  const [variance, setVariance] = useState<DriverVariance[] | null>(null);
  const [truckVariance, setTruckVariance] = useState<TruckVariance[] | null>(null);
  const [speeding, setSpeeding] = useState<DriverSpeeding[] | null>(null);
  // Whether the last load actually succeeded. Without this a failed RPC
  // is INDISTINGUISHABLE from a slow one: every panel keeps its skeleton
  // and its "reading the sheet…" caption forever, which is exactly what
  // happened when 047 changed five signatures and PostgREST was still
  // serving the old ones from its schema cache. The page looked like it
  // was buffering. It had already failed.
  const [dataError, setDataError] = useState<string | null>(null);

  // Every historical panel reads the same range, in ONE effect. Five
  // separate effects on the same dependency would fire five renders as
  // they landed and let the page sit briefly in a state where the
  // scorecards describe August and the tables still describe July —
  // which is the exact incoherence this control exists to remove.
  useEffect(() => {
    let cancelled = false;
    setDataError(null);
    void Promise.all([
      getFuelPeriodStats(range),
      getDashboardSeries(range),
      getDriverVariance(500, range),
      getTruckVariance(500, range),
      getDriverSpeeding(100, range),
    ])
      .then(([f, s, dv, tv, sp]) => {
        if (cancelled) return;
        // First error wins. They share a range and a round trip, so if
        // one signature is wrong they all are — reporting five copies of
        // the same sentence would only bury it.
        setDataError(f.error ?? s.error ?? dv.error ?? tv.error ?? sp.error ?? null);
        setFuel(f.stats ?? null);
        setSeries(s.series ?? null);
        setVariance(dv.drivers ?? null);
        setTruckVariance(tv.trucks ?? null);
        setSpeeding(sp.drivers ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setDataError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const trucks = fleetData.trucks;

  // ── What the fleet is doing, right now ──
  //
  // Status rather than location. Location needs a geofence per place,
  // and only two exist — the factory and the parc — so "at a client
  // site" could never be anything but zero however the fleet moved,
  // while every truck always has a status.
  const fleetStatus = useMemo(() => {
    const acc = { moving: 0, stationary: 0, offline: 0 };
    for (const tr of trucks) {
      if (tr.status === "moving") acc.moving++;
      else if (tr.status === "idle") acc.stationary++;
      else acc.offline++;
    }
    return acc;
  }, [trucks]);

  const statusChart = {
    labels: ["Moving", "Stationary", "Offline"],
    datasets: [
      {
        data: [fleetStatus.moving, fleetStatus.stationary, fleetStatus.offline],
        // The taxonomy, unchanged: green is a truck that is moving, amber
        // one that is stopped, and an unreachable truck is not a state
        // worth a hue — it is the absence of one.
        backgroundColor: [CHART_COLORS.green, CHART_COLORS.amber, CHART_COLORS.empty],
        borderWidth: 0,
      },
    ],
  };

  const labels = (series?.km ?? []).map((p) => axisLabel(p.day));

  // The first day that actually carries a telemetry reading, but only
  // when the range reaches back past it — otherwise there is no gap on
  // screen to explain and the sentence would be noise.
  const kmGapDay = useMemo(() => {
    const km = series?.km;
    if (!km || km.length === 0 || km[0].value != null) return null;
    return km.find((p) => p.value != null)?.day ?? null;
  }, [series]);

  // The ISO days behind each series, handed to the tooltip so it can name
  // the day in full where the axis only has room to abbreviate it. The
  // RPC returns every series dense over the same range, so these are the
  // same list four times — kept per series anyway, so that a series which
  // one day stops being dense cannot silently mislabel its own points.
  const kmDays = (series?.km ?? []).map((p) => p.day);
  const alertDays = (series?.alerts ?? []).map((p) => p.day);
  const litreDays = (series?.litres ?? []).map((p) => p.day);
  const consumptionDays = (series?.consumption ?? []).map((p) => p.day);
  const costDays = (series?.amountDa ?? []).map((p) => p.day);

  const kmChart = {
    labels,
    datasets: [
      {
        data: (series?.km ?? []).map((p) => p.value),
        ...AREA_SERIES,
        backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) =>
          areaFill(ctx.chart.ctx, ctx.chart.chartArea?.top ?? 0, ctx.chart.chartArea?.bottom ?? 0),
      },
    ],
  };

  const alertsChart = {
    labels: (series?.alerts ?? []).map((p) => axisLabel(p.day)),
    datasets: [{ data: (series?.alerts ?? []).map((p) => p.value), ...BAR_SERIES }],
  };

  // Litres bought against what they bought — the same bars-plus-rate
  // shape as the cost panel. The rate is L/100km, NOT litres per
  // kilometre: every other consumption figure in this app is per 100km
  // (the KPI tile, the variance tables, the sheet's own assumed 45), and
  // a truck reads 0.48 in the raw unit against 48 everywhere else, which
  // is the kind of mismatch that gets a number misread once and
  // distrusted after.
  //
  // Reuses series.consumption, so this needed no new query: it is
  // already the same subset rule — only fills that logged a distance.
  const litresChart: ChartData<"bar" | "line", (number | null)[], string> = {
    labels: (series?.litres ?? []).map((p) => axisLabel(p.day)),
    datasets: [
      {
        label: "Litres",
        data: (series?.litres ?? []).map((p) => (p.value == null ? null : Math.round(p.value))),
        type: "bar" as const,
        yAxisID: "y",
        order: 2,
        ...BAR_SERIES,
      },
      {
        label: "L/100km",
        data: (series?.consumption ?? []).map((p) => (p.value == null ? null : Number(p.value.toFixed(2)))),
        type: "line" as const,
        yAxisID: "y1",
        order: 1,
        ...LINE_SERIES,
        // Smaller points than the cost chart's: this plot is a third the
        // width, so 30 days of 3px dots merge into a bead chain.
        pointRadius: 2,
        pointHoverRadius: 4,
      },
    ],
  };

  const consumptionChart = {
    labels: (series?.consumption ?? []).map((p) => axisLabel(p.day)),
    datasets: [
      // A day with no fill yet has no consumption to plot. Passed through
      // as null so the line breaks there instead of diving to the origin.
      { data: (series?.consumption ?? []).map((p) => (p.value == null ? null : Number(p.value.toFixed(2)))), ...LINE_SERIES },
    ],
  };

  // What the day cost, and what a kilometre of it cost. Two magnitudes
  // that cannot share a scale — hundreds of thousands of dinars against
  // about fifteen — so the rate rides the right-hand axis. Bars for the
  // spend and a line for the rate, both cream: money is a quantity, not
  // a vehicle state, and shape is what tells them apart here.
  const costChart: ChartData<"bar" | "line", (number | null)[], string> = {
    labels: (series?.amountDa ?? []).map((p) => axisLabel(p.day)),
    datasets: [
      {
        label: "Amount filled",
        data: (series?.amountDa ?? []).map((p) => (p.value == null ? null : Math.round(p.value))),
        type: "bar" as const,
        yAxisID: "y",
        order: 2,
        ...BAR_SERIES,
      },
      {
        label: "Cost per km",
        // Null on a day with no priced fill, so the line breaks rather
        // than dropping to a floor that would read as a free day.
        data: (series?.daPerKm ?? []).map((p) => (p.value == null ? null : Number(p.value.toFixed(2)))),
        type: "line" as const,
        yAxisID: "y1",
        // Drawn over the bars, not through them.
        order: 1,
        ...LINE_SERIES,
      },
    ],
  };

  // ── Drivers on duty: anyone the fleet feed can name, moving first ──
  const duty = useMemo(() => {
    const rank = { moving: 0, idle: 1, offline: 2 } as const;
    const onRun = new Set(dispatches.map((d) => d.truck_id));
    return trucks
      // Staff cars are not on duty in the sense this panel means, and
      // today they carry no driver name so the filter below already
      // excluded them by accident. Naming the category makes it
      // deliberate: assign a driver to a staff car in Wialon and the
      // accident stops working.
      .filter((tr) => tr.category !== "staff")
      .filter((tr) => tr.driverName)
      .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3))
      .slice(0, 6)
      .map((tr) => ({
        name: tr.driverName as string,
        truckId: tr.truck_id,
        status: tr.status,
        speed: tr.speed,
        onRun: onRun.has(tr.truck_id),
      }));
  }, [trucks, dispatches]);

  const statusColour = (status: string) =>
    status === "moving" ? "var(--green)" : status === "idle" ? "var(--amber)" : "var(--text-faint)";

  const signals = notifications.slice(0, 6);

  // The sheet's own date cells for the first and last fill IN THE
  // RANGE, as written. Secondary now that the heading names the selected
  // window: these strings are raw, and the source carried mixed
  // month/day and day/month until it was normalised, so "9/1/2026" can
  // still appear where 1 September is meant. Useful as provenance,
  // wrong as the headline — which is what it used to be.
  const periodLabel =
    fuel?.firstRaw && fuel?.lastRaw
      ? `${fuel.firstRaw.split(" ")[0]} → ${fuel.lastRaw.split(" ")[0]}`
      : "";

  return (
    <div className="dash" style={{ overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600 }}>{t("dashboard.title")}</h2>
          <p className="t-dim" style={{ fontSize: ".78rem", marginTop: "3px" }}>
            Every figure below covers {describeRange(range)}
            {periodLabel ? `, first to last fill ${periodLabel}` : ""}.
          </p>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <RangeBar value={range} onChange={setRange} daysWithData={series?.daysAvailable ?? null} />
      </div>

      {/* Shown verbatim rather than as "something went wrong". This is an
          operations tool read by the person who can act on it, and the
          message PostgREST returns for a stale schema cache names the
          function it could not find — which is the whole diagnosis. */}
      {dataError && (
        <div className="mt-3 rounded-md p-3 text-sm tint-red c-red" role="alert">
          The figures below could not be loaded: {dataError}
        </div>
      )}

      {/* ── The sheet, summed ─────────────────────────────────
          One surface with hairline dividers rather than five bordered
          cards in a gapped grid. Same five figures, but five borders and
          four gutters were most of what made this strip look heavy — the
          numbers were never the problem. */}
      <div className="kpi-strip">
        <Kpi label="Kilometres driven" value={fuel ? nf(fuel.km) : null} unit="km" foot={fuel ? `${nf(fuel.fills)} fills` : ""}  failed={dataError != null} />
        <Kpi label="Litres consumed" value={fuel ? nf(fuel.litres) : null} unit="L" foot={fuel ? `incl. ${nf(fuel.unpairedLitres)} L with no km logged` : ""}  failed={dataError != null} />
        <Kpi label="Amount filled" value={fuel ? nf(fuel.amountDa) : null} unit="DA" foot={fuel ? `${nf(fuel.unpairedFills)} fills logged amount only` : "paid at the pump"}  failed={dataError != null} />
        <Kpi
          label="Average consumption"
          value={fuel?.litresPer100Km != null ? fuel.litresPer100Km.toFixed(2) : null}
          unit="L/100km"
          foot={fuel ? `${nf(fuel.fills - fuel.unpairedFills)} fills with km logged` : ""}
          failed={dataError != null}
        />
        <Kpi
          label="Total variance"
          value={fuel ? nf(fuel.varianceDa) : null}
          unit="DA"
          foot={fuel ? (fuel.varianceDa > 0 ? "▲ over the assumed rate" : "▼ under the assumed rate") : ""}
          failed={dataError != null}
        />
      </div>

      {/* ── Two zones ─────────────────────────────────────────
          Everything that answers "what is happening right now" goes in a
          fixed 350px rail; everything that answers "what has been
          happening" gets the rest. Four full-width tiers spent a 1366px
          screen stacking narrow content down a long page — the variance
          tables in particular were reading five columns across a width
          they never needed. */}
      <div className="dash-grid">
        {/* A div, not a <main>. The shell already provides the page's
            single main landmark, so a second one here was an
            accessibility fault — and it also collected the bare `main`
            overscroll rule in globals.css, which is written for the
            outermost scroller only. */}
        <div className="dash-main">
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div style={{ minWidth: 0 }}>
                <div className="dash-panel__title">Distance per day</div>
                <div className="dash-panel__sub">
                  {/* The last point is always today, and today is always
                      partial — at 02:00 it is a hundredth of a day's
                      distance, which draws as a dive to the floor. Said
                      plainly rather than hidden by dropping the point:
                      the current day is the one people look for. */}
                  {/* Today is always partial — at 02:00 it is a
                      hundredth of a day's distance, which draws as a
                      dive to the floor. Said plainly rather than hidden
                      by dropping the point: the current day is the one
                      people look for. Only worth saying when the range
                      actually reaches today. */}
                  Fleet kilometres, staff cars included.
                  {range.to == null || range.to >= opsToday() ? " Today is still counting." : ""}
                  {/* A break in the line is "not recorded", never "zero
                      km driven". This panel reads fleet_day_metrics,
                      which pg_cron began writing on 2026-08-17 — earlier
                      days have no telemetry and cannot get any, since
                      fleet_snapshots is pruned after seven days. Derived
                      from the series rather than hardcoded, so it stops
                      appearing on its own once the range starts inside
                      the recorded period. */}
                  {kmGapDay ? ` No fleet tracking before ${kmGapDay} — those days are a gap, not zero.` : ""}
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              <div className="dash-chart dash-chart--tall">
                {series ? (
                  <Line
                    data={kmChart}
                    options={timeSeriesOptions({ unit: " km", days: kmDays })}
                    plugins={[crosshairPlugin]}
                  />
                ) : (
                  <ChartWaiting />
                )}
              </div>
            </div>
          </section>

          {/* Second, directly under the headline series — not at the
              bottom of the column. The KPI strip opens with what the
              month cost; this is the panel that answers it, so it reads
              before the per-truck and per-driver tables that break the
              same money down. It is full width because two series, two
              axes and a legend need the room the trio's thirds cannot
              give. Position does not change how the column ends: the
              same panels in any order still close the band the rail used
              to overhang by. */}
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">What fuel cost per day</div>
                <div className="dash-panel__sub">
                  Bars are what was paid at the pump, every fill. The line is the montant
                  kilométrique — dinars per kilometre, on the fills that logged a distance.
                  {/* Today's column is empty until the first fill of the
                      day syncs: the bar is 0 and the rate has no priced
                      fill to divide, so the newest slot draws nothing at
                      all. Said here for the same reason the distance
                      panel says it — a blank column reads as a day that
                      cost nothing rather than a day still counting. */}
                  {" "}Today fills in as the sheet syncs.
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              <div className="dash-chart dash-chart--tall">
                {series ? (
                  <Chart<"bar" | "line", (number | null)[], string>
                    type="bar"
                    data={costChart}
                    options={dualAxisTimeSeriesOptions({
                      units: [" DA", " DA/km"],
                      days: costDays,
                      compactLeft: true,
                    })}
                    plugins={[crosshairPlugin]}
                  />
                ) : (
                  <ChartWaiting />
                )}
              </div>
            </div>
          </section>

        <div className="dash-row dash-row--trio">
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Litres bought per day</div>
                {/* Names both series, which is why this chart carries no
                    legend — 32px of legend is a fifth of a 150px plot. */}
                <div className="dash-panel__sub">
                  Bars: every fill, staff vehicles included. Line: L/100km, on the fills that
                  logged a distance.
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              <div className="dash-chart">
                {series ? (
                  <Chart<"bar" | "line", (number | null)[], string>
                    type="bar"
                    data={litresChart}
                    options={dualAxisTimeSeriesOptions({
                      units: [" L", " L/100km"],
                      days: litreDays,
                      // 8,503 to 16,214 litres a day, so the raw ticks
                      // are five digits in a 300px panel. "15k" says the
                      // same thing in a third of the width.
                      compactLeft: true,
                      legend: false,
                    })}
                    plugins={[crosshairPlugin]}
                  />
                ) : (
                  <ChartWaiting />
                )}
              </div>
            </div>
          </section>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Consumption per day</div>
                <div className="dash-panel__sub">
                  L/100km, on fills that logged a distance. The sheet assumes 45.
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              <div className="dash-chart">
                {series ? (
                  <Line
                    data={consumptionChart}
                    options={timeSeriesOptions({
                      unit: " L/100km",
                      beginAtZero: false,
                      days: consumptionDays,
                    })}
                    plugins={[crosshairPlugin]}
                  />
                ) : (
                  <ChartWaiting />
                )}
              </div>
            </div>
          </section>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Alerts raised per day</div>
                <div className="dash-panel__sub">Off route, speeding and arrivals together.</div>
              </div>
            </header>
            <div className="dash-panel__body">
              <div className="dash-chart">
                {series ? (
                  <Bar
                    data={alertsChart}
                    options={timeSeriesOptions({ days: alertDays })}
                    plugins={[crosshairPlugin]}
                  />
                ) : (
                  <ChartWaiting />
                )}
              </div>
            </div>
          </section>
        </div>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Fuel variance by truck</div>
                <div className="dash-panel__sub">
                  The same écart, per vehicle. A truck that is thirsty under several drivers is a
                  truck, not a run of unlucky people.
                </div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {truckVariance === null ? (
                <VarianceWaiting />
              ) : truckVariance.length === 0 ? (
                <p className="dash-empty">No fill carries a variance yet.</p>
              ) : (
                <SortableTable
                  rows={truckVariance}
                  rowKey={(t) => t.truckId}
                  initialKey="varianceDa"
                  unit="trucks"
                  noteSuffix={(dir) => (dir === "desc" ? " — worst first" : " — best first")}
                  columns={[
                    {
                      key: "truckId",
                      label: "Truck",
                      value: (t) => t.truckId,
                      render: (t) => t.truckId,
                      cellClass: () => "truck-id",
                    },
                    {
                      key: "drivers",
                      label: "Drivers",
                      value: (t) => t.drivers,
                      render: (t) => t.drivers,
                      // One driver means this row and that driver's row are
                      // the same evidence counted twice, which is worth
                      // seeing before either is treated as proof.
                      cellClass: (t) => (t.drivers > 1 ? "t-primary" : "t-dim"),
                    },
                    { key: "km", label: "Distance", value: (t) => t.km, render: (t) => `${nf(t.km)} km` },
                    {
                      key: "litresPer100Km",
                      label: "L/100km",
                      value: (t) => t.litresPer100Km,
                      render: (t) => (t.litresPer100Km != null ? t.litresPer100Km.toFixed(2) : "—"),
                      cellClass: (t) => consumptionClass(t.litresPer100Km),
                    },
                    {
                      key: "varianceDa",
                      label: "Variance",
                      value: (t) => t.varianceDa,
                      render: (t) => signed(t.varianceDa, "DA"),
                      cellClass: (t) => signedClass(t.varianceDa),
                    },
                  ]}
                />
              )}
            </div>
          </section>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Fuel variance by driver</div>
                <div className="dash-panel__sub">
                  Against the sheet&rsquo;s assumed {ASSUMED_L_PER_100KM} L/100km. Click a column to sort.
                  The truck column matters: a driver with one truck cannot be told apart from it.
                </div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {variance === null ? (
                <VarianceWaiting />
              ) : variance.length === 0 ? (
                <p className="dash-empty">No fill carries a variance yet.</p>
              ) : (
                <SortableTable
                  rows={variance}
                  rowKey={(d) => d.driverName}
                  initialKey="varianceDa"
                  unit="drivers"
                  noteSuffix={(dir) => (dir === "desc" ? " — worst first" : " — best first")}
                  columns={[
                    {
                      key: "driverName",
                      label: "Driver",
                      value: (d) => d.driverName,
                      render: (d) => d.driverName,
                      cellClass: () => "t-primary",
                    },
                    {
                      key: "trucks",
                      label: "Truck",
                      value: (d) => d.trucks,
                      // One truck is named, because that is the row's
                      // confound and the reader should see which vehicle to
                      // check. More than one and the count is the point:
                      // the figure is no longer one truck's.
                      render: (d) =>
                        d.truckCount > 1 ? `${d.truckCount} trucks` : (d.trucks ?? "—"),
                      cellClass: (d) => (d.truckCount > 1 ? "t-dim" : "truck-id"),
                    },
                    { key: "km", label: "Distance", value: (d) => d.km, render: (d) => `${nf(d.km)} km` },
                    {
                      key: "litresPer100Km",
                      label: "L/100km",
                      value: (d) => d.litresPer100Km,
                      render: (d) => (d.litresPer100Km != null ? d.litresPer100Km.toFixed(2) : "—"),
                      cellClass: (d) => consumptionClass(d.litresPer100Km),
                    },
                    {
                      key: "varianceDa",
                      label: "Variance",
                      value: (d) => d.varianceDa,
                      render: (d) => signed(d.varianceDa, "DA"),
                      cellClass: (d) => signedClass(d.varianceDa),
                    },
                  ]}
                />
              )}
            </div>
          </section>

        </div>

        <aside className="dash-rail">
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">What the fleet is doing<span className="vehicle-tag" style={{ marginLeft: 8, verticalAlign: "middle" }} title="Reads the live fleet — the date range does not apply">live</span></div>
                <div className="dash-panel__sub">
                  {/* Says which population it counts, like the distance
                      chart does. This one DOES include staff cars —
                      they are vehicles that report, and where the fleet
                      is right now is the one question they belong in —
                      but the alert panels beside it exclude them, and a
                      reader comparing the two should not have to guess
                      which is which. */}
                  {trucks.length > 0
                    ? `${trucks.length} vehicles reporting, staff cars included.`
                    : "Waiting for the first fleet snapshot."}
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              {trucks.length === 0 ? (
                <p className="dash-empty">
                  <span>
                    <MapPinOff size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                    No fleet snapshot yet — the monitoring job may not be running.
                  </span>
                </p>
              ) : (
                <div className="dash-chart dash-chart--donut">
                  <Doughnut
                    data={statusChart}
                    options={doughnutOptions}
                    plugins={[doughnutCentrePlugin]}
                  />
                </div>
              )}
            </div>
          </section>

          <SpeedingPanel rows={speeding} />

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Drivers on duty<span className="vehicle-tag" style={{ marginLeft: 8, verticalAlign: "middle" }} title="Reads the live fleet — the date range does not apply">live</span></div>
                <div className="dash-panel__sub">Who is out right now.</div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {duty.length === 0 ? (
                <p className="dash-empty">No driver is named on the current fleet feed.</p>
              ) : (
                duty.map((d) => (
                  <div key={d.truckId} className="duty-row">
                    <span className="duty-dot" style={{ background: statusColour(d.status) }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="duty-name">{d.name}</div>
                      <div className="duty-meta">
                        {d.status === "moving" ? `moving · ${Math.round(d.speed)} km/h` : d.status}
                        {d.onRun ? " · on a run" : ""}
                      </div>
                    </div>
                    <span className="truck-id" style={{ fontSize: ".68rem", flex: "none" }}>{d.truckId}</span>
                  </div>
                ))
              )}
            </div>
            <div className="dash-panel__foot">
              <Link href="/drivers" className="dash-more">
                All drivers <ArrowRight size={12} />
              </Link>
            </div>
          </section>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Active runs<span className="vehicle-tag" style={{ marginLeft: 8, verticalAlign: "middle" }} title="Reads the live fleet — the date range does not apply">live</span></div>
                <div className="dash-panel__sub">Trucks on their way to a client right now.</div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {dispatches.length === 0 ? (
                <p className="dash-empty">
                  <span>
                    <Route size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                    Nothing is running. A run appears here the moment it is dispatched.
                  </span>
                </p>
              ) : (
                // Rows, not a table. The same four facts in a 350px rail
                // put the truck id in a column narrow enough to break it
                // mid-token — "00038-" over "523-35" — and pushed Status
                // off the panel entirely. Stacked, the destination gets
                // the full width it actually needs and nothing is cut.
                <div className="run-list">
                  {dispatches.slice(0, 5).map((d) => (
                    <div key={d.id} className="run-row">
                      <div className="run-row__head">
                        <span className="truck-id">{d.truck_id}</span>
                        <span className={`status-pill ${d.last_on_route === false ? "off-route" : "dispatched"}`}>
                          {d.last_on_route === false ? "Off route" : "On route"}
                        </span>
                      </div>
                      <div className="run-row__dest">{d.site?.name ?? "—"}</div>
                      <div className="run-row__eta">
                        {d.last_eta_seconds != null ? `ETA ${formatDuration(d.last_eta_seconds)}` : "no ETA yet"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="dash-panel__foot">
              <Link href="/dispatch" className="dash-more">
                Open dispatch <ArrowRight size={12} />
              </Link>
            </div>
          </section>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">Operational signals</div>
                <div className="dash-panel__sub">The latest from the alert feed.</div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {signals.length === 0 ? (
                <p className="dash-empty">
                  <span>
                    <ShieldAlert size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                    Nothing has been raised yet today.
                  </span>
                </p>
              ) : (
                signals.map((n) => {
                  const meta = metaFor(n.kind);
                  const Icon = meta.icon;
                  return (
                    <div key={n.id} className="signal-row">
                      <Icon size={13} strokeWidth={2} color={meta.color} className="signal-icon" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="signal-title">{n.title}</div>
                        <div className="signal-time">{relativeTime(n.created_at)}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="dash-panel__foot">
              <Link href="/notifications" className="dash-more">
                View all <ArrowRight size={12} />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  foot,
  failed,
}: {
  label: string;
  value: string | null;
  unit: string;
  foot: string;
  /** True when the load finished and failed. A skeleton then is a lie:
   *  nothing is still coming. */
  failed?: boolean;
}) {
  return (
    // No .panel here: the surface, border and radius belong to
    // .kpi-strip, which draws one card for all five. A .panel per cell
    // would put a border back around each and undo the point.
    <div className="dash-kpi">
      <div className="dash-kpi__label">{label}</div>
      {value === null && failed ? (
        <div className="dash-kpi__value" style={{ color: "var(--text-dim)" }}>—</div>
      ) : value === null ? (
        <div className="skeleton skeleton--line" style={{ width: "72%", height: "22px", marginTop: "8px" }} />
      ) : (
        <div className="dash-kpi__value">
          {value}
          <span className="dash-kpi__unit">{unit}</span>
        </div>
      )}
      <div className="dash-kpi__foot">
        <span className="dash-delta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value === null ? (failed ? "unavailable" : "reading the sheet…") : foot}
        </span>
      </div>
    </div>
  );
}

/** Both variance panels wait the same way, so the pair does not arrive
 *  looking like two different components. */
function VarianceWaiting() {
  return (
    <div style={{ padding: "0 15px 12px" }}>
      <div className="skeleton-stack">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton skeleton--row" />
        ))}
      </div>
    </div>
  );
}

/** A chart's own waiting state. Sized to the slot it will fill, so the
 *  row does not resize when the series lands. */
function ChartWaiting() {
  return (
    <div className="skeleton" style={{ position: "absolute", inset: 0, borderRadius: "var(--r-md)" }} role="status" aria-label="Loading chart" />
  );
}
