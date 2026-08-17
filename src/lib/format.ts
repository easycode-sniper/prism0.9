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
