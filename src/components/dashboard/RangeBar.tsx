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
import { opsToday, opsNowLocalValue, OPS_TIMEZONE } from "@/lib/format";

/** An ops day N days before today, as YYYY-MM-DD. opsNowLocalValue does
 *  the timezone work already; this only wants the date half. */
function opsDayOffset(days: number): string {
  return opsNowLocalValue(days).slice(0, 10);
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The last day of the month `iso` falls in. Day 0 of the NEXT month is
 *  the last of this one, and Date does the roll-over, so December needs
 *  no special case. Built in UTC to keep it off the local calendar. */
function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

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

export function describeRange(range: OpsRange): string {
  if (!range.from && !range.to) return "all time";
  if (range.from && range.to && range.from === range.to) return range.from;
  return `${range.from ?? "the start"} → ${range.to ?? "now"}`;
}

interface Props {
  value: OpsRange;
  onChange(range: OpsRange): void;
  /** Shown beside the control: how many days actually carry data in the
   *  chosen window, so the page never promises more than it has. */
  daysWithData?: number | null;
}

export default function RangeBar({ value, onChange, daysWithData }: Props) {
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
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label className="text-xs t-dim" htmlFor="dash-from">From</label>
        <input
          id="dash-from"
          type="date"
          value={value.from ?? ""}
          max={value.to ?? undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value || null })}
          style={dateInput}
        />
        <label className="text-xs t-dim" htmlFor="dash-to">To</label>
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
        Operations days, {OPS_TIMEZONE}
        {daysWithData != null ? ` · ${daysWithData} with data` : ""}
      </span>
    </div>
  );
}
