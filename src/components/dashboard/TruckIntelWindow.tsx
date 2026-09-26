"use client";

import { useEffect, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { Chart as ChartJS, type Plugin } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { CHART_COLORS, LINE_SERIES, crosshairPlugin, timeSeriesOptions } from "@/lib/chartTheme";
import { ASSUMED_L_PER_100KM } from "@/lib/fuel/parse";
import {
  buildConclusion,
  deriveDriverRuns,
  fillRate,
  intelClass,
  intelLabel,
  limitDelta,
  INTEL_CHART_CEILING,
  type IntelResult,
} from "@/lib/fuel/intelligence";
import { signedClass } from "@/lib/format";
import { getTruckFills, type TruckFill } from "@/lib/supabase/fuel";
import type { TruckVariance } from "@/lib/supabase/dashboard";

// Zoom/pan ride the same Chart.js the page already draws with — a plugin
// on the existing library, not a new one (spec §16). Registered here,
// so it loads with the dashboard and only activates on charts that set
// zoom options, which is just the trend below.
ChartJS.register(zoomPlugin);

/** "5 Sep" — the same day shape axisLabel draws on the page's charts. */
function fmtDay(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function fmtFull(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

const LIMIT_IDX = 1;
const MARKER_IDX = 2;

/**
 * PRISM INTELLIGENCE floating window (spec §2–5).
 *
 * A fixed overlay — the dashboard never reflows underneath — with a
 * draggable, resizable panel: header drag (buttons excluded), native
 * resize handle, min sizes, backdrop + Escape to close, toasts still
 * above it (overlay 3000 sits between the sticky topbar's 2500 and the
 * toaster's 4000).
 */
export function TruckIntelWindow({
  truckId,
  current,
  previous,
  previousLabel,
  intel,
  from,
  to,
  onClose,
}: {
  truckId: string;
  current: TruckVariance;
  previous: TruckVariance | null;
  /** "5 Aug – 29 Aug" when a comparison ran, else null. */
  previousLabel: string | null;
  intel: IntelResult;
  /** Fills window: comparison start (or range start) through range end. */
  from: string | null;
  to: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [fills, setFills] = useState<TruckFill[] | null>(null);
  const [fillsError, setFillsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const chartRef = useRef<ChartJS<"line", (number | null)[], string> | null>(null);

  // Explicit position once dragged; null means centred in the overlay.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ startX: number; startY: number; left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFills(null);
    setFillsError(null);
    void getTruckFills({ truck: truckId, from, to }).then((r) => {
      if (cancelled) return;
      setFills(r.fills);
      setFillsError(r.error ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [truckId, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startDrag = (e: React.PointerEvent) => {
    // Buttons (close) and text selection stay theirs — only the bare
    // header surface moves the window.
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    drag.current = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Keep a 120px grab strip on screen in every direction, so the
    // window can never be lost off-viewport.
    const left = Math.min(Math.max(d.left + e.clientX - d.startX, -window.innerWidth + 120), window.innerWidth - 120);
    const top = Math.min(Math.max(d.top + e.clientY - d.startY, 0), window.innerHeight - 60);
    setPos({ left, top });
  };
  const endDrag = () => {
    drag.current = null;
  };

  // ── Figures ──
  const delta = current.litresPer100Km != null ? limitDelta(current.litresPer100Km) : null;
  const conclusion = buildConclusion(
    current.litresPer100Km,
    previous?.litresPer100Km ?? null,
    intel.pct,
    intel.state
  );

  // ── Trend data ──
  const points = (fills ?? [])
    .map((f) => ({
      day: f.occurredAt.slice(0, 10),
      rate: fillRate(f.litresFilled, f.distanceKm),
    }))
    .filter((p): p is { day: string; rate: number } => p.rate != null);
  const realRates = points.map((p) => p.rate);
  const plotted = realRates.map((r) => Math.min(r, INTEL_CHART_CEILING));
  const extremes = points
    .map((p, i) => ({ i, rate: p.rate }))
    .filter((e) => e.rate > INTEL_CHART_CEILING);
  const runs = deriveDriverRuns((fills ?? []).map((f) => ({ occurredAt: f.occurredAt, driverName: f.driverName })));
  // First fill index of each run after the first — exact assignment
  // dates, since a run's `from` IS one of these fills' timestamps.
  const changeIdx = runs.slice(1).map((run) => (fills ?? []).findIndex((f) => f.occurredAt === run.from));
  const changeInfo = runs.slice(1).map((run, k) => ({
    idx: changeIdx[k],
    prev: runs[k].driver,
    next: run.driver,
    date: run.from.slice(0, 10),
  }));

  // Canvas overlays: spike badges with REAL values, driver-change
  // hairlines, and the two level captions. One plugin, drawn every
  // frame so resize and zoom can never desync it from the data.
  const overlayPlugin: Plugin<"line"> = {
    id: "intel-overlays",
    afterDatasetsDraw: (chart) => {
      const area = chart.chartArea;
      if (!area) return;
      const x = chart.scales.x;
      const y = chart.scales.y;
      const ctx = chart.ctx;
      ctx.save();
      // Spikes: real value above a point pinned to the ceiling.
      ctx.font = "700 11px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.textAlign = "center";
      for (const e of extremes) {
        const px = x.getPixelForValue(e.i);
        if (px < area.left || px > area.right) continue;
        ctx.fillStyle = CHART_COLORS.red;
        ctx.fillText(`⚡ ${e.rate.toLocaleString("en-GB")}`, px, area.top + 12);
      }
      // Driver changes: dim hairline, amber dot, caption.
      ctx.font = "600 9px 'IBM Plex Sans', system-ui, sans-serif";
      for (const c of changeInfo) {
        if (c.idx < 0) continue;
        const px = x.getPixelForValue(c.idx);
        if (px < area.left || px > area.right) continue;
        ctx.strokeStyle = "rgba(149,149,138,0.55)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, area.top);
        ctx.lineTo(px, area.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = CHART_COLORS.amber;
        ctx.beginPath();
        ctx.arc(px, area.top + 4, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CHART_COLORS.dim;
        ctx.fillText(t("DRIVER CHANGE"), px, area.bottom - 8);
      }
      // Level captions, right-aligned inside the plot.
      ctx.textAlign = "right";
      ctx.font = "600 10px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.fillStyle = CHART_COLORS.amber;
      ctx.fillText(`45 L/100km – ${t("Normal limit")}`, area.right - 6, y.getPixelForValue(45) - 6);
      ctx.fillStyle = CHART_COLORS.dim;
      ctx.fillText(`90 L/100km – ${t("Chart ceiling")}`, area.right - 6, y.getPixelForValue(90) + 14);
      ctx.restore();
    },
  };

  const base = timeSeriesOptions({
    unit: " L/100km",
    days: points.map((p) => p.day),
    beginAtZero: false,
  });
  const trendOptions = {
    ...base,
    layout: { padding: { top: 26, right: 4, bottom: 0, left: 0 } },
    scales: {
      ...base.scales,
      y: {
        ...base.scales.y,
        min: 0,
        max: INTEL_CHART_CEILING,
        ticks: { ...base.scales.y.ticks, stepSize: 22.5 },
      },
    },
    plugins: {
      ...base.plugins,
      tooltip: {
        ...base.plugins.tooltip,
        filter: (item: { datasetIndex: number }) => item.datasetIndex !== LIMIT_IDX,
        callbacks: {
          ...base.plugins.tooltip.callbacks,
          label: (ctx: { datasetIndex: number; dataIndex: number; parsed: { y: number | null } }) => {
            // Driver-change markers read as assignment facts.
            if (ctx.datasetIndex === MARKER_IDX) {
              const info = changeInfo.find((c) => c.idx === ctx.dataIndex);
              if (!info) return "";
              const who = (d: string | null) => d ?? t("Driver assignment unavailable");
              return [
                t("DRIVER CHANGE"),
                `${t("Previous driver:")} ${who(info.prev)}`,
                `${t("New driver:")} ${who(info.next)}`,
                `${t("Date:")} ${fmtFull(info.date)}`,
              ];
            }
            // Spike tooltips carry the REAL value — 90 is only where
            // the point is drawn, never what it measured.
            const real = realRates[ctx.dataIndex];
            if (real != null && real > INTEL_CHART_CEILING) {
              return [
                `⚡ ${t("EXTREME OBSERVATION")}`,
                `${real.toLocaleString("en-GB")} L/100km`,
                t("Chart scale capped at 90 L/100km"),
              ];
            }
            return ctx.parsed.y == null ? t("No fill carries a variance yet.") : `${ctx.parsed.y.toLocaleString("en-GB")} L/100km`;
          },
        },
      },
      zoom: {
        limits: { x: { min: "original" as const, max: "original" as const } },
        pan: { enabled: true, mode: "x" as const },
        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" as const },
      },
    },
  };

  const trendData = {
    labels: points.map((p) => fmtDay(p.day)),
    datasets: [
      {
        data: plotted,
        ...LINE_SERIES,
        pointRadius: 2,
        pointHoverRadius: 5,
      },
      {
        data: points.map(() => ASSUMED_L_PER_100KM),
        borderColor: CHART_COLORS.amber,
        borderWidth: 1,
        borderDash: [6, 5],
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
      },
      {
        // Hover targets for the change markers: drawn at the ceiling
        // with no stroke of their own — the plugin draws the visible
        // hairlines, these points only catch the cursor.
        data: points.map((_, i) => (changeIdx.includes(i) ? INTEL_CHART_CEILING : null)),
        borderWidth: 0,
        pointRadius: 0,
        pointHoverRadius: 8,
        pointHoverBackgroundColor: CHART_COLORS.amber,
        fill: false,
      },
    ],
  };

  const barMax = Math.max(60, current.litresPer100Km ?? 0, previous?.litresPer100Km ?? 0);
  const barPct = (v: number) => `${Math.min(100, (v / barMax) * 100)}%`;

  return (
    <div
      className="intel-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={`PRISM INTELLIGENCE ${truckId}`}
        className="intel-window"
        style={pos ? { position: "fixed", left: pos.left, top: pos.top, transform: "none", margin: 0 } : undefined}
      >
        <div
          className="intel-window__head"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span style={{ fontWeight: 800, letterSpacing: ".02em" }}>PRISM INTELLIGENCE</span>
          <span className="truck-id">{truckId}</span>
          <button type="button" onClick={onClose} className="btn-sm" aria-label={t("Close")} style={{ marginLeft: "auto" }}>
            ✕
          </button>
        </div>

        <div className="intel-window__body">
          <p className="t-faint" style={{ fontSize: ".74rem", margin: "0 0 12px" }}>
            {t("Understand how this vehicle's consumption behavior changes over time.")}
          </p>

          {/* Figures + conclusion */}
          <div className="intel-figures">
            <div className="intel-card">
              <div className="t-faint intel-card__label">{t("Current consumption")}</div>
              <div
                className="intel-card__value"
                style={{ color: current.litresPer100Km != null && current.litresPer100Km > ASSUMED_L_PER_100KM ? "var(--red)" : "var(--green)" }}
              >
                {current.litresPer100Km != null ? current.litresPer100Km.toFixed(2) : "—"}
                <span className="intel-card__unit"> L/100km</span>
              </div>
              <div className="t-faint intel-card__sub">
                {delta == null
                  ? "—"
                  : delta >= 0
                    ? t("{x} above limit (45 L/100km)", { x: `+${delta.toFixed(2)} L/100km` })
                    : t("{x} below limit (45 L/100km)", { x: `${Math.abs(delta).toFixed(2)} L/100km` })}
              </div>
            </div>
            <div className="intel-card">
              <div className="t-faint intel-card__label">{t("Previous period")}</div>
              <div className="intel-card__value">
                {previous?.litresPer100Km != null ? previous.litresPer100Km.toFixed(2) : "—"}
                <span className="intel-card__unit"> L/100km</span>
              </div>
              <div className="t-faint intel-card__sub">{previousLabel ?? t("No previous period")}</div>
            </div>
            <div className="intel-card">
              <div className="t-faint intel-card__label">{t("Behavior change")}</div>
              {/* No level argument, DELIBERATELY: the dashboard's table
                  column passes one (so a steady truck over the limit
                  reads red there) but this card must not. The current
                  consumption beside it already states the level in its
                  own colour and the conclusion below states both facts,
                  so colouring this by level too would say it twice — and
                  a figure labelled STABLE painted red is the one
                  misreading the whole feature is built to prevent. */}
              <div className={`intel-card__value ${intelClass(intel.state)}`}>{intelLabel(intel, t)}</div>
              <div className="t-faint intel-card__sub">{t("vs previous period")}</div>
            </div>
            <div className="intel-card">
              <div className="t-faint intel-card__label">{t("Variance")}</div>
              <div className={`intel-card__value ${signedClass(current.varianceDa)}`}>
                {/* Same rendering as the table cell — Math.round, not the
                    lib's decimals-keeping signedValue. */}
                {current.varianceDa == null
                  ? "—"
                  : `${current.varianceDa > 0 ? "+" : ""}${Math.round(current.varianceDa).toLocaleString("en-GB")} DA`}
              </div>
              <div className="t-faint intel-card__sub">{t("vs previous period")}</div>
            </div>
            <div className="intel-card intel-card--conclusion">
              <div className="t-faint intel-card__label">PRISM INTELLIGENCE</div>
              {conclusion.map((s, i) => (
                <p
                  key={`${s.key}-${i}`}
                  style={{
                    fontSize: ".78rem",
                    lineHeight: 1.5,
                    margin: i === 0 ? "0" : "6px 0 0",
                    color: s.key === "Conclusion current above limit." ? "var(--red)" : undefined,
                  }}
                >
                  {t(s.key, s.vars)}
                </p>
              ))}
            </div>
          </div>

          {/* Trend */}
          <div className="intel-panel">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <span style={{ fontSize: ".8rem", fontWeight: 700 }}>{t("Consumption trend (L/100km)")}</span>
              <button
                type="button"
                className="btn-sm"
                style={{ marginLeft: "auto", fontSize: ".68rem", padding: "2px 10px" }}
                onClick={() => chartRef.current?.resetZoom()}
                title={t("Reset view")}
              >
                {t("Reset view")}
              </button>
            </div>
            {loading ? (
              <p className="t-faint" style={{ fontSize: ".74rem" }}>{t("Loading fuel history…")}</p>
            ) : fillsError ? (
              <p style={{ fontSize: ".74rem", color: "var(--red)" }}>{t("Could not load fuel history.")}</p>
            ) : points.length === 0 ? (
              <p className="dash-empty" style={{ margin: 0 }}>{t("No fills in this window.")}</p>
            ) : (
              <>
                <div
                  className="dash-chart"
                  style={{ height: "300px", touchAction: "pan-y" }}
                  onDoubleClick={() => chartRef.current?.resetZoom()}
                >
                  <Line ref={chartRef} data={trendData} options={trendOptions} plugins={[crosshairPlugin, overlayPlugin]} />
                </div>
                <p className="t-faint" style={{ fontSize: ".68rem", margin: "6px 0 0" }}>
                  {t("Dots are fills that logged a distance; the dashed amber line is the 45 L/100km normal limit; red spikes exceed the 90 L/100km chart ceiling.")}
                </p>
              </>
            )}
          </div>

          {/* Summary + extremes + drivers */}
          {!loading && !fillsError && fills && fills.length > 0 && (
            <div className="intel-trio">
              <div className="intel-panel">
                <div style={{ fontSize: ".8rem", fontWeight: 700, marginBottom: "10px" }}>{t("Consumption summary")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: ".8rem", flexWrap: "wrap" }}>
                  <span>
                    <span className="t-faint" style={{ display: "block", fontSize: ".64rem" }}>{t("Previous average")}</span>
                    <strong>{previous?.litresPer100Km != null ? previous.litresPer100Km.toFixed(2) : "—"}</strong>
                  </span>
                  <span aria-hidden="true">→</span>
                  <span>
                    <span className="t-faint" style={{ display: "block", fontSize: ".64rem" }}>{t("Current average")}</span>
                    <strong>{current.litresPer100Km != null ? current.litresPer100Km.toFixed(2) : "—"}</strong>
                  </span>
                  {/* Direction only, for the same reason as the card above. */}
                  <span className={intelClass(intel.state)} style={{ fontWeight: 800 }}>{intelLabel(intel, t)}</span>
                </div>
                {current.litresPer100Km != null && (
                  <div style={{ marginTop: "12px" }}>
                    <div style={{ position: "relative", height: "8px", borderRadius: "99px", background: "var(--line)" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: barPct(ASSUMED_L_PER_100KM),
                          borderRight: "2px solid var(--amber)",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: barPct(current.litresPer100Km),
                          width: "12px",
                          height: "12px",
                          borderRadius: "50%",
                          background: "var(--bg)",
                          border: "2px solid var(--text)",
                          transform: "translate(-50%, -50%)",
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".64rem", marginTop: "4px" }}>
                      <span className="t-faint">0</span>
                      <span style={{ color: "var(--amber)", fontWeight: 700 }}>45 · {t("Normal limit")}</span>
                      <span className="t-faint">
                        {current.litresPer100Km.toFixed(2)} · {t("Current")}
                      </span>
                    </div>
                    <p style={{ fontSize: ".74rem", margin: "8px 0 0" }}>
                      {delta != null && delta >= 0
                        ? t("{x} above normal limit", { x: `+${delta.toFixed(2)} L/100km` })
                        : t("{x} below normal limit", { x: `${delta != null ? Math.abs(delta).toFixed(2) : "—"} L/100km` })}
                    </p>
                  </div>
                )}
              </div>

              <div className="intel-panel">
                <div style={{ fontSize: ".8rem", fontWeight: 700, marginBottom: "10px" }}>{t("Extreme observations")}</div>
                {extremes.length === 0 ? (
                  <p className="t-faint" style={{ fontSize: ".74rem", margin: 0 }}>{t("None in this window.")}</p>
                ) : (
                  <>
                    <p style={{ fontSize: ".74rem", margin: "0 0 8px", color: "var(--red)", fontWeight: 700 }}>
                      ⚡ {t("{n} above chart scale", { n: extremes.length })}
                    </p>
                    {extremes.map((e) => (
                      <div key={points[e.i].day + e.i} style={{ display: "flex", justifyContent: "space-between", fontSize: ".76rem", padding: "3px 0" }}>
                        <span className="t-faint">{fmtFull(points[e.i].day)}</span>
                        <strong style={{ color: "var(--red)", fontFamily: "var(--font-mono)" }}>
                          {e.rate.toLocaleString("en-GB")}
                        </strong>
                      </div>
                    ))}
                    <p className="t-faint" style={{ fontSize: ".68rem", margin: "8px 0 0" }}>
                      {t("Hover a spike for its real value.")}
                    </p>
                  </>
                )}
              </div>

              <div className="intel-panel">
                <div style={{ fontSize: ".8rem", fontWeight: 700, marginBottom: "10px" }}>{t("Driver assignment")}</div>
                {runs.map((run, i) => (
                  <div key={`${run.driver ?? "—"}-${run.from}`} style={{ marginBottom: i < runs.length - 1 ? "2px" : "0" }}>
                    {i > 0 && (
                      <div
                        style={{
                          display: "inline-block",
                          fontSize: ".62rem",
                          fontWeight: 700,
                          letterSpacing: ".06em",
                          border: "1px solid var(--line)",
                          borderRadius: "99px",
                          padding: "1px 9px",
                          margin: "6px 0",
                        }}
                      >
                        {t("DRIVER CHANGE")}
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: ".76rem" }}>
                      <strong style={{ fontWeight: 700 }}>
                        {run.driver ?? t("Driver assignment unavailable")}
                      </strong>
                      <span className="t-faint">
                        {runSpan(run.from, run.to)} · {t("{n} fills", { n: run.fills })}
                      </span>
                    </div>
                  </div>
                ))}
                <p className="t-faint" style={{ fontSize: ".68rem", margin: "8px 0 0" }}>
                  {t("As recorded on fills — assignment between fills is unknown.")}
                </p>
                {(intel.state === "up" || intel.state === "watch") && runs.length > 1 && (
                  <p style={{ fontSize: ".74rem", margin: "8px 0 0", color: "var(--amber)" }}>
                    {t("Consumption pattern changed following a driver assignment change. Review recommended.")}
                  </p>
                )}
                <p className="t-faint" style={{ fontSize: ".68rem", margin: "8px 0 0" }}>
                  {t("Possible explanations include driving behavior, operating conditions, load differences, mechanical condition, route differences, or data quality.")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  function runSpan(from: string, to: string): string {
    const a = fmtDay(from.slice(0, 10));
    const b = fmtDay(to.slice(0, 10));
    return a === b ? a : `${a} → ${b}`;
  }
}
