"use client";

// The dashboard's date range: presets over two explicit date inputs.
//
// It governs every HISTORICAL panel on the page — the fuel scorecards,
// the four daily charts, both variance tables and the speeding leaders.
// The genuinely live panels (fleet status, active runs) deliberately
// ignore it and say so on their own headers, because "trucks moving
// right now" has no meaning inside a window that ended in August.
//
// WHY THIS EXISTS AT PAGE LEVEL rather than per panel: before migration
// 047 the page showed FOUR different time windows at once and nothing
// said so — all-time scorecards, trailing-N-day charts, all-time
// variance tables, and a speeding table hardcoded to the current month.
// One control is the fix for that as much as it is a feature.
//
// Dates are OPERATIONS DAYS in Africa/Algiers, inclusive at both ends.
// from === to is one whole day, 00:00 to 23:59, which is exactly what
// the owner asked for and needs no timestamp arithmetic here.

import { useMemo } from "react";
import type { OpsRange } from "@/lib/dashboard/range";
import { monthStart, monthEnd, addMonths } from "@/lib/dashboard/range";
import { opsToday, opsNowLocalValue, OPS_TIMEZONE } from "@/lib/format";
import { useTranslation } from "@/lib/i18n/I18nProvider";

/** An ops day N days before today, as YYYY-MM-DD. opsNowLocalValue does
 *  the timezone work already; this only wants the date half. */
function opsDayOffset(days: number): string {
  return opsNowLocalValue(days).slice(0, 10);
}

// monthStart, monthEnd and addMonths come from lib/dashboard/range now.
// They were written here first and previousRange needed the same three;
// two copies of a month boundary is how the presets and the comparison
// under them come to disagree about when a month ends.

export interface Preset {
  key: string;
  label: string;
  range: OpsRange;
}

export function buildPresets(): Preset[] {
  const today = opsToday();
  const lastMonth = addMonths(monthStart(today), -1);
  return [
    { key: "today", label: "Today", range: { from: today, to: today } },
    { key: "yesterday", label: "Yesterday", range: { from: opsDayOffset(-1), to: opsDayOffset(-1) } },
    { key: "7d", label: "7 days", range: { from: opsDayOffset(-6), to: today } },
    { key: "30d", label: "30 days", range: { from: opsDayOffset(-29), to: today } },
    { key: "month", label: "This month", range: { from: monthStart(today), to: today } },
    { key: "lastMonth", label: "Last month", range: { from: lastMonth, to: monthEnd(lastMonth) } },
    // Kept, and kept last: it is what every one of these panels showed
    // before there was a control, so it is the way back to the numbers
    // someone may have written down.
    { key: "all", label: "All time", range: { from: null, to: null } },
  ];
}

/**
 * The chosen window as a phrase, for the dashboard heading.
 *
 * Takes t rather than returning English for the caller to translate: two
 * of the three branches are whole phrases and one is a date, so there is
 * no single key that covers it. The preset LABELS above are different —
 * each is a whole phrase on its own, so they are used as keys directly
 * and translated at the point they are rendered.
 */
export function describeRange(
  range: OpsRange,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!range.from && !range.to) return t("all time");
  if (range.from && range.to && range.from === range.to) return range.from;
  return t("{from} → {to}", { from: range.from ?? t("the start"), to: range.to ?? t("now") });
}

interface Props {
  value: OpsRange;
  onChange(range: OpsRange): void;
  /** Shown beside the control: how many days actually carry data in the
   *  chosen window, so the page never promises more than it has. */
  daysWithData?: number | null;
}

/**
 * Which preset a range IS, if any — the one drawn as pressed.
 *
 * Exported because the dashboard needs the same answer to pick a
 * comparison window: "This month" and "7 days" are the same range on the
 * 7th of a month, and the delta under the scorecards has to describe
 * whichever of the two the control is showing as active rather than
 * disagreeing with the button the reader can see.
 *
 * First match wins, which is why that is the answer: `buildPresets`
 * lists 7d before month, so on the 7th both this and the highlight say
 * "7 days".
 */
export function presetKeyFor(range: OpsRange): string | undefined {
  return buildPresets().find(
    (p) => p.range.from === range.from && p.range.to === range.to
  )?.key;
}

export default function RangeBar({ value, onChange, daysWithData }: Props) {
  const { t } = useTranslation();
  const presets = useMemo(buildPresets, []);
  const activeKey = presets.find(
    (p) => p.range.from === value.from && p.range.to === value.to
  )?.key;

  const dateInput: React.CSSProperties = {
    background: "var(--panel-2)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-sm)",
    padding: "4px 8px",
    color: "var(--text)",
    fontSize: ".76rem",
    fontFamily: "var(--font-mono)",
    // globals.css sets every input to width:100%, which is right for the
    // admin forms it was written for and wrong in a flex row — the
    // reports page paid for this once with a 21px horizontal overflow.
    width: "148px",
  };

  return (
    <div
      className="panel"
      style={{ padding: "10px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}
    >
      <div className="seg seg--sm" style={{ flex: "none" }}>
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(p.range)}
            aria-pressed={activeKey === p.key}
            className={`seg-item${activeKey === p.key ? " is-active" : ""}`}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label className="text-xs t-dim" htmlFor="dash-from">{t("From")}</label>
        <input
          id="dash-from"
          type="date"
          value={value.from ?? ""}
          max={value.to ?? undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value || null })}
          style={dateInput}
        />
        <label className="text-xs t-dim" htmlFor="dash-to">{t("To")}</label>
        <input
          id="dash-to"
          type="date"
          value={value.to ?? ""}
          min={value.from ?? undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value || null })}
          style={dateInput}
        />
      </div>

      <span className="text-xs t-faint" style={{ marginLeft: "auto" }}>
        {/* Named on screen because every figure on the page now depends
            on it, and a reader coming back to a screenshot needs to know
            which window they are looking at. */}
        {t("Operations days, {tz}", { tz: OPS_TIMEZONE })}
        {daysWithData != null ? t(" · {n} with data", { n: daysWithData }) : ""}
      </span>
    </div>
  );
}
