"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { ArrowRight, MapPinOff, Route, ShieldAlert } from "lucide-react";
import { useFleet } from "@/components/providers/FleetProvider";
import {
  getFuelPeriodStats,
  getDashboardSeries,
  getDriverVariance,
  type FuelPeriodStats,
  type DashboardSeries,
  type DriverVariance,
} from "@/lib/supabase/dashboard";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import {
  CHART_COLORS,
  doughnutOptions,
  installChartDefaults,
  timeSeriesOptions,
  AREA_SERIES,
  BAR_SERIES,
  LINE_SERIES,
  areaFill,
} from "@/lib/chartTheme";
import { metaFor } from "@/lib/notifications/kinds";
import { formatDuration } from "@/lib/geometry";
import { ASSUMED_L_PER_100KM } from "@/lib/fuel/parse";

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);
installChartDefaults();

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

/** How many of the sorted drivers the panel shows. The rest are still
 *  loaded and still counted underneath — the sort decides which end of
 *  the roster this window lands on. */
const VARIANCE_ROWS = 8;

type VarianceKey = keyof Pick<
  DriverVariance,
  "driverName" | "fills" | "km" | "litresPer100Km" | "variancePer100Km" | "varianceDa"
>;

const VARIANCE_COLUMNS: { key: VarianceKey; label: string; numeric: boolean }[] = [
  { key: "driverName", label: "Driver", numeric: false },
  { key: "fills", label: "Fills", numeric: true },
  { key: "km", label: "Distance", numeric: true },
  { key: "litresPer100Km", label: "Consumption", numeric: true },
  { key: "variancePer100Km", label: "Per 100km", numeric: true },
  { key: "varianceDa", label: "Variance", numeric: true },
];

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

export default function DashboardPage() {
  const { t } = useTranslation();
  const { fleetData, notifications, dispatches } = useFleet();

  const [fuel, setFuel] = useState<FuelPeriodStats | null>(null);
  const [series, setSeries] = useState<DashboardSeries | null>(null);
  const [range, setRange] = useState<Range>(7);
  const [variance, setVariance] = useState<DriverVariance[] | null>(null);
  // Worst first, because that is the question the panel is opened with.
  const [sort, setSort] = useState<{ key: VarianceKey; dir: "asc" | "desc" }>({
    key: "varianceDa",
    dir: "desc",
  });

  useEffect(() => {
    let cancelled = false;
    getFuelPeriodStats().then(({ stats }) => {
      if (!cancelled && stats) setFuel(stats);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDriverVariance().then(({ drivers }) => {
      if (!cancelled && drivers) setVariance(drivers);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSeries = useCallback(async (days: Range) => {
    const { series: s } = await getDashboardSeries(days);
    return s ?? null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSeries(range).then((s) => {
      if (!cancelled) setSeries(s);
    });
    return () => {
      cancelled = true;
    };
  }, [range, loadSeries]);

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

  const litresChart = {
    labels: (series?.litres ?? []).map((p) => axisLabel(p.day)),
    datasets: [{ data: (series?.litres ?? []).map((p) => (p.value == null ? null : Math.round(p.value))), ...BAR_SERIES }],
  };

  const consumptionChart = {
    labels: (series?.consumption ?? []).map((p) => axisLabel(p.day)),
    datasets: [
      // A day with no fill yet has no consumption to plot. Passed through
      // as null so the line breaks there instead of diving to the origin.
      { data: (series?.consumption ?? []).map((p) => (p.value == null ? null : Number(p.value.toFixed(2)))), ...LINE_SERIES },
    ],
  };

  // ── Drivers on duty: anyone the fleet feed can name, moving first ──
  const duty = useMemo(() => {
    const rank = { moving: 0, idle: 1, offline: 2 } as const;
    const onRun = new Set(dispatches.map((d) => d.truck_id));
    return trucks
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

  const sortedVariance = useMemo(() => {
    if (!variance) return null;
    const { key, dir } = sort;
    const sign = dir === "asc" ? 1 : -1;

    return [...variance].sort((a, b) => {
      const x = a[key];
      const y = b[key];

      // A driver with no consumption figure has nothing to rank on, so
      // they sort to the bottom whichever way the column runs rather
      // than to the top of the ascending one, where a null would read as
      // the best score on the board.
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;

      if (typeof x === "string" && typeof y === "string") return sign * x.localeCompare(y);
      return sign * (Number(x) - Number(y));
    });
  }, [variance, sort]);

  const toggleSort = (key: VarianceKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : // A new column opens the way that column is usually read: names
          // from A, numbers from the largest.
          { key, dir: key === "driverName" ? "asc" : "desc" }
    );

  const statusColour = (status: string) =>
    status === "moving" ? "var(--green)" : status === "idle" ? "var(--amber)" : "var(--text-faint)";

  const signals = notifications.slice(0, 6);

  const periodLabel =
    fuel?.firstRaw && fuel?.lastRaw ? `${fuel.firstRaw.split(" ")[0]} → ${fuel.lastRaw.split(" ")[0]}` : "the fuel sheet";

  return (
    <div className="dash" style={{ overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600 }}>{t("dashboard.title")}</h2>
          <p className="t-dim" style={{ fontSize: ".78rem", marginTop: "3px" }}>
            Fuel figures cover {periodLabel}, as the sheet records them.
          </p>
        </div>
      </div>

      {/* ── Tier 1: the sheet, summed ── */}
      <div className="dash-row dash-row--kpi">
        <Kpi label="Kilometres driven" value={fuel ? nf(fuel.km) : null} unit="km" foot={fuel ? `${nf(fuel.fills)} fills` : ""} />
        <Kpi label="Litres consumed" value={fuel ? nf(fuel.litres) : null} unit="L" foot={fuel ? `incl. ${nf(fuel.unpairedLitres)} L with no km logged` : ""} />
        <Kpi label="Amount filled" value={fuel ? nf(fuel.amountDa) : null} unit="DA" foot={fuel ? `${nf(fuel.unpairedFills)} fills logged amount only` : "paid at the pump"} />
        <Kpi
          label="Average consumption"
          value={fuel?.litresPer100Km != null ? fuel.litresPer100Km.toFixed(2) : null}
          unit="L/100km"
          foot={fuel ? `${nf(fuel.fills - fuel.unpairedFills)} fills with km logged` : ""}
        />
        <Kpi
          label="Total variance"
          value={fuel ? nf(fuel.varianceDa) : null}
          unit="DA"
          foot={fuel ? (fuel.varianceDa > 0 ? "▲ over the assumed rate" : "▼ under the assumed rate") : ""}
        />
      </div>

      {/* ── Tier 2: the trend, and the split it explains ── */}
      <div className="dash-row dash-row--lead">
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
                Fleet kilometres, staff cars included. Today is still counting.
                {series && series.daysAvailable < range ? ` ${series.daysAvailable} days recorded so far.` : ""}
              </div>
            </div>
            <div className="seg seg--sm" style={{ flex: "none" }}>
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={`seg-item${range === r ? " is-active" : ""}`}
                >
                  {r}d
                </button>
              ))}
            </div>
          </header>
          <div className="dash-panel__body">
            <div className="dash-chart dash-chart--tall">
              {series ? <Line data={kmChart} options={timeSeriesOptions({ unit: " km" })} /> : <ChartWaiting />}
            </div>
          </div>
        </section>

        <section className="panel dash-panel">
          <header className="dash-panel__head">
            <div>
              <div className="dash-panel__title">What the fleet is doing</div>
              <div className="dash-panel__sub">
                {trucks.length > 0
                  ? `${trucks.length} vehicles reporting.`
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
                <Doughnut data={statusChart} options={doughnutOptions} />
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Tier 3: what the fuel sheet says, day by day ── */}
      <div className="dash-row dash-row--trio">
        <section className="panel dash-panel">
          <header className="dash-panel__head">
            <div>
              <div className="dash-panel__title">Litres bought per day</div>
              <div className="dash-panel__sub">Every fill, staff vehicles included.</div>
            </div>
          </header>
          <div className="dash-panel__body">
            <div className="dash-chart">
              {series ? <Bar data={litresChart} options={timeSeriesOptions({ unit: " L" })} /> : <ChartWaiting />}
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
                <Line data={consumptionChart} options={timeSeriesOptions({ unit: " L/100km", beginAtZero: false })} />
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
              {series ? <Bar data={alertsChart} options={timeSeriesOptions()} /> : <ChartWaiting />}
            </div>
          </div>
        </section>
      </div>

      {/* ── Tier 4: what you actually work from ── */}
      <div className="dash-row dash-row--panels">
        <section className="panel dash-panel">
          <header className="dash-panel__head">
            <div>
              <div className="dash-panel__title">Drivers on duty</div>
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
              <div className="dash-panel__title">Active runs</div>
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
              <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Truck</th>
                      <th>Destination</th>
                      <th>ETA</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatches.slice(0, 5).map((d) => (
                      <tr key={d.id}>
                        <td className="truck-id">{d.truck_id}</td>
                        <td className="t-primary">{d.site?.name ?? "—"}</td>
                        <td className="t-dim">{d.last_eta_seconds != null ? formatDuration(d.last_eta_seconds) : "—"}</td>
                        <td>
                          <span className={`status-pill ${d.last_on_route === false ? "off-route" : "dispatched"}`}>
                            {d.last_on_route === false ? "Off route" : "On route"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
      </div>

      {/* ── Tier 5: where the écart is coming from ── */}
      <div className="dash-row">
        <section className="panel dash-panel">
          <header className="dash-panel__head">
            <div>
              <div className="dash-panel__title">Fuel variance by driver</div>
              <div className="dash-panel__sub">
                Against the sheet&rsquo;s assumed {ASSUMED_L_PER_100KM} L/100km. Click a column to sort, click
                again to reverse — the rate and the total do not rank the same driver first.
              </div>
            </div>
          </header>
          <div className="dash-panel__body dash-panel__body--flush">
            {sortedVariance === null ? (
              <div style={{ padding: "0 15px 12px" }}>
                <div className="skeleton-stack">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="skeleton skeleton--row" />
                  ))}
                </div>
              </div>
            ) : sortedVariance.length === 0 ? (
              <p className="dash-empty">No fill carries a variance yet.</p>
            ) : (
              <>
                <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        {VARIANCE_COLUMNS.map((col) => {
                          const active = sort.key === col.key;
                          return (
                            <th
                              key={col.key}
                              className={`th-sort${active ? " is-sorted" : ""}`}
                              onClick={() => toggleSort(col.key)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleSort(col.key);
                                }
                              }}
                              tabIndex={0}
                              role="columnheader"
                              // Announced rather than left to the caret,
                              // which a screen reader cannot see.
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
                      {sortedVariance.slice(0, VARIANCE_ROWS).map((d) => (
                        <tr key={d.driverName}>
                          <td className="t-primary">{d.driverName}</td>
                          <td className="t-dim">{d.fills}</td>
                          <td className="t-dim">{nf(d.km)} km</td>
                          <td className={d.litresPer100Km != null && d.litresPer100Km > ASSUMED_L_PER_100KM ? "c-red" : "t-dim"}>
                            {d.litresPer100Km != null ? `${d.litresPer100Km.toFixed(2)} L` : "—"}
                          </td>
                          <td className="t-dim">{d.variancePer100Km != null ? `${nf(d.variancePer100Km)} DA` : "—"}</td>
                          {/* Over the assumed rate is a problem and reads
                              as one. Under it is simply fine, and stays
                              achromatic — green on this screen means a
                              truck is moving. */}
                          <td className={d.varianceDa > 0 ? "c-red" : "t-dim"}>{nf(d.varianceDa)} DA</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-foot-note">
                  Showing {Math.min(VARIANCE_ROWS, sortedVariance.length)} of {sortedVariance.length} drivers
                  {sort.key === "varianceDa"
                    ? sort.dir === "desc"
                      ? " — worst first"
                      : " — best first"
                    : ""}
                  .
                </div>
              </>
            )}
          </div>
          <div className="dash-panel__foot">
            <Link href="/carburant" className="dash-more">
              Every fill <ArrowRight size={12} />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  foot,
}: {
  label: string;
  value: string | null;
  unit: string;
  foot: string;
}) {
  return (
    <div className="panel dash-kpi">
      <div className="dash-kpi__label">{label}</div>
      {value === null ? (
        <div className="skeleton skeleton--line" style={{ width: "72%", height: "22px", marginTop: "8px" }} />
      ) : (
        <div className="dash-kpi__value">
          {value}
          <span className="dash-kpi__unit">{unit}</span>
        </div>
      )}
      <div className="dash-kpi__foot">
        <span className="dash-delta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value === null ? "reading the sheet…" : foot}
        </span>
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
