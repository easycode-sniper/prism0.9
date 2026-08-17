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
