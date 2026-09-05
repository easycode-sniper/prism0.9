import type { ClientRecord } from "@/lib/supabase/clients";

/**
 * Whether a delivery point is open at a given moment, from the fields
 * migration 051 parsed out of the sheet.
 *
 * Returns null — not false — when the source never said. 9 of the 130
 * rows have no hours at all, and "we don't know" is a different answer
 * from "closed"; showing those as shut would send a dispatcher looking
 * for another client for no reason.
 */
export function isOpenAt(c: ClientRecord, now: Date): boolean | null {
  const known = c.is24h === true || c.closesAt != null;
  if (!known) return null;

  // getDay() is 0=Sunday, so Friday is 5. The Algerian weekend is
  // Friday–Saturday and "vendredi exclu" appears on 31 of these rows.
  if (c.fridayExcluded && now.getDay() === 5) return false;

  if (c.is24h) return true;

  const mins = now.getHours() * 60 + now.getMinutes();
  const toMins = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const close = c.closesAt ? toMins(c.closesAt) : null;
  // "07H-00H" was stored as 24:00 rather than 00:00 precisely so that
  // midnight closing reads as the end of the day here — 00:00 would make
  // 31 of these look shut around the clock.
  const open = c.opensAt ? toMins(c.opensAt) : null;

  if (open != null && close != null) return mins >= open && mins < close;
  if (close != null) return mins < close;
  return null;
}

/** "24/7", "07:00–20:00", "closes 18:00", or null when unknown. */
export function hoursLabel(c: ClientRecord): string | null {
  if (c.is24h) return "24/7";
  if (c.opensAt && c.closesAt) return `${c.opensAt}–${c.closesAt}`;
  if (c.closesAt) return c.closesAt;
  return null;
}
