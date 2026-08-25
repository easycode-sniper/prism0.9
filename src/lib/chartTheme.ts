import { Chart as ChartJS } from "chart.js";

/**
 * Chart.js paints to a canvas, so it cannot read the CSS custom properties
 * the rest of the app resolves through. This module is the single place the
 * taxonomy is repeated as literals for charts — when a token in globals.css
 * moves, this file moves with it, and nothing else has to.
 */
export const CHART_COLORS = {
  green: "#00ff7b",  // moving, on-route, healthy
  amber: "#ffb300",  // idle, stale, warning
  red: "#ff2d3f",    // off-route, speeding, alert
  cyan: "#00cfff",   // parking, geofence, informational
  pink: "#ff2fd0",   // spare category
  dim: "#95958a",    // --text-dim
  empty: "#42433d",  // --line, for the "no data" arc
} as const;

const SURFACE = "#191919";   // --panel, the ground a chart sits on
const CANVAS = "#0e100f";    // --bg
const TEXT = "#fffce1";      // --text
const LINE = "#42433d";      // --line

/** Applied once at module load, so every chart inherits the same type. */
export function installChartDefaults() {
  ChartJS.defaults.font.family =
    "'IBM Plex Sans', system-ui, sans-serif";
  ChartJS.defaults.font.size = 11;
  ChartJS.defaults.color = CHART_COLORS.dim;
  // Long chart animations are the kind of motion that reads as lag on a
  // dashboard someone keeps open all shift.
  ChartJS.defaults.animation = { duration: 220, easing: "easeOutQuart" };
}

/**
 * Shared doughnut options. The segment border is the panel colour rather
 * than transparent: a hairline in the surface colour separates adjacent
 * arcs without introducing a line of its own.
 */
export const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "62%",
  layout: { padding: 4 },
  elements: {
    arc: {
      borderColor: SURFACE,
      borderWidth: 2,
      hoverBorderColor: SURFACE,
      hoverOffset: 6,
    },
  },
  plugins: {
    legend: {
      position: "bottom" as const,
      labels: {
        color: TEXT,
        usePointStyle: true,
        pointStyle: "circle" as const,
        boxWidth: 7,
        boxHeight: 7,
        padding: 14,
        font: { size: 11 },
      },
    },
    tooltip: {
      backgroundColor: CANVAS,
      borderColor: LINE,
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      titleColor: TEXT,
      titleFont: { size: 11, weight: 600 as const },
      bodyColor: CHART_COLORS.dim,
      bodyFont: { family: "'IBM Plex Mono', ui-monospace, monospace", size: 11 },
      displayColors: true,
      usePointStyle: true,
      boxWidth: 7,
      boxHeight: 7,
      boxPadding: 5,
    },
  },
};

/**
 * Shared options for the two time-series shapes on the dashboard.
 *
 * Both are achromatic. Every hue in this app is owned by a vehicle state
 * — green is moving, red is off-route — so spending one on "distance" or
 * "alerts per day" would put a colour on screen that means nothing about
 * a truck while sitting beside colours that do. Series that are a
 * quantity rather than a state are drawn in cream; colour returns on the
 * charts that really are showing states, like the location split.
 */
const AXIS_GRID = "rgba(66, 67, 61, 0.55)";

export function timeSeriesOptions(opts?: {
  /** Suffix appended to the tooltip value, e.g. " km". */
  unit?: string;
  /** Y axis starts at zero unless a series never approaches it. */
  beginAtZero?: boolean;
}) {
  const unit = opts?.unit ?? "";
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    layout: { padding: { top: 6, right: 4, bottom: 0, left: 0 } },
    scales: {
      x: {
        grid: { display: false },
        border: { color: LINE },
        ticks: { color: CHART_COLORS.dim, maxRotation: 0, autoSkipPadding: 18, font: { size: 10 } },
      },
      y: {
        beginAtZero: opts?.beginAtZero ?? true,
        grid: { color: AXIS_GRID, drawTicks: false },
        border: { display: false },
        ticks: { color: CHART_COLORS.dim, maxTicksLimit: 5, padding: 8, font: { size: 10 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...doughnutOptions.plugins.tooltip,
        displayColors: false,
        callbacks: {
          label: (ctx: { parsed: { y: number | null } }) =>
            `${(ctx.parsed.y ?? 0).toLocaleString("en-GB")}${unit}`,
        },
      },
    },
  };
}

/** The filled area line — the dashboard's headline series. */
export const AREA_SERIES = {
  borderColor: TEXT,
  borderWidth: 1.5,
  pointRadius: 0,
  pointHoverRadius: 4,
  pointHoverBackgroundColor: TEXT,
  pointHoverBorderColor: CANVAS,
  pointHoverBorderWidth: 2,
  fill: true,
  tension: 0.35,
} as const;

/** Bars, for a count per day. Rounded on top only, like the reference. */
export const BAR_SERIES = {
  backgroundColor: "rgba(255, 252, 225, 0.22)",
  hoverBackgroundColor: "rgba(255, 252, 225, 0.42)",
  borderRadius: 3,
  borderSkipped: "bottom" as const,
  maxBarThickness: 22,
} as const;

/** A plain line with visible points, for a small count per day. */
export const LINE_SERIES = {
  borderColor: TEXT,
  borderWidth: 1.5,
  pointRadius: 3,
  pointBackgroundColor: CANVAS,
  pointBorderColor: TEXT,
  pointBorderWidth: 1.5,
  pointHoverRadius: 5,
  fill: false,
  tension: 0.3,
} as const;

/** The vertical wash under the headline series. Chart.js needs a canvas
 *  context to build a gradient, so this is a function rather than a
 *  constant, and it falls back to a flat tint when the chart has not been
 *  laid out yet (the first render, before an area exists to size to). */
export function areaFill(ctx: CanvasRenderingContext2D, top: number, bottom: number): CanvasGradient | string {
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) {
    return "rgba(255, 252, 225, 0.06)";
  }
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, "rgba(255, 252, 225, 0.16)");
  g.addColorStop(1, "rgba(255, 252, 225, 0)");
  return g;
}
