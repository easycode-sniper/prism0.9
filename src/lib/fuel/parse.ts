// Turning one raw sheet row into a typed transaction.
//
// The sheet computes four of its own columns (litre filled, "Liters per
// Km", "Cost per Km", Variance) with formulas, and none of those four are
// trusted here — they are recomputed from litres_filled, distance_km,
// and the two rates below. Two real problems in the source sheet made
// that the right call rather than a style preference:
//
//   1. Distance Traveled is sometimes stored as locale-formatted TEXT
//      ("1 226", narrow-no-break-space thousands separator) instead of a
//      number, which breaks Sheets' own downstream arithmetic — 18 of
//      800 real transactions read "#VALUE!" for Variance as a result.
//      Recomputing here fixes those for free, since the parser below
//      strips separator characters before parsing regardless of which
//      character Sheets used.
//
//   2. "Liters per Km" and "Cost per Km" are mislabeled: verified against
//      real rows, "Liters per Km" actually holds the EXPECTED litres for
//      the distance driven (distance/100 * rate), and "Cost per Km"
//      holds that expected litres priced in dinars. Both are re-derived
//      under their real names here rather than propagating the sheet's
//      naming.

/** DA per litre of diesel and the assumed litres/100km, as configured in
 *  the sheet's own formulas (confirmed against real transactions: for a
 *  transaction with Distance Traveled = 672, "Liters per Km" = 302.4,
 *  which is exactly 672/100*45). These are business assumptions, not
 *  physical constants, so they belong here as named values rather than
 *  buried in the formula that uses them. */
export const DIESEL_PRICE_DA_PER_L = 31;
export const ASSUMED_L_PER_100KM = 45;

export type FuelCategory = "truck" | "vh_service";

export interface FuelTransaction {
  transactionNo: string;
  shift: string | null;
  model: string | null;
  truckId: string | null;
  category: FuelCategory;
  driverName: string | null;
  occurredAt: string; // ISO instant, parsed day-first — ambiguous, see occurredRaw
  /** The Date & Time cell exactly as the sheet renders it. What the
   *  Carburant page shows, so the app and the sheet cannot disagree. */
  occurredRaw: string | null;
  /** 1-based row number in the sheet. The sheet is append-ordered, so
   *  this is what "most recent" means for a column nobody can parse. */
  sheetRow: number | null;
  cardNo: string | null;
  station: string | null;
  fuelType: string | null;
  amountDa: number;
  odometerKm: number | null;
  distanceKm: number | null;
  litresFilled: number | null;
  expectedLitres: number | null;
  expectedCostDa: number | null;
  varianceDa: number | null;
}

/** A cell from Sheets' UNFORMATTED_VALUE mode is already a JS number for
 *  a genuine numeric cell, and a string for everything else — including
 *  a number that got typed or formula'd into the sheet as text. This
 *  handles both, stripping the separator characters actually seen in
 *  this sheet (plain space, NBSP, the narrow NBSP Sheets' own TEXT()
 *  grouping uses, and comma) rather than assuming one. "#VALUE!" and
 *  blank both come back null — a formula error carries no number to
 *  recover, distinct from 0, which is a real reading. */
export function parseSheetNumber(cell: unknown): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== "string") return null;

  const cleaned = cell.replace(/[\s  ,]/g, "").trim();
  if (!cleaned || cleaned.startsWith("#")) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Sheets' 1899-12-30 epoch, in UTC. The serial is a day count with the
 *  time as its fraction, and it is what a date cell actually IS —
 *  independent of whatever format that cell happens to display in. */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

/** A date-time serial from Sheets -> ISO instant, read as Africa/Algiers
 *  wall-clock time. Algeria does not observe DST, so +01:00 is correct
 *  year-round, matching OPS_UTC_OFFSET elsewhere in the app. */
function fromSheetSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;

  // Rounded to whole seconds before it becomes a date. The serial is a
  // float, so a time that is exactly 23:00:00 can arrive as .9583333329
  // of a day and truncate to 22:59:59 — an hour-boundary error that
  // would land a late-evening fill on the previous day.
  const ms = SHEETS_EPOCH_UTC + Math.round(serial * 86_400) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;

  // The serial encodes wall-clock time with no zone of its own, so it is
  // built in UTC and read back out of the UTC fields, then re-stamped as
  // +01:00 — the offset the sheet was filled in.
  const p = (n: number) => String(n).padStart(2, "0");
  const iso =
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+01:00`;

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A sheet date cell -> ISO instant.
 *
 *  Normally a number: the fetch asks Sheets for SERIAL_NUMBER, so a real
 *  date cell arrives as its serial and there is nothing to interpret.
 *
 *  This used to read a formatted string and assume day-first, reasoning
 *  from a sample where the second component was always 8 that the data
 *  had to be D/M against August. It was month-first, and the giveaway is
 *  in the odometer: ordered by odometer — which only ever climbs — the
 *  dates ran Jan 8, Feb 8, Apr 8, Jun 8, Oct 8, Dec 8 and only then Aug
 *  13 onward. Read each of those months as the day of August and the
 *  sequence is exactly in order. Every fill whose day was 12 or less had
 *  been moved to another month, 474 rows of 1142, some of them into the
 *  future.
 *
 *  The string branch stays for a cell that holds text rather than a real
 *  date, which this sheet does produce. It is deliberately strict about
 *  the day-first order and returns null on an impossible month rather
 *  than swapping the two to make it fit: dropping one row is visible in
 *  the sync's skip count, and silently moving it is not.
 *
 *  Returns null rather than throwing, so one bad cell skips its row
 *  instead of failing the whole sync. */
export function parseSheetDateTime(raw: unknown): string | null {
  if (typeof raw === "number") return fromSheetSerial(raw);
  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A serial that came back as a numeric string rather than a number.
  if (/^\d+(\.\d+)?$/.test(trimmed)) return fromSheetSerial(Number(trimmed));

  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;

  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${h.padStart(2, "0")}:${mi}:${s}+01:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Strips the zero-width non-joiner Sheets prefixes onto numeric-looking
 *  text to force it to display as text rather than a number it would
 *  otherwise round or reformat. Cosmetic only — Card No is never used as
 *  a join key — but left in, it would round-trip into every export. */
function cleanText(raw: string | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[​‌‍﻿]/g, "").trim();
  return cleaned || null;
}

const COL = {
  shift: 0,
  model: 1,
  truckId: 2,
  driver: 3,
  dateTime: 4,
  cardNo: 5,
  transactionNo: 6,
  station: 7,
  fuelType: 8,
  amountFilled: 9,
  odometer: 10,
  distance: 11,
  litreFilled: 12,
  // 13, 14, 15 are the sheet's own (sometimes-broken) computed columns —
  // read nowhere here, recomputed below instead.
} as const;

/**
 * Parse one raw row into a transaction, or null when the row is not a
 * real transaction at all — the sheet's formulas are dragged hundreds of
 * rows past the last real one, so the trailing block reads as all-blank
 * except for zeroed formula columns. Transaction No is the one field
 * that is unconditionally present on every genuine transaction and
 * unconditionally absent on the filler rows, so it is the filter.
 */
export function parseFuelRow(cells: string[], sheetRow?: number): FuelTransaction | null {
  const transactionNo = cleanText(cells[COL.transactionNo]);
  if (!transactionNo) return null;

  const rawTruckId = cleanText(cells[COL.truckId]);
  const rawModel = cleanText(cells[COL.model]);
  // "Vh Service" fills are for pool/support vehicles Wialon doesn't
  // track (a Hilux, in the sample data) — a real, distinct category, not
  // a data-entry error, so it gets its own bucket rather than being
  // dropped or forced to match a cargo truck.
  const category: FuelCategory =
    rawModel?.toUpperCase() === "VH SERVICE" || rawTruckId?.toUpperCase() === "VH SERVICE"
      ? "vh_service"
      : "truck";

  // A transaction with no parseable timestamp cannot be placed in any
  // "today" aggregate — defaulting it to some placeholder instant would
  // silently corrupt whichever day it landed on, so it is dropped
  // instead. Every one of 800 real rows in the source has a real date;
  // this only fires on genuine corruption.
  const rawDateCell = cells[COL.dateTime];
  const occurredAt = parseSheetDateTime(rawDateCell);
  if (!occurredAt) return null;

  // Stringified rather than cleanText'd: this is a mirror, so it keeps
  // whatever the sheet shows, including a value that arrived as a number.
  const occurredRaw =
    rawDateCell == null || String(rawDateCell).trim() === "" ? null : String(rawDateCell).trim();

  const amountDa = parseSheetNumber(cells[COL.amountFilled]) ?? 0;
  const odometerKm = parseSheetNumber(cells[COL.odometer]);
  const distanceKm = parseSheetNumber(cells[COL.distance]);
  const litresFilled = parseSheetNumber(cells[COL.litreFilled]);

  // Only meaningful once a truck has a prior odometer reading to measure
  // from — a first-ever fill (or a Vh Service line, which never carries
  // an odometer) has no distance, and therefore no expectation to
  // compare against. Null there, not 0: 0 would claim "this truck should
  // have used no fuel," which is false, not merely unknown.
  const expectedLitres = distanceKm != null ? (distanceKm / 100) * ASSUMED_L_PER_100KM : null;
  const expectedCostDa = expectedLitres != null ? expectedLitres * DIESEL_PRICE_DA_PER_L : null;
  const varianceDa = expectedCostDa != null ? amountDa - expectedCostDa : null;

  return {
    transactionNo,
    shift: cleanText(cells[COL.shift]),
    model: rawModel,
    truckId: category === "vh_service" ? null : rawTruckId,
    category,
    driverName: cleanText(cells[COL.driver]),
    occurredAt,
    occurredRaw,
    sheetRow: sheetRow ?? null,
    cardNo: cleanText(cells[COL.cardNo]),
    station: cleanText(cells[COL.station]),
    fuelType: cleanText(cells[COL.fuelType]),
    amountDa,
    odometerKm,
    distanceKm,
    litresFilled,
    expectedLitres,
    expectedCostDa,
    varianceDa,
  };
}
