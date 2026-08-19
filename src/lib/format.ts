// Date and time formatting for the whole app.
//
// Every call site used to use the browser default, which renders 12-hour
// AM/PM on en-US machines and varies per operator — a dispatch log that
// reads differently depending on whose laptop it's on is a liability.
// These force 24-hour, day-first, Latin digits, everywhere.
//
// The locale is pinned rather than taken from the browser or the app's
// language switcher: the switcher covers UI chrome only, and a timestamp
// that silently reformats when someone flips to Arabic is worse than one
// that is consistently readable to everyone on the team.

const LOCALE = "en-GB";

// Operations happen in Algeria, which sits on UTC+1 year-round with no
// daylight saving. Report boundaries are pinned to it rather than to the
// viewer's machine: a shift that starts at 00:00 has to mean the same
// instant whoever runs the report, or a truck entering just after
// midnight lands on the wrong day.
export const OPS_TIMEZONE = "Africa/Algiers";
export const OPS_UTC_OFFSET = "+01:00";

const TIME: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

const TIME_SHORT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const DATE: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
};

function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 14:05:09 */
export function formatTime(value: Date | string | number): string {
  return asDate(value).toLocaleTimeString(LOCALE, TIME);
}

/** 14:05 */
export function formatTimeShort(value: Date | string | number): string {
  return asDate(value).toLocaleTimeString(LOCALE, TIME_SHORT);
}

/** 17/08/2026 */
export function formatDate(value: Date | string | number): string {
  return asDate(value).toLocaleDateString(LOCALE, DATE);
}

/** 17/08/2026 14:05 */
export function formatDateTime(value: Date | string | number): string {
  const d = asDate(value);
  return `${d.toLocaleDateString(LOCALE, DATE)} ${d.toLocaleTimeString(LOCALE, TIME_SHORT)}`;
}

/** Monday, 17 August 2026 — for the printed daily summary header. */
export function formatDateLong(value: Date | string | number): string {
  return asDate(value).toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Relative age of a GPS fix, in the largest unit that still reads
// naturally. The Monitoring table used to print raw minutes, which is
// fine at "3min ago" and unreadable at "100863min ago" — nobody converts
// that to ten weeks in their head. Offline units accumulate very large
// ages, so the top of the scale matters as much as the bottom.
function ago(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function formatAge(minutes: number | null | undefined): string {
  if (minutes == null) return "—";
  // Negative ages happen when the tracker's clock runs slightly ahead of
  // ours; a fix from "the future" is a fresh one.
  if (minutes < 1) return "just now";

  if (minutes < 60) return ago(Math.floor(minutes), "minute");

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");

  const days = Math.floor(minutes / 1440);
  if (days < 31) return ago(days, "day");

  // Months are rounded, not floored: a month is an approximation
  // already, and flooring reports 60 days as "1 month". Clamped to 11 so
  // the rounding can't produce "12 months ago" just below the year mark.
  if (days < 365) {
    return ago(Math.min(11, Math.max(1, Math.round(days / 30.44))), "month");
  }

  // Divided by 365 rather than 365.25: the leap-day correction makes two
  // full years 730.5 days, so 730 floors to "1 year ago". Being a day
  // out every fourth year matters far less on a staleness readout than
  // reporting three years as two.
  return ago(Math.floor(days / 365), "year");
}

/** 17/08/2026 14:05 — pinned to operations time, whatever the viewer's clock says. */
export function formatOpsDateTime(value: Date | string | number): string {
  const d = asDate(value);
  return d.toLocaleString(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: OPS_TIMEZONE,
  }).replace(",", "");
}

/**
 * Turns a datetime-local input value ("2026-08-17T00:00") into an
 * instant. The browser would read it as the viewer's local time; these
 * are operations-local, so the offset is applied explicitly.
 */
export function opsLocalToInstant(localValue: string): string | null {
  if (!localValue) return null;
  const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
  const d = new Date(`${withSeconds}${OPS_UTC_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Current operations-local wall clock as a datetime-local input value. */
export function opsNowLocalValue(offsetDays = 0, endOfDay = false): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPS_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;

  const base = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00${OPS_UTC_OFFSET}`);
  base.setUTCDate(base.getUTCDate() + offsetDays);

  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(base);
  return `${d}T${endOfDay ? "23:59" : "00:00"}`;
}

/**
 * Today's date in the operations timezone as YYYY-MM-DD.
 *
 * Deliberately not `new Date().toISOString().slice(0,10)`: that is UTC, so
 * for the hour either side of midnight in Algiers (UTC+1) it names the
 * wrong day and the dashboard's "today" figures silently reset an hour
 * early. en-CA formats as YYYY-MM-DD, which is what the DATE column wants.
 */
export function opsToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
