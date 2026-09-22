// Pure transformation behind the Excel transaction processor.
//
// The component parses the workbook (SheetJS) and hands the first
// sheet's rows here as a matrix; everything below is workbook-agnostic,
// which is what makes it testable under node (scripts/check-tools.mts)
// without a DOM or the xlsx package.
//
// The six steps are the standalone "Comanche" tool's, unchanged:
//   1. strip the header row
//   2. drop columns C, D, F, J, K — keep A, B, E, G, H, I
//   3-4. reorder to Date Transaction · N° Carte · N° Transaction ·
//      Station · Produit · Montant (the original did this as two swaps;
//      the net mapping is direct: [8, 1, 0, 4, 6, 7])
//   5. sort oldest → newest on the date column
//   6. append the vehicle id and plate via the card mapping
//
// Relative import WITH the extension: check scripts run under
// node --experimental-strip-types, which does not resolve tsconfig path
// aliases (same reason siteZones.ts imports geometry relatively).

import { lookupCard, CARD_NOT_FOUND } from "./cardMapping.ts";

/** The export header. Literal French, deliberately NOT a t() key — these
 *  strings are pasted into the fuel sheet, so they must never translate. */
export const PROCESSED_HEADER = [
  "Date Transaction",
  "N° Carte",
  "N° Transaction",
  "Station",
  "Produit",
  "Montant",
  "N° carte unique",
  "Matricule",
] as const;

export type RawRow = unknown[];
export type ProcessedRow = unknown[];

/**
 * Excel serial dates (days since 1899-12-30) and "DD/MM/YYYY [HH:mm[:ss]]"
 * strings both occur in the Date Transaction column, so both parse.
 * Anything else sorts as the epoch — the original's `new Date(0)` — which
 * puts undated rows first rather than dropping them silently.
 */
export function parseTransactionDate(value: unknown): Date {
  if (value == null) return new Date(0);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date((value - 25569) * 86400 * 1000);
  }
  if (typeof value === "string") {
    const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{1,2}):?(\d{1,2})?/);
    if (m) {
      return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    }
  }
  return new Date(0);
}

/**
 * Full pipeline: raw sheet matrix (header row included) → export matrix
 * (export header + cleaned rows). Rows shorter than nine columns read
 * their missing cells as undefined, exactly as sheet_to_json produces
 * them — ragged tails are data, not errors.
 */
export function processTransactionRows(sheetRows: RawRow[]): ProcessedRow[] {
  const dataRows = sheetRows
    .slice(1)
    // Keep A, B, E, G, H, I; reorder to Date, Carte, Transaction, Station, Produit, Montant.
    .map((r) => [r[8], r[1], r[0], r[4], r[6], r[7]])
    .sort((a, b) => parseTransactionDate(a[0]).getTime() - parseTransactionDate(b[0]).getTime())
    // The card number is column B of the output (index 1). Known cards
    // append id + plate; unknown cards get "not found" and an empty plate.
    .map((r) => {
      const entry = lookupCard(r[1]);
      return [...r, entry?.id ?? CARD_NOT_FOUND, entry?.mat ?? ""];
    });
  return [[...PROCESSED_HEADER], ...dataRows];
}

/**
 * Preview formatting: Excel serials in the plausible date range render
 * as DD/MM/YYYY HH:mm:ss, everything else as-is. The export itself keeps
 * the raw values — this is display only.
 */
export function formatPreviewCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && value > 40000 && value < 50000) {
    const d = parseTransactionDate(value);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return String(value);
}
