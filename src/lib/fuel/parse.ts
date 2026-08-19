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
  occurredAt: string; // ISO instant
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

/** "1/8/2026 02:47:58" -> ISO instant, read as Africa/Algiers local time.
 *  Day-first: the sheet is filled by hand in Algeria, and the only way to
 *  tell D/M from M/D apart in this data is that every value seen so far
 *  has a first component of 1-9 against a constant second component of
 *  8 (August) — i.e. day-first, not month-first with a very unlikely
 *  all-January dataset. Algeria does not observe DST, so +01:00 is the
 *  correct offset year-round, matching OPS_UTC_OFFSET elsewhere in the
 *  app. Returns null rather than throwing on a value that doesn't parse,
 *  since one bad cell should skip that field, not the whole sync. */
export function parseSheetDateTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
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
export function parseFuelRow(cells: string[]): FuelTransaction | null {
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
  const occurredAt = parseSheetDateTime(cells[COL.dateTime] ?? "");
  if (!occurredAt) return null;

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
