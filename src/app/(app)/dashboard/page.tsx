"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
// <Chart>, not <Bar>, for the mixed charts: <Bar> is typed to "bar"
// datasets only, and those carry a line dataset on a second axis. <Bar>
// itself was the deliveries panel's component and went with it; the two
// bar-drawing charts on this page are both mixed, so both use <Chart>.
import { Chart, Doughnut, Line } from "react-chartjs-2";
import { ArrowRight, Fuel, Gauge, Info, MapPinOff, Pencil } from "lucide-react";
import { useFleet } from "@/components/providers/FleetProvider";
import {
  getDashboardBundle,
  readFuelBudget,
  saveFuelBudget,
  type DashboardBundle,
  type FuelBudget,
  type FuelPeriodStats,
  type FuelModelStat,
  type StationLeaders,
  type DashboardSeries,
  type DriverVariance,
  type TruckVariance,
  type DriverSpeeding,
  type VhServiceStats,
  type MonthlyVariance,
} from "@/lib/supabase/dashboard";
// The month panel's formatting and its three deliberate drawing rules —
// oldest-first, the pale current month, green for a month that saved —
// all live in a plain module so scripts/check-months.mts can pin them.
// See lib/fuel/months.ts for why each of them fails silently.
import {
  countBands,
  intelBand,
  varianceBand,
  INTEL_BANDS,
  VARIANCE_BANDS,
} from "@/lib/dashboard/breakdown";
import {
  isCurrentMonth,
  monthAxisLabel,
  monthBarColour,
  monthFullLabel,
  monthKey,
  totalVariance,
} from "@/lib/fuel/months";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import {
  CHART_COLORS,
  STATION_RAMP,
  doughnutOptions,
  stationDoughnutOptions,
  installChartDefaults,
  timeSeriesOptions,
  dualAxisTimeSeriesOptions,
  AREA_SERIES,
  BAR_SERIES,
  LINE_SERIES,
  areaFill,
  crosshairPlugin,
  doughnutCentrePlugin,
  doughnutSliceLabelPlugin,
} from "@/lib/chartTheme";
import RangeBar, { buildPresets, describeRange, presetKeyFor } from "@/components/dashboard/RangeBar";
import type { OpsRange } from "@/lib/dashboard/range";
import { previousRange, daysInRange, sameRange, monthStart } from "@/lib/dashboard/range";
import { periodDelta } from "@/lib/dashboard/delta";
import { makeCache, isFresh } from "@/lib/dashboard/cache";
import Combobox, { type ComboOption } from "@/components/forms/Combobox";
import {
  type Scope,
  type ScopeOption,
  FLEET,
  isFleet,
  scopeLabel,
  optionToScope,
  isSplitSource,
  matchesDriver,
  scopeFromParams,
  scopeToQuery,
} from "@/lib/dashboard/scope";
import type { PeriodDelta } from "@/lib/dashboard/delta";
import { opsToday } from "@/lib/format";
import { ASSUMED_L_PER_100KM } from "@/lib/fuel/parse";
import {
  classifyIntel,
  driverRating,
  intelClass,
  intelLabel,
  INTEL_CHART_CEILING,
  leaderboardFloorKm,
  RATING_AT_LIMIT,
  RATING_DA_PER_STAR,
  RATING_MAX,
  RATING_MIN,
  type IntelResult,
} from "@/lib/fuel/intelligence";
// Data-derived axis bounds. See the module for why the axis moves rather
// than the offending point being dropped.
import { seriesBounds } from "@/lib/dashboard/bounds";
import { TruckIntelWindow } from "@/components/dashboard/TruckIntelWindow";
import { SPEED_LIMIT_KMH } from "@/lib/constants";

// BarController and LineController are registered EXPLICITLY, not left to
// react-chartjs-2's per-component auto-registration. Two charts here are
// mixed datasets — bars on one axis, a line on the other — and they need
// both controllers whichever component draws them. Naming both here means
// dropping any single chart cannot silently break the others.
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

/** The median of a list, or null when there is nothing to take one of.
 *
 *  `percentile_disc(0.5)` semantics on purpose, so this and the SQL
 *  median used to explore the data cannot be compared and found to
 *  disagree: the first value whose 1-based position is at least half the
 *  count, which for an even count is the LOWER of the two middle values
 *  and not their average. Null rather than 0 for an empty list, because
 *  the callers turn null into "no floor" and 0 into "everyone
 *  qualifies" — two opposite readings of the same empty array. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

/** Budget figures carry cents — 11,234,123.31, not 11,234,123 — so they
 *  round to the dinar, not to the whole. The two formatters sit apart
 *  on purpose: almost nothing else on this page keeps two decimals. */
const money = (n: number) =>
  n.toLocaleString("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** "2026-08-25" -> "25 Aug", for an axis that has to fit thirty of them. */
function axisLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
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
 * One ring, for the rail. The shape the two panels at the top of the
 * column already use, and nothing about it is new.
 *
 * THE LEGEND IS ON, which reverses the station ring's decision and
 * needs the reason, because the two look like the same choice and are
 * not. "Where we fill up" is seven arcs whose labels are station names
 * — the current leader is 46 characters — so its legend could only be
 * abbreviated past being words, and it turns the legend off and puts one
 * ranked name in the foot instead. These bands are four and five short
 * common words, and here the legend is the ONLY place they appear: a
 * green arc and a red arc with nothing naming them is a picture of the
 * taxonomy rather than a reading of it. Two lines is what it costs, and
 * the ring is still 190px.
 *
 * `doughnutOptions` brings the legend with it, so the first draft of
 * this panel had one by accident rather than by argument. It is now the
 * argument above, and the band names are short enough that four fit a
 * line at 350px — which is the constraint that decided them. "No verdict"
 * was "No data" at one point and became "None" for the same reason: it
 * was the one label that wrapped onto a line of its own.
 *
 * The slices are handed in already coloured and already in order. This
 * component draws; it does not decide what a "watch" truck is, because a
 * component that picked the colour of a fleet state would be a second
 * place for the taxonomy to live.
 */
type CaptionedDoughnutDataset = ChartData<"doughnut", number[], string>["datasets"][number] & {
  /** Read by doughnutCentrePlugin for the resting caption. It casts for
   *  this property itself, so Chart.js's own dataset type has no reason
   *  to know it exists — hence the intersection rather than a widened
   *  type or an `as unknown as`. */
  centreCaption: string;
};

function RailRing({
  title,
  sub,
  centre,
  slices,
  foot,
  waiting,
  empty,
}: {
  title: string;
  sub: string;
  /** What the hole reads at rest. The centre plugin takes the rest off
   *  the dataset, and swaps in "label · N%" on hover. */
  centre: string;
  slices: { label: string; value: number; color: string }[];
  foot: string;
  waiting: boolean;
  empty: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <section className="panel dash-panel">
      <header className="dash-panel__head">
        <div style={{ minWidth: 0 }}>
          <div className="dash-panel__title">{title}</div>
          <div className="dash-panel__sub">{sub}</div>
        </div>
      </header>
      <div className="dash-panel__body">
        {waiting ? (
          <div className="skeleton" style={{ height: 190, borderRadius: "var(--r-md)" }} />
        ) : total === 0 ? (
          <p className="dash-empty">
            <span>
              <Fuel size={15} style={{ display: "block", margin: "0 auto 7px" }} />
              {empty}
            </span>
          </p>
        ) : (
          <div className="dash-chart dash-chart--donut">
            <Doughnut
              data={{
                labels: slices.map((s) => s.label),
                datasets: [
                  {
                    data: slices.map((s) => s.value),
                    backgroundColor: slices.map((s) => s.color),
                    borderWidth: 0,
                    centreCaption: centre,
                  } as CaptionedDoughnutDataset,
                ],
              }}
              options={doughnutOptions}
              plugins={[doughnutCentrePlugin]}
            />
          </div>
        )}
      </div>
      {total > 0 && <div className="dash-panel__foot dash-ring-foot">{foot}</div>}
    </section>
  );
}

/**
 * A small round button that reveals an explanation, and the explanation.
 *
 * WHY A BUTTON AND NOT A TITLE ATTRIBUTE. Every other explanation on this
 * dashboard is a `title`, which means it appears on hover, disappears on
 * touch, is unreachable by keyboard, and cannot hold a paragraph. This
 * one has to carry the rating scale — four anchors and a formula — and
 * that is a panel, not a tooltip.
 *
 * WHY `Info` AND NOT AN EXCLAMATION. An exclamation circle is a warning
 * glyph, and this dashboard spends red and amber on vehicle states: a
 * reader who has learned that vocabulary sees a warning icon next to
 * their colleagues' names and reads a warning into it. The circle is the
 * same shape; the mark inside it says "here is how this was worked out",
 * which is what it does.
 */
function ExplainButton({ children, label }: { children: React.ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  // Dismiss on Escape and on a click anywhere else. Without the second,
  // the panel stays open over the table after the reader has moved on,
  // and there is no visible control left to close it — the button is
  // behind the panel it opened.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <span className="explain" ref={wrap}>
      <button
        type="button"
        className="explain__btn"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={12} aria-hidden="true" />
      </button>
      {open && <div className="explain__pop">{children}</div>}
    </span>
  );
}

/**
 * Best performing drivers — the podium.
 *
 * The only panel here that puts a RANK on a named person, so three
 * things are deliberate and none of them is styling:
 *
 *   - IT IS A SHORTLIST, not the roster. The full sortable list of every
 *     driver is the panel directly above this one; a leaderboard that
 *     showed all 196 would be a league table, and a league table with
 *     named colleagues at the bottom of it is a different instrument
 *     from a shortlist. There is no "worst performers" panel anywhere in
 *     this app and there is not going to be one.
 *
 *   - THE RATING IS NOT A SCORE FOR THE PERSON. It measures one thing —
 *     fuel cost per 100km against the rate the sheet assumes — and the
 *     pop-up says so in those words, because a star next to a colleague's
 *     name will otherwise be read as a grade. driverRating's own comment
 *     is the long version of the same argument.
 *
 *   - THE FLOOR IS STATED, not applied silently. A driver below it is
 *     absent rather than ranked last, and the sub-line says what the
 *     threshold is in dinars and kilometres, so "why isn't X on here" has
 *     an answer on the page.
 */
function DriverLeaderboard({
  board,
  ASSUMED,
}: {
  board: {
    floorKm: number;
    eligible: number;
    rows: (DriverVariance & { rating: number | null })[];
  } | null;
  /** The sheet's assumed rate, passed in rather than imported: this is a
   *  server prop on the page's own data and the pop-up quotes the number
   *  the RANGE was measured against. */
  ASSUMED: number;
}) {
  const { t } = useTranslation();

  return (
    <section className="panel dash-panel">
      <header className="dash-panel__head">
        <div style={{ minWidth: 0 }}>
          <div className="dash-panel__title">
            {t("Best performing drivers")}
            <ExplainButton label={t("How the rating is calculated")}>
              <p className="explain__lede">
                {t(
                  "The rating measures fuel cost against the {rate} L/100km the sheet assumes. It is not a score for the driver: it says nothing about safety, punctuality or hours, and it does not judge the truck.",
                  { rate: ASSUMED }
                )}
              </p>
              <p>
                {t("One star per {da} DA of variance per 100km.", { da: RATING_DA_PER_STAR })}
              </p>
              <ul className="explain__scale">
                <li>
                  <b>{RATING_MAX.toFixed(1)}</b>{" "}
                  {t("at {da} DA saved per 100km or better", { da: RATING_DA_PER_STAR * 2 })}
                </li>
                <li>
                  <b>{RATING_AT_LIMIT.toFixed(1)}</b>{" "}
                  {t("exactly the assumed rate — neither saved nor lost")}
                </li>
                <li>
                  <b>{RATING_MIN.toFixed(1)}</b>{" "}
                  {t("at {da} DA lost per 100km or more", { da: RATING_DA_PER_STAR * 2 })}
                </li>
              </ul>
              <p>
                {t("Ranked on that rate, not on total variance: a driver who barely drives loses almost nothing, and standing still is not a performance.")}
              </p>
            </ExplainButton>
          </div>
          <div className="dash-panel__sub">
            {board === null
              ? t("Least overspend per 100km, among the drivers who drove far enough to be ranked.")
              : t("Least overspend per 100km, among the {n} drivers who covered at least {km} km in this range.", {
                  n: nf(board.eligible),
                  km: nf(board.floorKm),
                })}
            {" "}
            {t("The full list of every driver is above.")}
          </div>
        </div>
      </header>
      <div className="dash-panel__body dash-panel__body--flush">
        {board === null ? (
          <VarianceWaiting />
        ) : board.rows.length === 0 ? (
          <p className="dash-empty">
            {t("No driver covered enough ground in this range to be ranked.")}
          </p>
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>{t("Trucks")}</th>
                  <th>{t("Driver name")}</th>
                  <th>{t("Distance")}</th>
                  <th>{t("Variance")}</th>
                  <th>{t("Rating")}</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((d) => (
                  <tr key={d.driverName}>
                    <td className="t-dim">{d.truckCount}</td>
                    <td className="t-primary">{d.driverName}</td>
                    <td>{`${nf(d.km)} km`}</td>
                    <td className={signedClass(d.varianceDa)}>{signed(d.varianceDa, "DA")}</td>
                    <td>
                      {/* The star is decoration for a number beside it,
                          never the number itself: a half-filled star
                          would have to be explained, and "4.7" cannot. */}
                      <span className="rating">
                        <span className="rating__star" aria-hidden="true">★</span>
                        <span className="rating__n">
                          {d.rating == null ? "—" : d.rating.toFixed(1)}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {board !== null && board.rows.length > 0 && (
        <div className="table-foot-note">
          {t("Top {shown} of {eligible} drivers who cleared the floor.", {
            shown: board.rows.length,
            eligible: nf(board.eligible),
          })}
        </div>
      )}
    </section>
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
  const { t } = useTranslation();
  const worst = rows && rows.length > 0 ? Math.max(...rows.map((r) => r.times)) : 0;
  const total = rows ? rows.reduce((sum, r) => sum + r.times, 0) : 0;

  return (
    <section className="panel dash-panel">
      <header className="dash-panel__head">
        <div>
          <div className="dash-panel__title">{t("Over the limit, by driver")}</div>
          <div className="dash-panel__sub">
            {t("Times above {limit} km/h this month, anywhere in the fleet.", { limit: SPEED_LIMIT_KMH })}
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
              {t("Nobody has crossed {limit} km/h this month.", { limit: SPEED_LIMIT_KMH })}
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
                  {r.truckCount > 1 ? t("{n} trucks", { n: r.truckCount }) : (r.trucks ?? "")}
                </span>
                <span className="rank-row__value">{r.times}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {rows !== null && rows.length > 0 && (
        <div className="table-foot-note">
          {t(
            total === 1
              ? "{crossings} crossing of the limit by {drivers} driver. Slowing down and speeding up again counts twice."
              : "{crossings} crossings of the limit by {drivers} drivers. Slowing down and speeding up again counts twice.",
            { crossings: total, drivers: rows.length },
          )}
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

/** Six named stations on the donut, plus a remainder arc. Lives here
 *  rather than inline so the fetch and the chart cannot disagree about
 *  how many the ramp has to colour. */
const STATION_SLICES = 6;

/** What the page already knows, kept between visits.
 *
 * AT MODULE SCOPE, and that is the whole point: a useState or a useRef
 * dies with the component, and the complaint this answers is precisely
 * about leaving the page and coming back. The module stays loaded across
 * client-side navigation, so dispatch → dashboard finds its last answers
 * still here and paints them before any request is made. It dies with the
 * tab, so it is per-user and per-session by construction.
 */
const bundles = makeCache<DashboardBundle>();

/** Range and scope together are what the answer depends on, so they are
 *  what the key is made of. */
function bundleKey(range: OpsRange, scope: Scope): string {
  return `${range.from ?? ""}|${range.to ?? ""}|${scopeToQuery(scope)}`;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { fleetData, dispatches } = useFleet();

  const [fuel, setFuel] = useState<FuelPeriodStats | null>(null);
  // The same five figures for the window before this one, for the deltas
  // under the scorecards. Held separately rather than folded into `fuel`
  // so a comparison that cannot be made — All time has nothing before it
  // — is `null` rather than a set of zeroes that would read as a 100%
  // collapse.
  const [prevFuel, setPrevFuel] = useState<FuelPeriodStats | null>(null);
  const [stations, setStations] = useState<StationLeaders | null>(null);
  const [models, setModels] = useState<FuelModelStat[] | null>(null);
  const [series, setSeries] = useState<DashboardSeries | null>(null);
  // Defaults to the last 30 ops days: the widest window the old control
  // offered, so a returning reader sees roughly what they saw before
  // rather than the whole sheet at once.
  const [range, setRange] = useState<OpsRange>(() => buildPresets().find((p) => p.key === "30d")!.range);
  const [variance, setVariance] = useState<DriverVariance[] | null>(null);
  const [truckVariance, setTruckVariance] = useState<TruckVariance[] | null>(null);
  const [previousTrucks, setPreviousTrucks] = useState<TruckVariance[] | null>(null);
  const [historyTrucks, setHistoryTrucks] = useState<TruckVariance[] | null>(null);
  // Intelligence detail selection: one open truck at a time. Reset when
  // the bundle key moves (see apply) — a detail about September's rows
  // must not linger over October's.
  const [intelTruck, setIntelTruck] = useState<string | null>(null);
  const lastBundleKey = useRef("");
  const [speeding, setSpeeding] = useState<DriverSpeeding[] | null>(null);
  // Feeding the fuel-budget gauge, exactly as the rest of the page: the
  // bundle carries the current month's budget and the caller's right to
  // edit it, so the gauge appears with the other panels instead of
  // running a second queued action (and second getUser) on its own mount.
  const [budget, setBudget] = useState<FuelBudget | null>(null);
  const [canEditBudget, setCanEditBudget] = useState(false);
  // The sixth scorecard's pot. Null is "not read yet" — the skeleton,
  // not a zero; a window with no Vh Service fills legitimately reads 0
  // once the bundle lands.
  const [vhService, setVhService] = useState<VhServiceStats | null>(null);
  // Every month in the sheet, oldest first. Range-INDEPENDENT (078) and
  // deliberately not cleared by a range change — unlike everything else
  // in this bundle, it does not describe the selected window.
  const [months, setMonths] = useState<MonthlyVariance[] | null>(null);
  // Whether the last load actually succeeded. Without this a failed RPC
  // is INDISTINGUISHABLE from a slow one: every panel keeps its skeleton
  // and its "reading the sheet…" caption forever, which is exactly what
  // happened when 047 changed five signatures and PostgREST was still
  // serving the old ones from its schema cache. The page looked like it
  // was buffering. It had already failed.
  const [dataError, setDataError] = useState<string | null>(null);
  // WHICH RANGE THE FIGURES ON SCREEN ACTUALLY COVER — not the one the
  // control is set to. These are two different things the moment a load
  // is in flight or has failed, and the page used to print the second
  // over the first.
  //
  // The failure this fixes, seen in production 2026-09-13: the fetch
  // rejected (a client left open across a deploy calling server-action
  // ids the new build no longer had), the catch set an error and touched
  // nothing else, so every panel kept the PREVIOUS range's numbers while
  // this heading — driven by `range` — had already moved to the new one.
  // The page then stated, in words, that 884,122 km covered 1-13
  // September, when that figure was a 30-day window. A blank panel is a
  // missing answer; a confident wrong one is worse.
  const [loadedRange, setLoadedRange] = useState<OpsRange | null>(null);

  // What the page is about: the whole fleet, one driver, or one truck.
  // Read from the query string on mount so a focused dashboard can be
  // sent to someone, the same reasoning as dispatch's ?truck= param.
  const [scope, setScope] = useState<Scope>(FLEET);
  const [scopeOptions, setScopeOptions] = useState<ScopeOption[]>([]);

  useEffect(() => {
    setScope(scopeFromParams(new URLSearchParams(window.location.search)));
  }, []);

  // The roster behind the search box is fetched ONCE — who exists does
  // not depend on which fortnight is on screen — but it no longer has an
  // effect of its own. It rides the first bundle instead, because a
  // second server action would not have run beside that one: Next queues
  // actions and runs them one at a time, so an independent request here
  // simply added its whole latency to the mount. This ref is what keeps
  // it to the first load; it costs 173ms against 7-23ms for everything
  // else in the bundle, so asking for it per range would be the most
  // expensive thing on the page.
  const rosterLoaded = useRef(false);

  // Keep the URL in step without adding a history entry per selection —
  // replaceState, so Back still leaves the dashboard rather than walking
  // through every truck the operator looked at.
  useEffect(() => {
    const url = window.location.pathname + scopeToQuery(scope);
    window.history.replaceState(null, "", url);
  }, [scope]);

  // ── The sheet changed while you were looking at it ──
  //
  // The sync route touches the one-row fuel_sync_signals table (migration
  // 066) after every successful refresh — including the 15-minute cron —
  // so this page hears one small Realtime event per sync instead of the
  // whole fuel_transactions table being rewritten row by row. On the
  // signal: drop every cached bundle, because the change is global and
  // not scoped to the range on screen, then re-run the load effect below
  // by bumping fuelVersion. The figures already on screen stay painted
  // while the refresh is in flight — apply() replaces them, never blanks
  // them.
  const [supabase] = useState(() => createClient());
  const [fuelVersion, setFuelVersion] = useState(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel("dashboard-fuel-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_sync_signals" }, () => {
        // Debounced, because trailing pushes and the cron can land a
        // second apart; one refetch 800ms after the last signal covers
        // them all.
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          reloadTimer.current = null;
          bundles.clear();
          setFuelVersion((v) => v + 1);
        }, 800);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [supabase]);

  // Every historical panel reads the same range, in ONE effect. Five
  // separate effects on the same dependency would fire five renders as
  // they landed and let the page sit briefly in a state where the
  // scorecards describe August and the tables still describe July —
  // which is the exact incoherence this control exists to remove.
  //
  // ONE SERVER ACTION, not seven, and it is not a tidiness point.
  // Promise.all does NOT make server actions concurrent: Next queues
  // them and runs them strictly one at a time, so the old call below
  // paid seven round trips end to end — measured on this toolchain at
  // 300ms of work apiece, seven actions took 2,180ms against 308ms for
  // the same work behind one. Each also opened with its own
  // auth.getUser(), which is a network call, so the real bill was
  // sixteen sequential hops for figures Postgres produces in 7-23ms.
  // That is how this page reached a 504 with no slow query in it.
  //
  // AND IT IS SERVED FROM CACHE WHERE IT CAN BE. `bundles` lives at
  // module scope, so coming back from dispatch finds the last answers
  // already here: they are painted before anything is requested, and
  // under FRESH_MS nothing is requested at all. Past that the stale copy
  // still goes up immediately and is replaced when the refresh lands —
  // the wait disappears rather than moving.
  useEffect(() => {
    let cancelled = false;

    // Applied together, always. Panels that landed independently would
    // let the page sit in a state where the scorecards describe one
    // truck and the charts beneath still describe the fleet, or where a
    // delta describes a window its own figure no longer covers.
    const apply = (b: DashboardBundle) => {
      // A new bundle key means a new range or scope: the open detail (if
      // any) described the old rows, so it closes rather than lingering
      // over figures it no longer matches. A refresh under the same key
      // keeps it open — the data just got newer, not different.
      const k = bundleKey(range, scope);
      if (k !== lastBundleKey.current) {
        lastBundleKey.current = k;
        setIntelTruck(null);
      }
      // The comparison's own failure is NOT folded into dataError: the
      // page is still correct without a delta, and failing the whole
      // dashboard because the previous month would not load would trade
      // a working page for a missing footnote.
      setPrevFuel(b.previousFuel ?? null);
      setStations(b.stations ?? null);
      setModels(b.models ?? null);
      setDataError(b.error ?? null);
      setFuel(b.fuel ?? null);
      setSeries(b.series ?? null);
      setVariance(b.drivers ?? null);
      setTruckVariance(b.trucks ?? null);
      setPreviousTrucks(b.previousTrucks ?? null);
      setHistoryTrucks(b.historyTrucks ?? null);
      setSpeeding(b.speeding ?? null);
      setBudget(b.budget ?? null);
      setCanEditBudget(b.canEdit === true);
      setVhService(b.vhService ?? null);
      setMonths(b.months ?? null);
      // Only when they were asked for. `undefined` on a refresh means
      // "not requested", never "the roster is empty", so the picker
      // keeps the list it already holds.
      if (b.options) setScopeOptions(b.options);
      // Last, and only with an answer in hand: from here the heading
      // describes these numbers rather than the control above them.
      setLoadedRange(range);
    };

    const key = bundleKey(range, scope);
    const hit = bundles.get(key, Date.now());
      if (hit) {
        apply(hit.value);
        // Fresh enough to stand on its own — no request at all. This is
        // the case the owner asked for: between syncs, re-asking the
        // moment someone navigates back buys nothing and costs the whole
        // wait. When the sheet DOES change, the fuel_sync_signals
        // subscription above clears this cache, so the bump to
        // fuelVersion re-runs this effect against an empty one.
        if (isFresh(hit.ageMs)) return;
    } else {
      // Nothing to show yet, so clear a stale error rather than leaving
      // the last failure sitting over a load that has not failed.
      setDataError(null);
    }

    // Computed here, not server-side, and used twice: the label under
    // the figures reads from the same expression, so the two cannot
    // disagree about what "the month before" meant.
    const comparison = previousRange(range, { calendar: presetKeyFor(range) === "month" });

    void getDashboardBundle(
      range,
      comparison,
      scope,
      { variance: 500, speeding: 100, stations: STATION_SLICES },
      !rosterLoaded.current
    )
      .then((b) => {
        if (cancelled) return;
        if (b.options) rosterLoaded.current = true;
        // A FAILED BUNDLE IS NOT CACHED. Storing it would serve the
        // gateway's bad minute back instantly for the next FRESH_MS,
        // which is the one thing worse than waiting for it.
        if (!b.error) bundles.set(key, b, Date.now());
        apply(b);
      })
      .catch((e: unknown) => {
        // Deliberately does NOT clear the figures. They are still true
        // about loadedRange, and throwing away a working page over one
        // transient rejection helps nobody. What must not happen is
        // relabelling them — so loadedRange is left exactly where it was
        // and the heading keeps naming the period these numbers describe.
        if (!cancelled) setDataError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [range, scope, fuelVersion]);

  /**
   * What the deltas are measured against, in the reader's words.
   *
   * Named from the PRESET rather than built from the dates, because
   * "vs 25 Aug → 31 Aug" makes someone do the arithmetic to find out it
   * means last week. Falls back to the day count for a typed range,
   * where there is no name to use.
   */
  const comparisonLabel = useMemo(() => {
    const comparison = previousRange(range, { calendar: presetKeyFor(range) === "month" });
    if (!comparison || !comparison.from || !comparison.to) return "";
    switch (presetKeyFor(range)) {
      case "today": return t("vs yesterday");
      case "yesterday": return t("vs the day before");
      case "7d": return t("vs the previous 7 days");
      case "30d": return t("vs the previous 30 days");
      case "month": return t("vs the same days last month");
      case "lastMonth": return t("vs the month before");
      default: return t("vs the previous {n} days", { n: daysInRange(comparison.from, comparison.to) });
    }
  }, [range, t]);

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
    labels: [t("Moving"), t("Stationary"), t("Offline")],
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

  // ── Where the fleet fills up ──
  //
  // Six named stations and one remainder. Six because the tail is the
  // shape of this data — 318 distinct stations, the top six about a
  // third of fills — so more slices would not add a readable one, and
  // fewer would make the remainder even more of the ring than it
  // already is.
  const stationChart = useMemo(() => {
    if (!stations || stations.totalFills === 0) return null;
    const named = stations.leaders;
    const namedFills = named.reduce((n, l) => n + l.fills, 0);
    // From the RPC's own total, NOT from summing a list that was
    // limited to six — that subtraction is the whole point of asking
    // SQL for the total separately.
    const otherFills = Math.max(0, stations.totalFills - namedFills);
    const otherStations = Math.max(0, stations.totalStations - named.length);

    const labels = named.map((l) => l.station);
    const data = named.map((l) => l.fills);
    if (otherFills > 0) {
      labels.push(t("{n} other stations", { n: otherStations }));
      data.push(otherFills);
    }

    return {
      chart: {
        labels,
        datasets: [
          {
            data,
            // The ramp's last entry is the achromatic remainder, so a
            // window with no tail must not take it for a station.
            backgroundColor: data.map((_, i) =>
              i === data.length - 1 && otherFills > 0
                ? STATION_RAMP[STATION_RAMP.length - 1]
                : STATION_RAMP[Math.min(i, STATION_RAMP.length - 2)]
            ),
            borderWidth: 0,
            centreCaption: t("fills"),
          },
        ],
      },
      top: named[0] ?? null,
      otherStations,
    };
  }, [stations, t]);

  // ── The two variance tables, narrowed to the scope ──
  //
  // Filtered here rather than in SQL: both RPCs already return one row
  // per entity over the whole range (92 drivers, 74 trucks), so the
  // answer is in memory and two more signatures would have to be kept in
  // step for nothing.
  //
  // The CROSS pairing is the useful half. Scoped to a driver, the truck
  // table shows the trucks HE filled — DriverVariance.trucks already
  // carries that list. Scoped to a truck, the driver table shows the men
  // who filled IT, found the same way. So each panel answers "and who/
  // what was on the other side of this" rather than going blank.
  const scopedDriverVariance = useMemo(() => {
    if (!variance) return null;
    if (isFleet(scope)) return variance;
    if (scope.kind === "driver") return variance.filter((r) => matchesDriver(scope, r.driverName));
    // Truck scope: drivers whose truck list names this truck.
    return variance.filter((r) =>
      (r.trucks ?? "").split(",").map((x) => x.trim()).includes(scope.id)
    );
  }, [variance, scope]);

  // How many names the podium shows. Eight, and the number is a
  // MEASUREMENT rather than a preference: the two dashboard columns are
  // laid out to end level, and with seven rows the main column finished
  // 37px short of the rail. One row is 44px, so eight overshoots by 7 —
  // 0.3% of a 2396px page, against 37px of visible ragged edge at seven.
  //
  // It will not hold for every range, and cannot: a seven-day window
  // leaves too few drivers clear the distance floor to fill a podium at
  // all. This is tuned to the 30-day default, which is what the page
  // opens on, and the empty state covers the short case.
  const PODIUM_ROWS = 8;

  // ── The driver's podium ──
  //
  // A handful of rows out of ~196, so this is a LEADERBOARD and not
  // another table: the reader is meant to take the top of it and stop.
  // The full sortable roster is the panel this one sits above, one
  // screen away.
  //
  // Built from `scopedDriverVariance` rather than from `variance`, so it
  // obeys the same scope picker the rest of the fuel panels do. Scoped
  // to one driver it collapses to that driver or to nothing, which is
  // correct: a leaderboard of one is that driver's own row, and the
  // empty state says why.
  //
  // THREE RULES, in this order, and the order is the argument:
  //
  //   1. A rate or nothing. variancePer100Km is null for a driver with
  //      no fill that logged a distance, and a rate is the only thing
  //      this panel ranks or rates. Such a driver is not "unrated", they
  //      are absent — the roster carries them.
  //   2. The distance floor. Half the median driver's distance for this
  //      range, so a three-fill sample cannot win a panel whose whole
  //      claim is "who drove the most". See leaderboardFloorKm for why
  //      the threshold is the median and not a number.
  //   3. The rate itself, ascending. Least overspend per 100km first.
  //
  // The median is taken over the SCOPED rows, not the whole fleet: when
  // the picker is on one truck the floor has to describe that truck's
  // drivers, or a short week would leave the panel empty for a fleet
  // that has simply been filtered.
  const leaderboard = useMemo(() => {
    if (scopedDriverVariance === null) return null;
    const rated = scopedDriverVariance.filter((d) => d.variancePer100Km != null);
    const floorKm = leaderboardFloorKm(median(rated.map((d) => d.km)));
    const eligible = rated.filter((d) => d.km >= floorKm);
    return {
      floorKm,
      eligible: eligible.length,
      // Ties on the rate are common — 4.5 is a whole band of drivers —
      // and the tiebreak is distance, so equal rates read as "these two
      // were equally efficient, this one just drove more of it".
      rows: eligible
        .sort((a, b) => a.variancePer100Km! - b.variancePer100Km! || b.km - a.km)
        .slice(0, PODIUM_ROWS)
        .map((d) => ({ ...d, rating: driverRating(d.variancePer100Km) })),
    };
  }, [scopedDriverVariance]);

  const scopedTruckVariance = useMemo(() => {
    if (!truckVariance) return null;
    if (isFleet(scope)) return truckVariance;
    if (scope.kind === "truck") return truckVariance.filter((r) => r.truckId === scope.id);
    // Driver scope: the trucks named on that driver's own variance row.
    const mine = new Set(
      (variance ?? [])
        .filter((r) => matchesDriver(scope, r.driverName))
        .flatMap((r) => (r.trucks ?? "").split(",").map((x) => x.trim()))
        .filter(Boolean)
    );
    return truckVariance.filter((r) => mine.has(r.truckId));
  }, [truckVariance, variance, scope]);

  // ── The two rail rings ──
  //
  // Both are aggregations of rows the bundle already has, so neither
  // costs a query. Both obey the scope picker, because both are built
  // from the SCOPED lists — a ring that ignored the picker would keep
  // describing the whole fleet while every panel above it described one
  // truck, which is the exact confusion the picker exists to prevent.
  //
  // The bucketing itself is in lib/dashboard/breakdown.ts, and the reason
  // it is not a reduce written here is in that file's comment: a ring
  // cannot show you that it dropped a row.
  const varianceRing = useMemo(() => {
    if (scopedDriverVariance === null) return null;
    const counts = countBands(scopedDriverVariance, (d) => varianceBand(d.varianceDa), VARIANCE_BANDS);
    const total = scopedDriverVariance.length;
    return { counts, total };
  }, [scopedDriverVariance]);

  // ── The two daily charts that a single row could break ──
  //
  // Both of these draw the L/100km rate, and on 2026-09-26 they were
  // unreadable over All time because of sheet row 9: a 10,000 DA prepaid
  // fill on 2 January booked as 322.58 litres against 51km, which is
  // 632 L/100km for that day. One reading out of 259 stretched the axis
  // to 800 and flattened the other 258 into the bottom 5% of the plot.
  //
  // The row is real — a bulk purchase measured over the distance since
  // the last fill, not a tank top-up — and nothing on this page adjusts a
  // figure to look better, so the AXIS moves instead. The point is not
  // deleted: it is drawn running off the top edge, which is visible.
  //
  // These bounds are NULL whenever the series is short or flat, and the
  // chart options treat null as "do not pin", so a 7-day or 30-day view
  // is exactly what it was before this existed. INTEL_CHART_CEILING is
  // the hard cap: the percentile is the first line of defence and this is
  // the one that holds when the sample is too small to have a percentile
  // worth trusting.
  const consumptionBounds = useMemo(
    () => seriesBounds((series?.consumption ?? []).map((p) => p.value), { hardMax: INTEL_CHART_CEILING }),
    [series]
  );

  // ── Prism Intelligence ──
  //
  // The comparison window is the SAME value the load effect passes to
  // the bundle (previousRange over the range, calendar-aware for the
  // month preset) — recomputed here because the effect's copy is local
  // to it and the detail fetch below needs it in render scope. Pure
  // function, same inputs, so the two cannot disagree.
  const comparisonRange = useMemo(
    () => previousRange(range, { calendar: presetKeyFor(range) === "month" }),
    [range]
  );

  // One signal per truck, over the FULL rosters — scoping filters rows
  // for display, but the comparison itself must see every truck in both
  // windows, or a scoped view would read NO BASELINE for trucks whose
  // previous rows simply were not asked for.
  const truckIntel = useMemo(() => {
    const prev = new Map((previousTrucks ?? []).map((r) => [r.truckId, r]));
    const hist = new Map((historyTrucks ?? []).map((r) => [r.truckId, r]));
    const out = new Map<string, IntelResult>();
    for (const row of truckVariance ?? []) {
      const p = prev.get(row.truckId) ?? null;
      // Unknown history (no comparison ran, e.g. All time) is null, not
      // zero — zero means "never filled before" and is exactly what
      // separates NEW VEHICLE from NO BASELINE.
      const h = historyTrucks == null ? null : (hist.get(row.truckId)?.fills ?? 0);
      out.set(
        row.truckId,
        classifyIntel(
          { fills: row.fills, litresPer100Km: row.litresPer100Km },
          p ? { fills: p.fills, litresPer100Km: p.litresPer100Km } : null,
          h
        )
      );
    }
    return out;
  }, [truckVariance, previousTrucks, historyTrucks]);

  // The second rail ring, and the reason it lives HERE rather than beside
  // varianceRing above: it reads truckIntel, so it has to be declared
  // after the map that builds it. A useMemo above a const it references
  // is a temporal dead zone error at render, and tsc does not catch it
  // because the reference type-checks fine.
  //
  // Built from scopedTruckVariance, which already resolves all three
  // scope cases — fleet, one truck, one driver's trucks. Re-deriving the
  // scope here would be a fourth copy of a rule three panels share.
  const intelRing = useMemo(() => {
    if (scopedTruckVariance === null) return null;
    const counts = countBands(
      scopedTruckVariance,
      (r) => intelBand(truckIntel.get(r.truckId)?.state),
      INTEL_BANDS
    );
    return { counts, total: scopedTruckVariance.length };
  }, [scopedTruckVariance, truckIntel]);

  // The open panel's inputs, resolved from the same state the column
  // reads: the visible row (scoped or whole-roster), its previous
  // window, and a fresh classification so panel and cell can never
  // disagree.
  const intelDetail = useMemo(() => {
    if (!intelTruck) return null;
    const current =
      (scopedTruckVariance ?? truckVariance ?? []).find((r) => r.truckId === intelTruck) ?? null;
    if (!current) return null;
    const previous = previousTrucks?.find((r) => r.truckId === intelTruck) ?? null;
    const historyFills =
      historyTrucks == null ? null : (historyTrucks.find((r) => r.truckId === intelTruck)?.fills ?? 0);
    return {
      truckId: intelTruck,
      current,
      previous,
      intel: classifyIntel(
        { fills: current.fills, litresPer100Km: current.litresPer100Km },
        previous ? { fills: previous.fills, litresPer100Km: previous.litresPer100Km } : null,
        historyFills
      ),
    };
  }, [intelTruck, scopedTruckVariance, truckVariance, previousTrucks, historyTrucks]);

  // Drivers first, then trucks. The owner reaches for a name more often
  // than a plate, and the group headings make the two halves scannable
  // without reading every row.
  const comboOptions: ComboOption[] = useMemo(() => {
    const fmt = (o: ScopeOption) =>
      o.kind === "driver"
        ? `${o.fills} ${o.fills === 1 ? "fill" : "fills"} · ${o.visits} ${o.visits === 1 ? "visit" : "visits"}`
        : `${o.fills} ${o.fills === 1 ? "fill" : "fills"}`;
    return [...scopeOptions]
      .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label, "fr") : a.kind === "driver" ? -1 : 1))
      .map((o) => ({
        id: `${o.kind}:${o.id}`,
        label: o.label,
        hint: fmt(o),
        group: o.kind === "driver" ? t("Drivers") : t("Trucks"),
        // A driver the fuel sheet and the tracker spell differently
        // arrives here as two entries with one side at zero. Saying so
        // in the list beats letting someone pick one and wonder why half
        // the page is empty. See migration 060.
        note: isSplitSource(o) ? t("one source only") : null,
      }));
  }, [scopeOptions, t]);

  const comboValue = isFleet(scope) ? "" : `${scope.kind}:${scopeLabel(scope)}`;

  const labels = (series?.km ?? []).map((p) => axisLabel(p.day));

  // The ISO days behind each series, handed to the tooltip so it can name
  // the day in full where the axis only has room to abbreviate it. The
  // RPC returns every series dense over the same range, so these are the
  // same list four times — kept per series anyway, so that a series which
  // one day stops being dense cannot silently mislabel its own points.
  const kmDays = (series?.km ?? []).map((p) => p.day);
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

  // DELIVERIES IS NOT DRAWN, and that is a decision rather than an
  // omission. The panel was here until the roster needed the width, and
  // `series.deliveries` is still fetched every refresh and used nowhere.
  //
  // The series itself is intact and still in the bundle: migration 056
  // counts it into dashboard_daily_series, the RPC returns it, and no
  // migration is needed to bring the panel back. What went with it is
  // this memo, the gap-day finder, and three translation keys — all
  // removed rather than left orphaned, so the i18n check does not carry
  // three permanent warnings that train the next reader to ignore it.
  // It was cut because a complete, sortable, 199-row driver table at
  // full width was judged worth more than the fleet's only output
  // measure, and that is a judgement the owner made and can reverse.

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
        label: t("Litres"),
        data: (series?.litres ?? []).map((p) => (p.value == null ? null : Math.round(p.value))),
        type: "bar" as const,
        yAxisID: "y",
        order: 2,
        ...BAR_SERIES,
      },
      {
        label: t("L/100km"),
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
        label: t("Amount filled"),
        data: (series?.amountDa ?? []).map((p) => (p.value == null ? null : Math.round(p.value))),
        type: "bar" as const,
        yAxisID: "y",
        order: 2,
        ...BAR_SERIES,
      },
      {
        label: t("Cost per km"),
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

  // The fleet's arc, oldest month first (toMonthlyVariance reverses the
  // RPC's newest-first LIMIT). Three things make it different from
  // costChart and every other series on this page:
  //
  //   1. NOT a function of `range`. It is the whole record, always.
  //   2. The current month is drawn in a lighter wash. September is 24
  //      days of fills against August's 31, and its bar is low for that
  //      reason alone — without the wash the panel's last bar reads as a
  //      recovery, which is a number still moving.
  //   3. The tooltip names the month IN FULL, because a bar labelled
  //      "Aug" next to one labelled "Sep" invites a reader to compare
  //      them without noticing the year is the same.
  const today = opsToday();
  // The sub-line's caveat. Keyed on the LAST month rather than on "any
  // month is the current one", because a month in the future cannot
  // happen and a month in the past is not still counting — the panel
  // stops being provisional the moment the sheet rolls over.
  const lastMonthIsCurrent = isCurrentMonth(months?.at(-1)?.month ?? "", today);
  const monthTotal = totalVariance(months ?? []);

  const monthVarianceChart: ChartData<"bar" | "line", (number | null)[], string> = {
    labels: (months ?? []).map((m) => monthAxisLabel(m.month)),
    datasets: [
      {
        label: t("Variance"),
        data: (months ?? []).map((m) => m.varianceDa),
        type: "bar" as const,
        yAxisID: "y",
        order: 2,
        ...BAR_SERIES,
        // Per-bar, because two of the three rules are per-bar. Chart.js
        // takes an array here without complaint, and spreading BAR_SERIES
        // first means this is the only dataset key set twice — which is
        // the intent: the shared series style is the baseline, the array
        // is the exception that means something.
        backgroundColor: (months ?? []).map((m) =>
          monthBarColour(m.varianceDa, monthKey(m.month) === monthKey(today))
        ),
      },
      {
        label: t("L/100km"),
        data: (months ?? []).map((m) => (m.litresPer100Km == null ? null : m.litresPer100Km)),
        type: "line" as const,
        yAxisID: "y1",
        // Drawn over the bars, not through them.
        order: 1,
        ...LINE_SERIES,
        // Bigger points than the daily consumption line: this plot holds
        // a dozen points across a full-width panel, not 30 across a
        // third-width one, so a 3px dot would be a speck.
        pointRadius: 3,
        pointHoverRadius: 5,
      },
    ],
  };

  // The tooltip title, which dualAxisTimeSeriesOptions would otherwise
  // build from a daily `days` array this chart has no use for — months
  // are not days, and formatting "2026-08-01" as a weekday would be
  // worse than useless. Hence the helper's own `fullName` hook rather
  // than patching the returned object, which also widens its inferred
  // type and breaks every other chart that shares the components.
  const monthChartOptions = dualAxisTimeSeriesOptions({
    units: [" DA", " L/100km"],
    // Compact: a six-digit monthly figure is most of a full-width axis
    // label's width, and there can be sixty of them.
    compactLeft: true,
    fullName: (i) => {
      const m = (months ?? [])[i];
      return m ? monthFullLabel(m.month) : "";
    },
  });

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

  /**
   * The tag on a panel that reads the live fleet.
   *
   * It always said "live", meaning the date range does not reach it.
   * With a scope on the page it has a second thing to admit: these
   * panels are still FLEET-WIDE. The owner chose to keep them showing
   * rather than hide or replace them (2026-09-10), which is fine as long
   * as nobody reads "3 moving" as three of one driver's trucks — so when
   * a scope is set the tag says so out loud instead of relying on the
   * reader to remember.
   *
   * Achromatic on purpose: every hue in this app names a vehicle state,
   * and "this panel ignores your filter" is a fact about the panel.
   */
  const LiveTag = () => (
    <span
      className="vehicle-tag"
      style={{ marginLeft: 8, verticalAlign: "middle" }}
      title={
        isFleet(scope)
          ? t("Reads the live fleet — the date range does not apply")
          : t("Reads the live fleet — neither the date range nor the current selection applies")
      }
    >
      {isFleet(scope) ? t("live") : t("live · whole fleet")}
    </span>
  );

  const statusColour = (status: string) =>
    status === "moving" ? "var(--green)" : status === "idle" ? "var(--amber)" : "var(--text-faint)";

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
    <>
    <div className="dash" style={{ overflowY: "auto", height: "100%" }}>
      {/* Wraps, so the picker drops to its own line rather than squeezing
          the heading off screen on a phone. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600 }}>{t("dashboard.title")}</h2>
          <p className="t-dim" style={{ fontSize: ".78rem", marginTop: "3px" }}>
            {t("Every figure below covers {range}", { range: describeRange(loadedRange ?? range, t) })}
            {periodLabel ? t(", first to last fill {period}", { period: periodLabel }) : ""}.
          </p>
          {/* The control has moved and the figures have not caught up —
              either still loading, or the last load failed. Saying which
              period is on screen is the whole point; without it the page
              silently attributes one window's numbers to another. */}
          {loadedRange && !sameRange(loadedRange, range) && (
            <p className="t-faint" style={{ fontSize: ".74rem", marginTop: "3px" }}>
              {dataError
                ? t("Still showing {range} — the newer figures could not be loaded.", { range: describeRange(loadedRange, t) })
                : t("Updating to {range}…", { range: describeRange(range, t) })}
            </p>
          )}
          {/* Stated once, plainly, under the heading. The picker shows the
              same name, but the picker is a control — someone reading a
              screenshot of this page needs the page itself to say who it
              is about. The live-panel caveat is named here rather than
              only in each tag, because it is the one thing that makes a
              scoped dashboard easy to misread. */}
          {!isFleet(scope) && (
            <p className="t-dim" style={{ fontSize: ".78rem", marginTop: "4px" }}>
              {scope.kind === "driver"
                ? t("Showing driver {name}.", { name: scopeLabel(scope) ?? "" })
                : t("Showing truck {name}.", { name: scopeLabel(scope) ?? "" })}{" "}
              <span className="t-faint">
                {t("The live panels on the right still show the whole fleet.")}
              </span>
            </p>
          )}
        </div>

        {/* ── Who or what the page is about ──
            Beside the heading rather than in the range bar: the range
            says WHEN and this says WHO, and putting them in one strip
            made it read as a second date control. */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0, flex: "1 1 auto" }}>
          <Combobox
            options={comboOptions}
            value={comboValue}
            onChange={(id) => {
              const opt = scopeOptions.find((o) => `${o.kind}:${o.id}` === id);
              setScope(opt ? optionToScope(opt) : FLEET);
            }}
            placeholder={t("Search a driver or truck…")}
            listLabel={t("Drivers and trucks")}
            loadingText={t("Loading drivers and trucks…")}
            noMatchText={(q) => t("Nobody and no truck matches “{q}”", { q })}
            style={{ width: "260px", maxWidth: "100%" }}
          />
          {!isFleet(scope) && (
            <button
              type="button"
              className="btn-sm"
              onClick={() => setScope(FLEET)}
              title={t("Show the whole fleet again")}
            >
              {t("Clear")}
            </button>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <RangeBar value={range} onChange={setRange} daysWithData={series?.daysAvailable ?? null} />
      </div>

      {/* The charts cover a shorter window than the tiles above them.
          Only reachable on a range longer than 730 days, which today's
          record cannot produce — it exists so that when it does, around
          August 2028, the page says so rather than quietly drawing less
          than it was asked for. That silence is the exact fault this
          replaces: "All time" used to give genuinely all-time scorecards
          over charts that covered thirty days, with nothing on screen
          admitting the difference.

          The tiles are unaffected — fuel_period_stats sums in Postgres
          and returns one row whatever the span. */}
      {series?.daysClamped && (
        <div className="mt-3 text-xs t-dim">
          {t("The scorecards cover the whole range. The charts below show the most recent {days} days of it.", { days: String(series.km.length) })}
        </div>
      )}

      {/* Shown verbatim rather than as "something went wrong". This is an
          operations tool read by the person who can act on it, and the
          message PostgREST returns for a stale schema cache names the
          function it could not find — which is the whole diagnosis. */}
      {dataError && (
        <div className="mt-3 rounded-md p-3 text-sm tint-red c-red" role="alert">
          {t("The figures below could not be loaded: {reason}", { reason: dataError })}
        </div>
      )}

      {/* ── The sheet, summed ─────────────────────────────────
          One surface with hairline dividers rather than five bordered
          cards in a gapped grid. Same five figures, but five borders and
          four gutters were most of what made this strip look heavy — the
          numbers were never the problem. */}
      <div className="kpi-strip">
        <Kpi label={t("Kilometres driven")} value={fuel ? nf(fuel.km) : null} unit="km"
          delta={periodDelta(fuel?.km, prevFuel?.km, "km", nf, t)} deltaLabel={comparisonLabel} failed={dataError != null} />
        <Kpi label={t("Litres consumed")} value={fuel ? nf(fuel.litres) : null} unit="L"
          delta={periodDelta(fuel?.litres, prevFuel?.litres, "L", nf, t)} deltaLabel={comparisonLabel} failed={dataError != null} />
        <Kpi label={t("Amount filled")} value={fuel ? nf(fuel.amountDa) : null} unit="DA"
          delta={periodDelta(fuel?.amountDa, prevFuel?.amountDa, "DA", nf, t)} deltaLabel={comparisonLabel} failed={dataError != null} />
        <Kpi
          label={t("Average consumption")}
          value={fuel?.litresPer100Km != null ? fuel.litresPer100Km.toFixed(2) : null}
          unit="L/100km"
          // Two decimals, not nf's thousands separator: this figure is
          // 45.81, and rounding the CHANGE in it to a whole number would
          // report every real movement as zero.
          //
          // HIGHER IS WORSE. More litres per 100km is the fleet burning
          // more to cover the same ground, so a rise goes red.
          delta={periodDelta(fuel?.litresPer100Km, prevFuel?.litresPer100Km, "L/100km", (n) => n.toFixed(2), t, true)}
          deltaLabel={comparisonLabel}
          failed={dataError != null}
        />
        <Kpi
          label={t("Total variance")}
          value={fuel ? nf(fuel.varianceDa) : null}
          unit="DA"
          // HIGHER IS WORSE, and this is the card the rule came from:
          // the écart is what was paid less what the assumed rate says
          // the distance should have cost, so positive is money lost and
          // negative is money saved.
          delta={periodDelta(fuel?.varianceDa, prevFuel?.varianceDa, "DA", nf, t, true)}
          deltaLabel={comparisonLabel}
          failed={dataError != null}
        />
        {/* The sixth tile, and the only one whose money is in none of the
            five above it: every other aggregate on this page reads the
            cargo fleet. The staff cars, workshop, generator and pool
            vehicles are logged in the sheet under "VH SERVICE" rather
            than by plate (zero fills name a staff plate, checked
            2026-09-24), so this pot is the fleet's non-cargo fuel bill —
            ~1% of the total. No delta: the comparison half would double
            a query to draw a number off a pot of ~1,000 DA a month, and
            the third line says what the figure IS rather than pretending
            to be a trend. */}
        <Kpi
          label={t("Staff & service")}
          value={vhService ? nf(vhService.amountDa) : null}
          unit="DA"
          footNote={t("Pool, workshop and generator — not in the figures above")}
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
          {/* ── The fleet's arc ───────────────────────────────────
              The top of the main column, and the only fuel panel that
              ignores the range selector: it answers "how have we been
              doing", which is a question about the whole record. Placed
              here so the column reads as a funnel — what it has cost us
              across the year, then the distance chart for the selected
              window, then PRISM INTELLIGENCE's per-truck table as the
              drill-down. Selecting September does not collapse it to one
              bar, because a one-bar version of this panel is a number
              the scorecard strip already shows.

              Bars are the money; the line is WHY. Variance tracks
              consumption almost mechanically — litres over the assumed
              45 is the écart by definition — so a bars-only panel makes
              a manager ask why August is tall, and a line beside the
              bars answers it in the same glance. Both are the dual-axis
              shape the cost panel already uses, so nothing new was
              invented to draw it. */}
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div style={{ minWidth: 0 }}>
                <div className="dash-panel__title">{t("Variance by month")}</div>
                <div className="dash-panel__sub">
                  {t("Dinars lost to variance per calendar month, against the 45 L/100km the sheet assumes. Every month in the sheet — not the selected range.")}
                  {/* The current month is a partial month and always
                      will be, so saying so is the difference between
                      "September recovered 600,000 DA" and a number that
                      will keep moving. Same convention as the distance
                      panel below. */}
                  {lastMonthIsCurrent ? " " + t("This month is still counting.") : ""}
                </div>
              </div>
              {months && months.length > 0 && (
                <div style={{ textAlign: "right" }}>
                  <div className="t-faint" style={{ fontSize: ".66rem", textTransform: "uppercase", letterSpacing: ".06em" }}>
                    {t("Total over {n} months", { n: String(months.length) })}
                  </div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
                    {nf(monthTotal)} DA
                  </div>
                </div>
              )}
            </header>
            <div className="dash-panel__body">
              {!months ? (
                <div className="dash-chart dash-chart--tall">
                  <ChartWaiting />
                </div>
              ) : months.length === 0 ? (
                <p className="dash-empty">
                  <span>
                    <Fuel size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                    {t("No fills logged yet.")}
                  </span>
                </p>
              ) : (
                <>
                  <div className="dash-chart dash-chart--tall">
                    <Chart<"bar" | "line", (number | null)[], string>
                      type="bar"
                      data={monthVarianceChart}
                      options={monthChartOptions}
                      plugins={[crosshairPlugin]}
                    />
                  </div>
                  <p className="t-faint" style={{ fontSize: ".68rem", margin: "6px 0 0" }}>
                    {t("Bars are the écart the sheet booked; the line is what the fleet actually burned that month. Variance is the area between them.")}
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div style={{ minWidth: 0 }}>
                {/* ONE MEANING IN EVERY SCOPE now, so one name. The km
                    column used to switch source with the scope —
                    telemetry fleet-wide, the sheet scoped — and the
                    owner met the seam on 2026-09-17: a day where the
                    chart said 23,419 km and the scorecard said 12,899.
                    The scorecard won (migration 067): km is the sheet's
                    distance between fills everywhere, so the columns
                    always sum to "Kilometres driven" over the range. */}
                <div className="dash-panel__title">{t("Distance between fills")}</div>
                <div className="dash-panel__sub">
                  {/* Today is always partial — fills can still arrive
                      for it (now within seconds of the sheet changing),
                      and a fill logged today carries the whole distance
                      since that truck's previous fill. Said plainly
                      rather than hidden by dropping the point: the
                      current day is the one people look for. Only worth
                      saying when the range actually reaches today. */}
                  {t("Kilometres covered between two fills, plotted on the day of the later fill — not distance driven that day.")}
                  {range.to == null || range.to >= opsToday() ? " " + t("Today is still counting.") : ""}
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
          {/* Directly under the distance chart: the truck table breaks
              down the same fills the chart plots — chart first, worst
              offenders second. Column width, not full width: five
              columns never needed the whole band (see the grid note). */}
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                {/* The panel is the feature's front door: the same brand
                    the floating window carries, so a reader who opens one
                    and then the other sees one product. The sub-line
                    promises what the INTELLIGENCE column actually
                    delivers — the change, its size, and the refusal to
                    name a culprit, which is the rule the whole feature
                    is built on (see intelligence.ts). */}
                <div className="dash-panel__title">{t("PRISM INTELLIGENCE")}</div>
                <div className="dash-panel__sub">
                  {t("PRISM INTELLIGENCE leverages an algorithmic deep dive to uncover the truth behind variance.")}
                </div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {scopedTruckVariance === null ? (
                <VarianceWaiting />
              ) : scopedTruckVariance.length === 0 ? (
                <p className="dash-empty">{t("No fill carries a variance yet.")}</p>
              ) : (
                <SortableTable
                  rows={scopedTruckVariance}
                  rowKey={(t) => t.truckId}
                  initialKey="varianceDa"
                  unit="trucks"
                  noteSuffix={(dir) => (dir === "desc" ? t(" — worst first") : t(" — best first"))}
                  columns={[
                    {
                      key: "truckId",
                      label: t("Truck"),
                      value: (t) => t.truckId,
                      render: (t) => t.truckId,
                      cellClass: () => "truck-id",
                    },
                    {
                      key: "drivers",
                      label: t("Drivers"),
                      value: (t) => t.drivers,
                      render: (t) => t.drivers,
                      // One driver means this row and that driver's row are
                      // the same evidence counted twice, which is worth
                      // seeing before either is treated as proof.
                      cellClass: (t) => (t.drivers > 1 ? "t-primary" : "t-dim"),
                    },
                    { key: "km", label: t("Distance"), value: (tr) => tr.km, render: (tr) => `${nf(tr.km)} km` },
                    {
                      key: "litresPer100Km",
                      label: t("L/100km"),
                      value: (t) => t.litresPer100Km,
                      render: (t) => (t.litresPer100Km != null ? t.litresPer100Km.toFixed(2) : "—"),
                      cellClass: (t) => consumptionClass(t.litresPer100Km),
                    },
                    {
                      key: "varianceDa",
                      label: t("Variance"),
                      value: (t) => t.varianceDa,
                      render: (t) => signed(t.varianceDa, "DA"),
                      cellClass: (t) => signedClass(t.varianceDa),
                    },
                    {
                      // Prism Intelligence: the behavioral signal. Sorts
                      // on the percentage change; rows with no signal
                      // sink to the bottom either way, like every other
                      // nullable column on this page.
                      key: "intel",
                      label: t("Intelligence"),
                      value: (r) => truckIntel.get(r.truckId)?.pct ?? null,
                      render: (r) => {
                        const intel = truckIntel.get(r.truckId) ?? { state: "no_baseline", pct: null };
                        const open = intelTruck === r.truckId;
                        return (
                          // The status-pill anatomy, not bare text: this
                          // is the only clickable cell in the table and it
                          // has to LOOK like one. .intel-signal carries
                          // the hover and open states — see the block in
                          // globals.css, which spends no new hue.
                          //
                          // The level is passed HERE and not in the window:
                          // this column is a scanning surface, and a steady
                          // truck over the 45 limit is the row most worth
                          // spotting. The window's own behaviour figure
                          // stays direction-only (see intelClass).
                          <button
                            type="button"
                            onClick={() => {
                              setIntelTruck(open ? null : r.truckId);
                            }}
                            aria-expanded={open}
                            title={open ? t("Close intelligence") : t("Open intelligence")}
                            className={`status-pill intel-signal ${intelClass(intel.state, r.litresPer100Km)}`}
                          >
                            {intelLabel(intel, t)}
                          </button>
                        );
                      },
                      cellClass: (r) =>
                        intelClass(truckIntel.get(r.truckId)?.state ?? "no_baseline", r.litresPer100Km),
                    },
                  ]}
                />
              )}
            </div>
          </section>

          {/* Second, directly under the headline series — not at the
              bottom of the column. The KPI strip opens with what the
              month cost; this is the panel that answers it, with the
              per-truck table now reading just above, breaking the same
              money down first. It is full width because two series, two
              axes and a legend need the room the trio's thirds cannot
              give. Position does not change how the column ends: the
              same panels in any order still close the band the rail used
              to overhang by. */}
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">{t("What fuel cost per day")}</div>
                <div className="dash-panel__sub">
                  {t("Bars are what was paid at the pump, every fill. The line is the montant kilométrique — dinars per kilometre, on the fills that logged a distance.")}
                  {/* Today's column is empty until the first fill of the
                      day syncs: the bar is 0 and the rate has no priced
                      fill to divide, so the newest slot draws nothing at
                      all. Said here for the same reason the distance
                      panel says it — a blank column reads as a day that
                      cost nothing rather than a day still counting. */}
                  {" "}{t("Today fills in as the sheet syncs.")}
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

          {/* Third, straight after the money — because it is the other
              half of it. Every other panel on this page measures what the
              fleet SPENDS: kilometres, litres, dinars at the pump,
              variance by truck, variance by driver. None of them said
              what it delivered, which left every figure above a numerator
              with no denominator — 40,000 DA of variance reads one way
              over a 60-delivery week and another over a 200-delivery one.
              Reading the two panels adjacently is the whole point: a day
              that cost the same as yesterday for six fewer deliveries is
              the question this panel exists to raise.

              No new query. Migration 056 adds the count to
              dashboard_daily_series, which this page already fetches.

              THE PANEL THAT RAISED THAT QUESTION IS GONE. It stood here
              until the roster below needed the width, so the argument
              above now describes the whole fuel side of this dashboard
              rather than one panel of it: every remaining figure is a
              numerator with no denominator. That is worth knowing, and it
              is the first thing to fix if the roster ever moves again. */}
          {/* The full driver roster, in the slot "Deliveries per day"
              held, at the main column's full width.

              DELIVERIES WENT HERE ON PURPOSE, twice over. It is the only
              series on this page that cannot be recovered from anywhere
              else on the dashboard — every other panel is fuel or fleet
              state, and deliveries was the fleet's OUTPUT, the one
              measure on the page of what the trucks are FOR. Losing it
              is a real cost and it is written down here so nobody
              rediscovers it later as a mystery.

              What it bought: a 199-row, five-column, sortable table at
              900px instead of 350px. Both attempts to put this table in
              the rail failed the same way — five columns and a wrapping
              driver name do not fit 320px, and putting the leaderboard
              next to it does not make the table any narrower. At full
              width every column is legible, the name never wraps, and a
              row is a row.

              The consequence, accepted knowingly: the rail goes back to
              being roughly 700px short of this column. The alternative
              was a complete table nobody could read, and that is the
              worse instrument. The rail's dead space is the cheaper
              mistake, and it is a mistake rather than a plan. */}
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div style={{ minWidth: 0 }}>
                <div className="dash-panel__title">{t("Fuel variance by driver")}</div>
                <div className="dash-panel__sub">
                  {t("Against the sheet's assumed {rate} L/100km. Click a column to sort. A driver with one truck cannot be told apart from it.", { rate: ASSUMED_L_PER_100KM })}
                </div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {scopedDriverVariance === null ? (
                <VarianceWaiting />
              ) : scopedDriverVariance.length === 0 ? (
                <p className="dash-empty">{t("No fill carries a variance yet.")}</p>
              ) : (
                <SortableTable
                  rows={scopedDriverVariance}
                  rowKey={(d) => d.driverName}
                  initialKey="varianceDa"
                  unit="drivers"
                  noteSuffix={(dir) => (dir === "desc" ? t(" — worst first") : t(" — best first"))}
                  columns={[
                    {
                      key: "driverName",
                      label: t("Driver"),
                      value: (d) => d.driverName,
                      render: (d) => d.driverName,
                      cellClass: () => "t-primary",
                    },
                    {
                      key: "trucks",
                      label: t("Truck"),
                      value: (d) => d.trucks,
                      // One truck is named, because that is the row's
                      // confound and the reader should see which vehicle to
                      // check. More than one and the count is the point:
                      // the figure is no longer one truck's. This is also
                      // why the leaderboard's Trucks column is a count and
                      // not a plate — 121 of 199 drivers drove more than
                      // one over the record.
                      render: (d) =>
                        d.truckCount > 1 ? `${d.truckCount} trucks` : (d.trucks ?? "—"),
                      cellClass: (d) => (d.truckCount > 1 ? "t-dim" : "truck-id"),
                    },
                    { key: "km", label: t("Distance"), value: (d) => d.km, render: (d) => `${nf(d.km)} km` },
                    {
                      key: "litresPer100Km",
                      label: t("L/100km"),
                      value: (d) => d.litresPer100Km,
                      render: (d) => (d.litresPer100Km != null ? d.litresPer100Km.toFixed(2) : "—"),
                      cellClass: (d) => consumptionClass(d.litresPer100Km),
                    },
                    {
                      key: "varianceDa",
                      label: t("Variance"),
                      value: (d) => d.varianceDa,
                      render: (d) => signed(d.varianceDa, "DA"),
                      cellClass: (d) => signedClass(d.varianceDa),
                    },
                  ]}
                />
              )}
            </div>
          </section>

        <div className="dash-row dash-row--trio">
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">{t("Litres bought per day")}</div>
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
                      // Only the RIGHT axis, which carries the rate. The
                      // bars are counts and start at zero, so their own
                      // maximum is the right ceiling for them.
                      rightMin: consumptionBounds?.min,
                      rightMax: consumptionBounds?.max,
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
                <div className="dash-panel__title">{t("Consumption per day")}</div>
                <div className="dash-panel__sub">
                  {t("L/100km, on fills that logged a distance. The sheet assumes 45.")}
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
                      // The whole point of this panel. Unpinned it runs
                      // 0-800 and the 45 L/100km the sheet assumes — the
                      // one number the panel exists to compare against —
                      // sits four pixels off the floor.
                      min: consumptionBounds?.min,
                      max: consumptionBounds?.max,
                    })}
                    plugins={[crosshairPlugin]}
                  />
                ) : (
                  <ChartWaiting />
                )}
              </div>
            </div>
          </section>

          {/* Third, the model mix — a treemap because it is three things
              that are really one: how much of the fuel bill each model
              is. A bar chart would rank them; the treemap SIZES them,
              which is the question here (Shacman and MAN are close on
              share but Renault is a sliver, and that sliver is the
              point). Area is amount paid, the same habit every fuel
              panel on this page keeps. The models are wordmarks, and
              their categorical wash is the station donut's ramp turned
              down to a whisper — the owner asked for the colour up,
              then asked for it down again. See FuelModelTreemap. */}
          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">{t("Fuel by model")}</div>
                <div className="dash-panel__sub">
                  {t("Cell area is what each model cost at the pump. The model is read from the plate.")}
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              <div className="dash-chart">
                {!models ? (
                  <ChartWaiting />
                ) : models.length === 0 ? (
                  <p className="dash-empty">
                    <span>
                      <Fuel size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                      {t("No fills logged in this period.")}
                    </span>
                  </p>
                ) : (
                  <FuelModelTreemap models={models} />
                )}
              </div>
            </div>
          </section>
        </div>

          {/* The podium, last in the main column, directly under the
              complete roster above it. Podium then full list, in that
              order: the eight names are the answer, the 199 rows two
              inches above are the evidence, and a reader who disagrees
              with the ranking can check it without leaving the page.
              Eight rather than seven because that is what makes this
              column end level with the rail — see PODIUM_ROWS. */}
          <DriverLeaderboard board={leaderboard} ASSUMED={ASSUMED_L_PER_100KM} />

        </div>

        <aside className="dash-rail">
          <FuelBudgetGauge budget={budget} canEdit={canEditBudget} onBudgetChange={setBudget} />

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">
                  {t("What the fleet is doing")}
                  <LiveTag />
                </div>
                <div className="dash-panel__sub">
                  {/* Says which population it counts, like the distance
                      chart does. This one DOES include staff cars —
                      they are vehicles that report, and where the fleet
                      is right now is the one question they belong in —
                      but the alert panels beside it exclude them, and a
                      reader comparing the two should not have to guess
                      which is which. */}
                  {trucks.length > 0
                    ? t("{n} vehicles reporting, staff cars included.", { n: trucks.length })
                    : t("Waiting for the first fleet snapshot.")}
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              {trucks.length === 0 ? (
                <p className="dash-empty">
                  <span>
                    <MapPinOff size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                    {t("No fleet snapshot yet — the monitoring job may not be running.")}
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

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">{t("Where we fill up")}</div>
                <div className="dash-panel__sub">
                  {/* The remainder is most of the ring — the top six
                      are about a third of fills — so it is named here
                      rather than left for someone to infer from a grey
                      arc they cannot hover on a touchscreen. */}
                  {stationChart
                    ? t("Top {n} of {total} stations by fills.", {
                        n: stationChart.chart.labels.length - (stationChart.otherStations > 0 ? 1 : 0),
                        total: stations?.totalStations ?? 0,
                      })
                    : t("From the fuel sheet.")}
                </div>
              </div>
            </header>
            <div className="dash-panel__body">
              {!stationChart ? (
                <p className="dash-empty">
                  <span>
                    <Fuel size={15} style={{ display: "block", margin: "0 auto 7px" }} />
                    {t("No fills logged in this period.")}
                  </span>
                </p>
              ) : (
                <div className="dash-chart dash-chart--donut">
                  <Doughnut
                    data={stationChart.chart}
                    options={stationDoughnutOptions}
                    plugins={[doughnutCentrePlugin, doughnutSliceLabelPlugin]}
                  />
                </div>
              )}
            </div>
            {/* The busiest station spelled out under the ring. A legend
                cannot carry these names even at the rail's full width —
                "SARL S/S ARAMI FONTAINE DES GAZELLES EL OUTAYA" is 46
                characters, and seven of those stacked under a ring is a
                wall rather than a legend. The ring shows the shape, the
                tooltip carries the name, and this line answers the
                question that was actually asked. */}
            {stationChart?.top && (
              <div className="dash-panel__foot dash-station-top">
                <span className="dash-station-top__rank">1</span>
                <span className="dash-station-top__name" title={stationChart.top.station}>
                  {stationChart.top.station}
                </span>
                <span className="dash-station-top__n">{nf(stationChart.top.fills)}</span>
              </div>
            )}
          </section>

          <SpeedingPanel rows={speeding} />

          <section className="panel dash-panel">
            <header className="dash-panel__head">
              <div>
                <div className="dash-panel__title">{t("Drivers on duty")}<LiveTag /></div>
                <div className="dash-panel__sub">{t("Who is out right now.")}</div>
              </div>
            </header>
            <div className="dash-panel__body dash-panel__body--flush">
              {duty.length === 0 ? (
                <p className="dash-empty">{t("No driver is named on the current fleet feed.")}</p>
              ) : (
                duty.map((d) => (
                  <div key={d.truckId} className="duty-row">
                    <span className="duty-dot" style={{ background: statusColour(d.status) }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="duty-name">{d.name}</div>
                      <div className="duty-meta">
                        {d.status === "moving" ? `moving · ${Math.round(d.speed)} km/h` : d.status}
                        {d.onRun ? " · " + t("on a run") : ""}
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
          {/* The two rings, closing the rail. Sized to what was actually
              measured in the browser rather than to a guess: the main
              column stands 2396px and this one 1757px, so the gap is
              639px, and a ring panel on this column measures 264px
              (that is "What the fleet is doing" above, not a computed
              figure). Two panels plus their gaps is 556px, which leaves
              the columns within 83px of level - 3.5% of the page, which
              reads as even. A third would need 834px and does not fit,
              which is also why there are two here and not three.

              Neither ring costs a query: both aggregate rows the bundle
              has already fetched. Both follow the range selector and the
              scope picker, so neither can describe a different
              population than the panels above it. */}
          <RailRing
            title={t("Driver variance, in bands")}
            sub={t("Where each driver's money landed against the assumed rate. Every driver in this range.")}
            centre={t("drivers")}
            waiting={varianceRing === null}
            empty={t("No fill carries a variance yet.")}
            slices={[
              { label: t("Saving"), value: varianceRing?.counts.saving ?? 0, color: CHART_COLORS.green },
              { label: t("At the limit"), value: varianceRing?.counts.atLimit ?? 0, color: CHART_COLORS.dim },
              { label: t("Losing"), value: varianceRing?.counts.losing ?? 0, color: CHART_COLORS.red },
              { label: t("No rate"), value: varianceRing?.counts.unrated ?? 0, color: CHART_COLORS.empty },
            ]}
            foot={t("{saving} of {total} drivers are under the assumed {rate} L/100km.", {
              saving: nf(varianceRing?.counts.saving ?? 0),
              total: nf(varianceRing?.total ?? 0),
              rate: ASSUMED_L_PER_100KM,
            })}
          />

          <RailRing
            title={t("Fleet intelligence, in states")}
            sub={t("Every truck against its own previous window. The same words and colours as the table above.")}
            centre={t("trucks")}
            waiting={intelRing === null}
            empty={t("No fill carries a variance yet.")}
            slices={[
              { label: t("Improving"), value: intelRing?.counts.improving ?? 0, color: CHART_COLORS.green },
              { label: t("Steady"), value: intelRing?.counts.stable ?? 0, color: CHART_COLORS.dim },
              { label: t("Watch"), value: intelRing?.counts.watch ?? 0, color: CHART_COLORS.amber },
              { label: t("Worsening"), value: intelRing?.counts.up ?? 0, color: CHART_COLORS.red },
              { label: t("None"), value: intelRing?.counts.unclassified ?? 0, color: CHART_COLORS.empty },
            ]}
            foot={t("{steady} of {total} trucks are steady, {improving} improving.", {
              steady: nf(intelRing?.counts.stable ?? 0),
              total: nf(intelRing?.total ?? 0),
              improving: nf(intelRing?.counts.improving ?? 0),
            })}
          />
        </aside>
      </div>
    </div>

      {intelDetail && (
        <TruckIntelWindow
          truckId={intelDetail.truckId}
          current={intelDetail.current}
          previous={intelDetail.previous}
          previousLabel={
            comparisonRange?.from && comparisonRange?.to
              ? `${axisLabel(comparisonRange.from)} – ${axisLabel(comparisonRange.to)}`
              : null
          }
          intel={intelDetail.intel}
          from={comparisonRange?.from ?? range.from}
          to={range.to}
          onClose={() => setIntelTruck(null)}
        />
      )}
    </>
  );
}

function Kpi({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  footNote,
  failed,
}: {
  label: string;
  value: string | null;
  unit: string;
  /** Null when there is no comparable window — All time, or a load that
   *  failed. The line is then absent rather than showing a dash, which
   *  would read as "no change". */
  delta?: PeriodDelta | null;
  /** What the comparison is against, e.g. "vs the previous 7 days". */
  deltaLabel?: string;
  /** Shown on the third line when there is no delta — the one tile
   *  whose money is in none of the others says what it IS instead of
   *  drawing a comparison it cannot earn. */
  footNote?: string;
  /** True when the load finished and failed. A skeleton then is a lie:
   *  nothing is still coming. */
  failed?: boolean;
}) {
  const { t } = useTranslation();
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

      {/* The card's third line is the comparison, or — while there is no
          figure yet — what is happening instead. The fill counts that used
          to sit here were removed at the owner's request on 2026-09-07:
          five cards each carrying a count nobody was reading made the
          strip busier than the five numbers it exists for. */}
      {value === null ? (
        <div className="dash-kpi__delta" style={{ color: "var(--text-dim)" }}>
          {failed ? t("unavailable") : t("reading the sheet…")}
        </div>
      ) : delta ? (
        // GREEN GOOD, RED BAD — the owner's call on 2026-09-07, and note
        // it is TONE, not direction. Two of these five inverted: a rise
        // in variance is an overspend and a rise in litres-per-100km is
        // the fleet burning more to cover the same ground, so both go red
        // when they climb. Colouring by ▲/▼ instead would put the
        // friendliest colour on the two figures that cost the most money.
        <div className={`dash-kpi__delta${delta.tone ? ` is-${delta.tone}` : ""}`}>
          <span className="dash-kpi__delta-glyph">{delta.glyph}</span>
          <span>{delta.text}</span>
          {deltaLabel && <span className="dash-kpi__delta-vs">{deltaLabel}</span>}
        </div>
      ) : footNote ? (
        <div className="dash-kpi__delta t-dim">{footNote}</div>
      ) : null}
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
  const { t } = useTranslation();
  return (
    <div className="skeleton" style={{ position: "absolute", inset: 0, borderRadius: "var(--r-md)" }} role="status" aria-label={t("Loading chart")} />
  );
}

// ── The model mix treemap ────────────────────────────────────
//
// BRUSH-IMPLEMENTED ON PURPOSE. The codebase already draws its other
// charts with Chart.js, and Chart.js has no treemap — the plugin
// (chartjs-chart-treemap) is a third-party canvas renderer we would add
// for ONE panel of THREE rectangles. A 9-line chart does not justify a
// dependency. The tooltip is hand-built too, styled to the Chart.js
// tooltip so the panel's hover reading matches its neighbours', and it
// avoids Chart.js entirely.
//
// The categorical rule applies (owner, 2026-09-08), and then the owner
// walked it back a step (2026-09-15): the cells reuse the station donut's
// ramp — cyan, pink, amber — deliberately NO green and NO red, because
// those two are truck states and a model cell in either would read as
// one. But a WALL of full-saturation hue is the loudest thing on the
// dashboard, and that is not what taxonomy is for. The hue survives as
// a ~10% wash — an index, not a field — and the model's own name does
// the telling.

/** The ramp hues, as a thin film rather than a slab: three rectangles
 *  of full-saturation cyan read as stations, not as fuel. The model's
 *  name and the area carry the meaning; the tint merely indexes which
 *  is which, and the tooltip dots echo it. */
const tint = (hex: string, alpha = 0.1) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

interface TreemapCell {
  model: FuelModelStat;
  /** Fractions of the panel, so the layout holds at any render width. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bruls–Huizing–van Wijk squarification over the models, ranked by
 * amount as the RPC returns them.
 *
 * LAYOUT IS AREA-HONEST, and that is why this is worth the lines: the
 * whole point of a treemap is that a cell's area IS its share of the
 * total, and the simplest fill (sort + slice) quietly reads until a
 * small model — Renault is 1.2% of the fuel bill — becomes the corner
 * everyone asks about. Squarify keeps that sliver on its face: a thin
 * full-width strip is exactly how much fuel one model is.
 *
 * The layout decision reads the SHORTEST side of whatever rectangle is
 * left, so it depends on the box's aspect, not its size. This page's
 * box is always landscape (a trio panel is wider than its 150px chart),
 * so the layout is computed over a nominal box and returned as
 * fractions.
 *
 * For THIS data the ramp collapses each model into its own full-width
 * band: squarify refuses to stand two rectangles side by side when the
 * row would get squat in a landscape box. That is not the paper being
 * picky, it is the honest read — Shacman 58.3%, MAN 40.5%, and Renault
 * a 1.2% hairline across the floor that 22px of label cannot render,
 * which is exactly how much of the fuel bill one model is.
 */
function squarifyCells(models: FuelModelStat[], width: number, height: number): TreemapCell[] {
  const cells = models
    .map((model) => ({ model, value: Math.max(0, model.amountDa) }))
    .filter((c) => c.value > 0);
  const total = cells.reduce((a, c) => a + c.value, 0);
  if (total <= 0) return [];

  // SCALED TO THE BOX AT ONCE, because the layout treats a row's sum as
  // square pixels: laying rows out in raw dinars would size the first
  // row as if the fleet's whole budget were the panel.
  for (const c of cells) c.value = (c.value / total) * width * height;

  let row: typeof cells = [];
  let rowSum = 0;
  const worst = (r: typeof cells, s: number, side: number) => {
    const max = Math.max(...r.map((c) => c.value));
    const min = Math.min(...r.map((c) => c.value));
    // The paper's aspect figure: how far the row's fat and thin ends
    // drift from square once it is laid along a side of length `side`.
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const out: TreemapCell[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  const lay = () => {
    if (row.length === 0) return;
    if (w >= h) {
      // Landscape: the row spans the width and takes its share of the
      // height; each rectangle's width is its share of the row.
      const rh = (rowSum / (w * h)) * h;
      let xc = x;
      for (const c of row) {
        const rw = (c.value / rowSum) * w;
        out.push({ model: c.model, x: xc / width, y: y / height, w: rw / width, h: rh / height });
        xc += rw;
      }
      y += rh;
      h -= rh;
    } else {
      const rw = (rowSum / (w * h)) * w;
      let yc = y;
      for (const c of row) {
        const rhh = (c.value / rowSum) * h;
        out.push({ model: c.model, x: x / width, y: yc / height, w: rw / width, h: rhh / height });
        yc += rhh;
      }
      x += rw;
      w -= rw;
    }
    row = [];
    rowSum = 0;
  };

  let i = 0;
  while (i < cells.length) {
    const side = Math.min(w, h);
    const next = [...row, cells[i]];
    const nextSum = rowSum + cells[i].value;
    // A rectangle joins the row while doing so keeps its aspect reasonable;
    // once adding the next would ruin it, the row is complete and laid.
    if (row.length === 0 || worst(row, rowSum, side) >= worst(next, nextSum, side)) {
      row = next;
      rowSum = nextSum;
      i += 1;
    } else {
      lay();
    }
  }
  if (row.length > 0) lay();
  return out;
}

/** The hover card, positioned from the pointer by the component below. */
interface ModelTip {
  model: FuelModelStat;
  color: string;
  left: number;
  top: number;
}

function FuelModelTreemap({ models }: { models: FuelModelStat[] }) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ModelTip | null>(null);

  const cells = useMemo(() => squarifyCells(models, 300, 150), [models]);
  const total = models[0]?.totalAmount ?? 0;

  const placeTip = (cell: TreemapCell, color: string, cx: number, cy: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Clamped to the chart, like Chart.js keeps its tooltip on-canvas:
    // a card that escapes the panel reads as a stray element on the page.
    // The half-widths are estimates of the card's own size; the card is
    // small and the panel is wide enough that the clamp never visibly
    // misses.
    const W = 190;
    const H = 118;
    setTip({
      model: cell.model,
      color,
      left: Math.max(2, Math.min(cx + 14, rect.width - W - 2)),
      top: Math.max(2, Math.min(cy + 14, rect.height - H - 2)),
    });
  };

  // Cell coordinates relative to the box. Reading the rect once per
  // event rather than once per axis — it is the same call, and the
  // browser is free to double it if asked twice.
  const cellEvent = (cell: TreemapCell, color: string) => (e: { clientX: number; clientY: number }) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    placeTip(cell, color, e.clientX - rect.left, e.clientY - rect.top);
  };

  return (
    <div className="treemap" ref={boxRef} onMouseLeave={() => setTip(null)}>
      {cells.map((cell, i) => {
        const color = STATION_RAMP[i] ?? CHART_COLORS.dim;
        const share = total > 0 ? Math.round((cell.model.amountDa / total) * 100) : 0;
        return (
          <div
            key={cell.model.model}
            className="treemap__cell"
            style={{
              left: `${cell.x * 100}%`,
              top: `${cell.y * 100}%`,
              width: `${cell.w * 100}%`,
              height: `${cell.h * 100}%`,
              background: tint(color),
            }}
            onMouseEnter={cellEvent(cell, color)}
            onMouseMove={cellEvent(cell, color)}
            tabIndex={0}
            role="img"
            aria-label={`${cell.model.model}: ${nf(cell.model.amountDa)} DA, ${share}%`}
          >
            {/* A cell too thin for its label says nothing instead of
                mislabelling — the same skip the doughnut-slice plugin
                applies under ~4% of the ring. The tooltip still has the
                numbers. */}
            {cell.h * 150 >= 22 && (
              <span className="treemap__label">
                <span className="treemap__label-name">{cell.model.model}</span>
                <span className="treemap__label-meta">
                  {nf(cell.model.amountDa)} DA · {share}%
                </span>
              </span>
            )}
          </div>
        );
      })}

      {tip && (
        <div className="chart-tooltip" style={{ left: tip.left, top: tip.top }} role="status">
          <div className="chart-tooltip__title">{tip.model.model}</div>
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__dot" style={{ background: tip.color }} />
            <span>{t("Fills")}</span>
            <span className="chart-tooltip__v">{nf(tip.model.fills)}</span>
          </div>
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__dot" style={{ background: tip.color, opacity: 0.55 }} />
            <span>{t("Litres")}</span>
            <span className="chart-tooltip__v">{nf(tip.model.litres)} L</span>
          </div>
          <div className="chart-tooltip__row">
            <span className="chart-tooltip__dot" style={{ background: tip.color, opacity: 0.3 }} />
            <span>{t("Amount")}</span>
            <span className="chart-tooltip__v">{nf(tip.model.amountDa)} DA</span>
          </div>
          <div className="chart-tooltip__row">
            <span />
            <span>{t("L/100km")}</span>
            <span className="chart-tooltip__v">
              {tip.model.litresPer100Km == null ? "—" : `${tip.model.litresPer100Km.toFixed(1)}`}
            </span>
          </div>
          <div className="chart-tooltip__row">
            <span />
            <span>{t("Share")}</span>
            <span className="chart-tooltip__v">
              {total > 0 ? `${Math.round((tip.model.amountDa / total) * 100)}%` : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The fuel-budget gauge ─────────────────────────────────────
//
// The first panel of the right rail, and the one figure on the page
// that deliberately ignores the range selector: the budget answers
// "how is this MONTH going", and this month is the same whatever the
// charts describe. The gauge is an SVG arc of tick segments rather
// than a Chart.js doughnut because it is a progression, not a share —
// the arc FILLS as the month spends, and Chart.js cannot open a 90°
// gap at the bottom of a ring. It also sidesteps the canvas, which
// cannot style its pixels from the token palette.
//
// Colour: the money already spent is drawn in the visible cream the
// charts use for cream figures; the budget still hanging is the same
// cream turned down until it is almost not there, fading outward from
// the spend line — the same quiet the rest of the page keeps. Red is
// reserved for ONE situation, the overspend alarm. The centre shows
// the TARGET, never the spend: reading a gauge at a budget it is racing
// is the point of the panel.
//
// Only admins may edit. The edit control is a hairline pill in the
// panel head, exactly like the station blacklist and the driver
// directory; the form it opens is the dashboard's only inline input.

/** How many segments the 270° arc is built from. Forty reads as smooth
 *  at the rail's width and still lets a change of a few percent move
 *  whole ticks, which a two-hundred-piece arc would swallow. */
const BUDGET_TICKS = 40;
/** The arc leaves its bottom 90° open — the speedometer gap the centre
 *  content hangs into. Start 135° so the spend grows clockwise from
 *  the lower-left as the month burns through it. */
const BUDGET_ARC_START_DEG = 135;
const BUDGET_CX = 110;
const BUDGET_CY = 100;
const BUDGET_R_INNER = 62;
const BUDGET_R_OUTER = 84;

function FuelBudgetArc({ b }: { b: FuelBudget }) {
  const { t } = useTranslation();
  const hasBudget = b.budget != null && b.budget > 0;
  const share = hasBudget ? Math.min(b.filled / (b.budget ?? 0), 1) : 0;
  const over = hasBudget && b.filled > (b.budget ?? 0);
  const left = hasBudget ? (b.budget ?? 0) - b.filled : null;
  const overAmount = over ? (b.budget ?? 0) - b.filled : null;

  const ticks = useMemo(() => {
    const pt = (i: number, r: number) => {
      const a = ((BUDGET_ARC_START_DEG + (270 * i) / (BUDGET_TICKS - 1)) * Math.PI) / 180;
      return { x: BUDGET_CX + r * Math.cos(a), y: BUDGET_CY + r * Math.sin(a) };
    };
    return Array.from({ length: BUDGET_TICKS }, (_, i) => {
      const inner = pt(i, BUDGET_R_INNER);
      const outer = pt(i, BUDGET_R_OUTER);
      const at = i / (BUDGET_TICKS - 1);
      let tick: string;
      let style: { opacity?: number } | undefined;
      if (!hasBudget) tick = "budget__tick--muted";
      else if (over) tick = "budget__tick--over";
      else if (at < share) tick = "budget__tick--used";
      else {
        // The unspent arc fades away from the spend boundary: almost
        // visible just past it, nearly gone at the tail — the shared
        // "mostly future" look of a chart that is still young. A flat
        // faint would read as a second colour; a ramp reads as light.
        tick = "budget__tick--left";
        const t = Math.max(0, Math.min(1, (at - share) / Math.max(1e-9, 1 - share)));
        style = { opacity: 0.22 - 0.13 * t };
      }
      return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, tick, style };
    });
  }, [hasBudget, over, share]);

  // The dial itself is hoverable: which side of the arc the pointer is
  // over — the cream spent side or the faded remaining side — decides
  // which figure the small panel carries, and the open gap answers with
  // the budget. Mouse-driven only; a touchscreen has the legend's
  // hover panels and the always-visible legend figures, so nothing is
  // locked behind the pointer.
  const gaugeRef = useRef<HTMLDivElement>(null);
  const [gHover, setGHover] = useState<{
    channel: "spent" | "left" | "over" | "budget";
    left: number;
    top: number;
  } | null>(null);

  const onGaugeMove = (e: { clientX: number; clientY: number }) => {
    const el = gaugeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Pointer -> the same 220x210 viewBox space the ticks are built in.
    const nx = ((e.clientX - rect.left) / rect.width) * 220;
    const ny = ((e.clientY - rect.top) / rect.height) * 210;
    const dx = nx - BUDGET_CX;
    const dy = ny - BUDGET_CY;
    if (Math.hypot(dx, dy) > 96 || !hasBudget) {
      setGHover(null);
      return;
    }
    // The cursor's angle around the centre, folded into the arc's
    // own 135°→405° space so the same <share boundary the ticks use
    // decides spent-from-remaining, and anything past 270° of it is
    // the gap that was never part of the arc at all.
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const along = (deg - BUDGET_ARC_START_DEG + 360) % 360;
    const channel: "spent" | "left" | "over" | "budget" =
      along > 270 ? "budget" : over ? "over" : along / 270 < share ? "spent" : "left";
    setGHover({
      channel,
      left: Math.max(2, Math.min(e.clientX - rect.left + 14, rect.width - 192 - 2)),
      top: Math.max(2, Math.min(e.clientY - rect.top + 14, rect.height - 96 - 2)),
    });
  };

  const hoverContent = gHover
    ? gHover.channel === "budget"
      ? {
          title: t("Budget"),
          value: hasBudget ? `${money(b.budget!)} DA` : "—",
          soft: false,
          over: false,
          dotBg: "var(--text)",
          meta: null as string | null,
        }
      : gHover.channel === "spent"
        ? {
            title: t("Amount filled"),
            value: `${money(b.filled)} DA`,
            soft: false,
            over: false,
            dotBg: "var(--text)",
            meta: hasBudget ? `${Math.round(share * 100)}%` : null,
          }
        : gHover.channel === "left"
          ? {
              title: t("Budget left"),
              value: hasBudget ? `${money(left!)} DA` : "—",
              soft: true,
              over: false,
              dotBg: "var(--text)",
              meta: hasBudget && !over ? `${Math.round((1 - share) * 100)}%` : null,
            }
          : {
              title: t("Over budget"),
              value: hasBudget ? `${money(Math.abs(overAmount!))} DA` : "—",
              soft: false,
              over: true,
              dotBg: "var(--red)",
              meta: null,
            }
    : null;

  return (
    <div className="budget">
      <div
        className="budget__gauge"
        ref={gaugeRef}
        role="img"
        aria-label={
          hasBudget
            ? `${t("Amount filled")}: ${money(b.filled)} DA. ${t("Budget")}: ${money(b.budget!)} DA.`
            : t("No budget set for this month.")
        }
        onMouseMove={onGaugeMove}
        onMouseLeave={() => setGHover(null)}
      >
        <svg viewBox="0 0 220 210" className="budget__svg" aria-hidden="true">
          {ticks.map((tk, i) => (
            <line
              key={i}
              className={tk.tick}
              style={tk.style}
              x1={tk.x1}
              y1={tk.y1}
              x2={tk.x2}
              y2={tk.y2}
            />
          ))}
        </svg>
        <div className="budget__center">
          {/* The station, not the speedo: this dial tracks fuel money,
              and the pump says so before any figure is read. Decorative —
              the gauge's own aria-label already names both figures. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/illustrations/gas-station.svg" alt="" aria-hidden="true" className="budget__art" />
          <span className="budget__label">{t("Budget")}</span>
          <span className="budget__value">
            {hasBudget ? money(b.budget!) : "—"}
            {hasBudget && <span className="budget__unit"> DA</span>}
          </span>
        </div>
        {gHover && hoverContent && (
          <div className="budget__hover-tip" style={{ left: gHover.left, top: gHover.top }} role="status">
            <span className="budget__tip-title">{hoverContent.title}</span>
            <span className="budget__tip-row">
              <span
                className={hoverContent.soft ? "budget__tip-dot budget__dot--soft" : "budget__tip-dot"}
                style={{ background: hoverContent.dotBg }}
              />
              <span className={hoverContent.over ? "budget__tip-v budget__tip-v--red" : "budget__tip-v"}>
                {hoverContent.value}
              </span>
              {hoverContent.meta && <span className="budget__tip-meta">{hoverContent.meta}</span>}
            </span>
          </div>
        )}
      </div>
      <div className="budget__legend">
        <span>
          <span className="budget__dot" style={{ background: "var(--text)" }} />
          <span>{t("Amount filled")}</span>
          <span className="budget__legend-v">{`${money(b.filled)} DA`}</span>
          <span className="budget__tip">
            <span className="budget__tip-title">{t("Amount filled")}</span>
            <span className="budget__tip-row">
              <span className="budget__tip-dot" style={{ background: "var(--text)" }} />
              <span className="budget__tip-v">{`${money(b.filled)} DA`}</span>
              {hasBudget && <span className="budget__tip-meta">{Math.round(share * 100)}%</span>}
            </span>
          </span>
        </span>
        <span>
          <span
            className={left == null ? "budget__dot" : "budget__dot budget__dot--soft"}
            style={{ background: left == null ? "var(--line)" : left < 0 ? "var(--red)" : "var(--text)" }}
          />
          <span>{over ? t("Over budget") : t("Budget left")}</span>
          <span className={over ? "budget__legend-v budget__legend--over" : "budget__legend-v budget__legend-v--dim"}>
            {hasBudget ? `${money(Math.abs(overAmount ?? left!))} DA` : "—"}
          </span>
          <span className="budget__tip">
            <span className="budget__tip-title">{over ? t("Over budget") : t("Budget left")}</span>
            <span className="budget__tip-row">
              <span
                className={
                  left == null ? "budget__tip-dot" : "budget__tip-dot budget__dot--soft"
                }
                style={{ background: left == null ? "var(--line)" : left < 0 ? "var(--red)" : "var(--text)" }}
              />
              <span className={over ? "budget__tip-v budget__tip-v--red" : "budget__tip-v"}>
                {hasBudget ? `${money(Math.abs(overAmount ?? left!))} DA` : "—"}
              </span>
              {hasBudget && !over && <span className="budget__tip-meta">{Math.round((1 - share) * 100)}%</span>}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

function FuelBudgetGauge({
  budget,
  canEdit,
  onBudgetChange,
}: {
  budget: FuelBudget | null;
  canEdit: boolean;
  onBudgetChange: (b: FuelBudget | null) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(budget?.budget != null ? String(budget.budget) : "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const amount = Math.round(parseFloat(draft) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0) {
      setError(t("A budget must be a positive amount."));
      return;
    }
    setSaving(true);
    setError(null);
    const month = budget?.month ?? monthStart(opsToday());
    const res = await saveFuelBudget(month, amount);
    if (res.error) {
      setError(res.error);
    } else {
      onBudgetChange(await readFuelBudget());
      // A month's budget, changed once a month at most, is worth
      // dropping every cached bundle for: each cached entry in the
      // current view holds the OLD figure, and one of them would be
      // served back for up to FRESH_MS after the operator navigates
      // away and returns — the gauge visibly snapping back to a dead
      // number. Rare enough that the reset is the honest answer.
      bundles.clear();
      setEditing(false);
    }
    setSaving(false);
  };

  return (
    <section className="panel dash-panel">
      <header className="dash-panel__head">
        <div>
          <div className="dash-panel__title">{t("Fuel budget")}</div>
          <div className="dash-panel__sub">
            {t("The whole fleet's budget this month, against what the sheet has already paid.")}
          </div>
        </div>
        {canEdit && !editing && (
          <button className="btn-sm" onClick={startEdit}>
            <Pencil size={11} />
            {budget?.budget != null ? t("Edit") : t("Set budget")}
          </button>
        )}
      </header>
      <div className="dash-panel__body">
        {!budget ? (
          <div className="skeleton" style={{ height: 190, borderRadius: "var(--r-md)" }} />
        ) : editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              className="field"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("Budget for this month, DA")}
              aria-label={t("Budget for this month, DA")}
              autoFocus
            />
            <div className="budget-edit-row">
              <button className="btn-sm" type="submit" disabled={saving}>
                {t("Save")}
              </button>
              <button
                className="btn-sm"
                type="button"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                {t("Cancel")}
              </button>
            </div>
            {error && <p className="budget-edit-error">{error}</p>}
          </form>
        ) : (
          <FuelBudgetArc b={budget} />
        )}
      </div>
    </section>
  );
}
