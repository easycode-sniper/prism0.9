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
  pink: "#dc61b4",   // spare category
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
