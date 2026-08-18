// The office spreadsheet's phone column is free text, entered by hand
// over several years. Real values in it include:
//
//   "06 61 63 48 92"                        spaced
//   "0659059194"                            unspaced
//   "0662 95 42 85"                         partly spaced
//   "06 72 72 21 39/0697 11 96 59"          two numbers, slash-separated
//   "0671772530/0664238273/0549578762"      three
//   "0654704505 / 0795019935"               slash with spaces
//   "NO => 06.62.19.00.02"                  a note, dots as separators
//
// All of it means "here are one or more Algerian mobile numbers". This
// pulls the numbers out and prints them one way, so the page doesn't
// render seven different formats and a copied card doesn't paste a stray
// "NO =>" into someone's message.

/** Algerian mobiles are 10 digits starting 05/06/07; landlines are 9 or
 *  10 starting 0. Anything shorter is a typo we pass through untouched
 *  rather than silently dropping. */
const DIGITS = /\d+/g;

function formatOne(digits: string): string {
  // 0X XX XX XX XX — the grouping used on every Algerian mobile.
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  }
  return digits;
}

/**
 * Split a raw cell into individual numbers, normalized.
 * Returns [] when there is nothing usable, which the caller renders as n/a.
 */
export function parsePhones(raw: string | null | undefined): string[] {
  if (!raw) return [];

  // Split on the separators actually used, then keep only the digits of
  // each part. Joining the digits per-part (rather than globally) is what
  // keeps "0671772530/0664238273" from becoming one 20-digit number.
  const parts = raw.split(/[/;,]|\s{2,}/);

  const out: string[] = [];
  for (const part of parts) {
    const digits = (part.match(DIGITS) || []).join("");
    if (digits.length < 6) continue;
    const formatted = formatOne(digits);
    if (!out.includes(formatted)) out.push(formatted);
  }
  return out;
}

/** Everything on one line, for a card's copy payload. */
export function formatPhones(raw: string | null | undefined): string | null {
  const phones = parsePhones(raw);
  return phones.length ? phones.join(" · ") : null;
}

/** tel: target — digits only, and only the first number when several. */
export function telHref(raw: string | null | undefined): string | null {
  const first = parsePhones(raw)[0];
  return first ? `tel:${first.replace(/\s/g, "")}` : null;
}
