import { Chart as ChartJS, type Plugin } from "chart.js";

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
  //
  // Set KEY BY KEY, never `defaults.animation = {...}`. Chart.js resolves
  // every per-property animation through
  //
  //     const animationOptions = Object.keys(defaults.animation);
  //
  // and copies only those keys out of each entry in `defaults.animations`.
  // The stock object carries delay/duration/easing/fn/from/loop/to/TYPE;
  // replacing it with a two-key literal drops `type`, so the built-in
  // `colors` entry loses its `type: "color"` and Chart.js falls back to
  // `interpolators[typeof from]` — `interpolators["string"]`, which does
  // not exist. Every colour animation then throws "this._fn is not a
  // function" out of the shared rAF loop, and any chart that had not
  // finished its first frame is left blank on a black panel.
  // Typed `false | AnimationSpec`: a `false` here would mean animation had
  // been switched off outright, which is not ours to undo.
  const animation = ChartJS.defaults.animation;
  if (animation) {
    animation.duration = 220;
    animation.easing = "easeOutQuart";
  }
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
  /**
   * The ISO days behind the points, parallel to the labels. The axis is
   * abbreviated to fit ("26 Aug"); given these, the tooltip can name the
   * day in full instead of repeating that abbreviation back.
   */
  days?: string[];
}) {
  const unit = opts?.unit ?? "";
  const days = opts?.days;
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
          title: (items: { dataIndex: number; label: string }[]) => {
            const iso = days?.[items[0]?.dataIndex ?? -1];
            if (!iso) return items[0]?.label ?? "";
            // Noon UTC, and formatted in UTC, so the day cannot slip a
            // date either side of midnight — these are calendar days from
            // the RPC, already bucketed to the Algiers operations day.
            return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "long",
              timeZone: "UTC",
            });
          },
          // A null is a day the series has nothing for — no fill logged,
          // so no consumption. Saying so is the point of plotting it as a
          // break rather than a zero; the tooltip has to agree with the
          // line, or hovering quietly reinstates the zero.
          label: (ctx: { parsed: { y: number | null } }) =>
            ctx.parsed.y == null
              ? "no fill logged"
              : `${ctx.parsed.y.toLocaleString("en-GB")}${unit}`,
        },
      },
    },
  };
}

/**
 * Two series of different magnitudes on one time axis — what was paid
 * per day (hundreds of thousands of dinars) against what a kilometre
 * cost (about fifteen). On one axis the rate is a flat wire along the
 * floor, so it gets its own scale on the right.
 *
 * Still achromatic, and that is the harder half of this chart: two
 * series usually get told apart by hue, and every hue here is owned by a
 * vehicle state. They are told apart by SHAPE instead — a translucent
 * bar wash for the money, a solid stroke with points for the rate — plus
 * a legend, which the single-series charts do not need and this one
 * does.
 *
 * The right axis draws no grid. Two grids at different intervals
 * cross-hatch the panel, and the reader cannot tell which line belongs
 * to which scale anyway; the ticks and the legend say it instead.
 */
export function dualAxisTimeSeriesOptions(opts: {
  /** Tooltip suffix per dataset, in dataset order. */
  units: [string, string];
  /** ISO days behind the points, for the full-date tooltip title. */
  days?: string[];
  /** Compact the left axis ticks ("386k"). A six-digit dinar figure
   *  eats a third of a 954px panel in axis labels alone. */
  compactLeft?: boolean;
  /** The right axis carries a rate that lives in a narrow band well
   *  above zero, so it is not zero-based by default — anchoring it would
   *  flatten the only movement it has. */
  rightBeginAtZero?: boolean;
  /**
   * Legend on by default. Turn it OFF in a narrow panel and name the two
   * series in the panel's own sub-line instead: the legend band measures
   * 32px, which is a fifth of a 150px trio chart and comes straight out
   * of the plot. In the full-width cost panel it is affordable and the
   * chart is busy enough to need it; in a third-width one it is not.
   */
  legend?: boolean;
}) {
  const base = timeSeriesOptions({ days: opts.days });
  const compact = (v: number) =>
    Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

  return {
    ...base,
    scales: {
      x: base.scales.x,
      y: {
        ...base.scales.y,
        position: "left" as const,
        ticks: {
          ...base.scales.y.ticks,
          callback: (v: string | number) =>
            opts.compactLeft ? compact(Number(v)) : Number(v).toLocaleString("en-GB"),
        },
      },
      y1: {
        position: "right" as const,
        beginAtZero: opts.rightBeginAtZero ?? false,
        grid: { display: false },
        border: { display: false },
        ticks: { color: CHART_COLORS.dim, maxTicksLimit: 5, padding: 8, font: { size: 10 } },
      },
    },
    plugins: {
      ...base.plugins,
      legend: {
        display: opts.legend ?? true,
        position: "top" as const,
        align: "end" as const,
        labels: {
          color: CHART_COLORS.dim,
          usePointStyle: true,
          pointStyle: "circle" as const,
          boxWidth: 7,
          boxHeight: 7,
          padding: 12,
          font: { size: 10 },
          // Chart.js orders legend items by DRAW order, and the line has
          // to be drawn last to sit on top of the bars — which would
          // otherwise list the secondary series first. Sorted back to
          // authoring order so the legend reads in the order the panel
          // describes them.
          // datasetIndex is optional on a LegendItem — a legend entry
          // need not come from a dataset at all — so an absent one sorts
          // last rather than turning the comparison into NaN.
          sort: (a: { datasetIndex?: number }, b: { datasetIndex?: number }) =>
            (a.datasetIndex ?? Number.MAX_SAFE_INTEGER) - (b.datasetIndex ?? Number.MAX_SAFE_INTEGER),
        },
      },
      tooltip: {
        ...base.plugins.tooltip,
        // displayColors returns: with two series in the box, the reader
        // needs to know which row is which, and the label alone does not
        // carry it once the names are this close in meaning.
        displayColors: true,
        usePointStyle: true,
        boxWidth: 7,
        boxHeight: 7,
        boxPadding: 5,
        callbacks: {
          ...base.plugins.tooltip.callbacks,
          // The null branch below is a GUARD, not a message anyone sees.
          // Chart.js skips null points before the tooltip runs — the
          // index-mode collector tests `if (!element.skip)` — so on a day
          // with no value the row is omitted entirely rather than
          // labelled. Verified by hovering the real null days: the body
          // carries one line, the other series'. That is still correct
          // behaviour (nothing reinstates a zero, which is the failure
          // this exists to prevent), but do not read the string as
          // something the operator reads. It is also deliberately
          // generic: this helper serves both a money chart and a
          // consumption chart, and "no priced fill" would be wrong
          // vocabulary on the second.
          label: (ctx: { parsed: { y: number | null }; datasetIndex: number; dataset: { label?: string } }) => {
            const name = ctx.dataset.label ?? "";
            if (ctx.parsed.y == null) return `${name}: none logged`;
            return `${name}: ${ctx.parsed.y.toLocaleString("en-GB")}${opts.units[ctx.datasetIndex] ?? ""}`;
          },
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

/**
 * A vertical hairline through the hovered day, drawn on the time series.
 *
 * `interaction.mode` is "index", so hovering anywhere in a column already
 * reads that whole day — but with nothing drawn, there is no sign of
 * which column the tooltip is speaking for. The rule is the missing half
 * of that gesture.
 *
 * Achromatic cream, because a guide the cursor drags around is chrome,
 * not a vehicle state. It is drawn BEFORE the datasets so a bar sits on
 * top of it rather than being cut in two; under the area chart's wash
 * (0.16 alpha at its densest) it still reads through.
 *
 * Passed per chart via react-chartjs-2's `plugins` prop rather than
 * registered globally: the doughnut has active elements too, and would
 * otherwise get a vertical line ruled across it.
 */
export const crosshairPlugin: Plugin<"line" | "bar"> = {
  id: "prismCrosshair",
  beforeDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (active.length === 0) return;

    const { x } = active[0].element;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 252, 225, 0.18)";
    ctx.stroke();
    ctx.restore();
  },
};

/**
 * The count in the middle of the status doughnut: the fleet total at
 * rest, the hovered slice while the cursor is on one.
 *
 * The 62% cutout leaves a hole the size of a readout, and a doughnut
 * whose legend sits below is otherwise a shape you have to trace back to
 * a label to read. Hovering a slice puts that slice's own hue on the
 * number, which is the taxonomy doing its job — green really is the
 * count of moving trucks — and never spends a hue on anything else.
 */
export const doughnutCentrePlugin: Plugin<"doughnut"> = {
  id: "prismDoughnutCentre",
  afterDatasetsDraw(chart) {
    const dataset = chart.data.datasets[0];
    if (!dataset) return;

    const values = (dataset.data as (number | null)[]).map((n) => Number(n) || 0);
    const total = values.reduce((sum, n) => sum + n, 0);
    if (total === 0) return;

    // The arc's own centre, not the chart area's: the legend below is
    // laid out inside chartArea, so its midpoint sits low of the ring.
    const arc = chart.getDatasetMeta(0).data[0] as { x?: number; y?: number } | undefined;
    if (arc?.x == null || arc?.y == null) return;

    const active = chart.getActiveElements();
    const hovered = active.length > 0 ? active[0].index : -1;
    const value = hovered >= 0 ? values[hovered] : total;

    const palette = dataset.backgroundColor;
    const sliceColour =
      hovered >= 0 && Array.isArray(palette) ? String(palette[hovered] ?? TEXT) : TEXT;
    // The hovered slice lends the readout its hue — but "offline" is
    // painted in the no-data grey precisely because it is the absence of
    // a state, and a number in --line on --panel is barely legible. A
    // slice with no hue to lend gets the chrome cream instead.
    const colour = sliceColour === CHART_COLORS.empty ? TEXT : sliceColour;
    const caption =
      hovered >= 0
        ? `${String(chart.data.labels?.[hovered] ?? "")} · ${Math.round((value / total) * 100)}%`
        : "vehicles";

    const ctx = chart.ctx;
    ctx.save();
    ctx.textAlign = "center";

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = colour;
    ctx.font = "600 26px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillText(String(value), arc.x, arc.y + 4);

    ctx.textBaseline = "top";
    ctx.fillStyle = CHART_COLORS.dim;
    ctx.font = "11px 'IBM Plex Sans', system-ui, sans-serif";
    ctx.fillText(caption, arc.x, arc.y + 11);

    ctx.restore();
  },
};

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
