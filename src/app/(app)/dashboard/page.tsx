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
import { getFuelPeriodStats, getDashboardSeries, type FuelPeriodStats, type DashboardSeries } from "@/lib/supabase/dashboard";
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

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);
installChartDefaults();

const RANGES = [7, 14, 30] as const;
type Range = (typeof RANGES)[number];

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

  useEffect(() => {
    let cancelled = false;
    getFuelPeriodStats().then(({ stats }) => {
      if (!cancelled && stats) setFuel(stats);
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
    datasets: [{ data: (series?.litres ?? []).map((p) => Math.round(p.value)), ...BAR_SERIES }],
  };

  const consumptionChart = {
    labels: (series?.consumption ?? []).map((p) => axisLabel(p.day)),
    datasets: [
      { data: (series?.consumption ?? []).map((p) => Number(p.value.toFixed(2))), ...LINE_SERIES },
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
                Fleet kilometres, staff cars included.
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
