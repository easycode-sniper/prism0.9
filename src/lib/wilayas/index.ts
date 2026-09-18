// Algerian wilayas: the reference table and the small geometry that
// hangs off it.
//
// SCOPE, stated plainly. The `coordinates` on each entry are the
// CAPITAL CITY, good to roughly a kilometre. A wilaya's real outline
// is an irregular polygon and none of that lives here — so
// `findClosestWilaya` answers "which wilaya capital is nearest", which
// for the 30-odd northern wilayas is a fine proxy for "which wilaya is
// this", and for the vast southern ones (Tamanrasset alone is bigger
// than France) it is an approximation that can name the neighbour near
// a border. Anything that needs real wilaya boundaries needs boundary
// data, which is a different module.
//
// THE DATASET IS THE POST-2021 OFFICIAL LIST: 58 wilayas, the 10 new
// southern ones at codes 49-58. A module-level check below refuses to
// run if the array is not exactly 58 — a truncated copy of this table
// (a sample pasted with "append up to 58" still attached) must fail
// loudly at import, not quietly match only the north.

// RELATIVE ".ts", not "@/": bare node cannot resolve tsconfig paths, and
// the check scripts import this module directly. Same reason
// freshness.ts and positionCheck.ts spell their imports this way.
import { haversineMeters } from "../geometry/index.ts";

export interface Wilaya {
  id: number;
  code: string;
  nameEn: string;
  nameAr: string;
  capital: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  /** Alternative spellings the office types, folded and matched by
   *  getWilayaByName. "Alger" is the reason this exists: it is not a
   *  prefix of "Algiers" (the i breaks it), so no amount of prefix
   *  matching would ever connect the French name to the English one. */
  aliases?: string[];
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export const wilayas: Wilaya[] = [
  { id: 1, code: "01", nameEn: "Adrar", nameAr: "أدرار", capital: "Adrar", coordinates: { lat: 27.8742, lng: -0.2938 } },
  { id: 2, code: "02", nameEn: "Chlef", nameAr: "الشلف", capital: "Chlef", coordinates: { lat: 36.1647, lng: 1.3317 } },
  { id: 3, code: "03", nameEn: "Laghouat", nameAr: "الأغواط", capital: "Laghouat", coordinates: { lat: 33.8003, lng: 2.865 } },
  { id: 4, code: "04", nameEn: "Oum El Bouaghi", nameAr: "أم البواقي", capital: "Oum El Bouaghi", coordinates: { lat: 35.8753, lng: 7.1135 } },
  { id: 5, code: "05", nameEn: "Batna", nameAr: "باتنة", capital: "Batna", coordinates: { lat: 35.556, lng: 6.1741 } },
  { id: 6, code: "06", nameEn: "Béjaïa", nameAr: "بجاية", capital: "Béjaïa", coordinates: { lat: 36.7509, lng: 5.0567 } },
  { id: 7, code: "07", nameEn: "Biskra", nameAr: "بسكرة", capital: "Biskra", coordinates: { lat: 34.8504, lng: 5.7281 } },
  { id: 8, code: "08", nameEn: "Béchar", nameAr: "بشار", capital: "Béchar", coordinates: { lat: 31.6167, lng: -2.2167 } },
  { id: 9, code: "09", nameEn: "Blida", nameAr: "البليدة", capital: "Blida", coordinates: { lat: 36.4703, lng: 2.8277 } },
  { id: 10, code: "10", nameEn: "Bouira", nameAr: "البويرة", capital: "Bouira", coordinates: { lat: 36.3736, lng: 3.902 } },
  { id: 11, code: "11", nameEn: "Tamanrasset", nameAr: "تمنراست", capital: "Tamanrasset", coordinates: { lat: 22.785, lng: 5.5228 } },
  { id: 12, code: "12", nameEn: "Tébessa", nameAr: "تبسة", capital: "Tébessa", coordinates: { lat: 35.4042, lng: 8.1242 } },
  { id: 13, code: "13", nameEn: "Tlemcen", nameAr: "تلمسان", capital: "Tlemcen", coordinates: { lat: 34.8828, lng: -1.3167 } },
  { id: 14, code: "14", nameEn: "Tiaret", nameAr: "تيارت", capital: "Tiaret", coordinates: { lat: 35.3711, lng: 1.317 } },
  { id: 15, code: "15", nameEn: "Tizi Ouzou", nameAr: "تيزي وزو", capital: "Tizi Ouzou", coordinates: { lat: 36.7118, lng: 4.0435 } },
  { id: 16, code: "16", nameEn: "Algiers", nameAr: "الجزائر", capital: "Algiers", coordinates: { lat: 36.7525, lng: 3.042 }, aliases: ["Alger"] },
  { id: 17, code: "17", nameEn: "Djelfa", nameAr: "الجلفة", capital: "Djelfa", coordinates: { lat: 34.6703, lng: 3.263 } },
  { id: 18, code: "18", nameEn: "Jijel", nameAr: "جيجل", capital: "Jijel", coordinates: { lat: 36.8206, lng: 5.7667 } },
  { id: 19, code: "19", nameEn: "Sétif", nameAr: "سطيف", capital: "Sétif", coordinates: { lat: 36.1911, lng: 5.4137 } },
  { id: 20, code: "20", nameEn: "Saïda", nameAr: "سعيدة", capital: "Saïda", coordinates: { lat: 34.8303, lng: 0.1517 } },
  { id: 21, code: "21", nameEn: "Skikda", nameAr: "سكيكدة", capital: "Skikda", coordinates: { lat: 36.8761, lng: 6.9092 } },
  { id: 22, code: "22", nameEn: "Sidi Bel Abbès", nameAr: "سيدي بلعباس", capital: "Sidi Bel Abbès", coordinates: { lat: 35.1897, lng: -0.6306 } },
  { id: 23, code: "23", nameEn: "Annaba", nameAr: "عنابة", capital: "Annaba", coordinates: { lat: 36.9, lng: 7.7667 } },
  { id: 24, code: "24", nameEn: "Guelma", nameAr: "قالمة", capital: "Guelma", coordinates: { lat: 36.4611, lng: 7.4331 } },
  { id: 25, code: "25", nameEn: "Constantine", nameAr: "قسنطينة", capital: "Constantine", coordinates: { lat: 36.365, lng: 6.6147 } },
  { id: 26, code: "26", nameEn: "Médéa", nameAr: "المدية", capital: "Médéa", coordinates: { lat: 36.2675, lng: 2.75 } },
  { id: 27, code: "27", nameEn: "Mostaganem", nameAr: "مستغانم", capital: "Mostaganem", coordinates: { lat: 35.9315, lng: 0.0892 } },
  { id: 28, code: "28", nameEn: "M'Sila", nameAr: "المسيلة", capital: "M'Sila", coordinates: { lat: 35.7058, lng: 4.5419 } },
  { id: 29, code: "29", nameEn: "Mascara", nameAr: "معسكر", capital: "Mascara", coordinates: { lat: 35.3975, lng: 0.1403 } },
  { id: 30, code: "30", nameEn: "Ouargla", nameAr: "ورقلة", capital: "Ouargla", coordinates: { lat: 31.9497, lng: 5.3253 } },
  { id: 31, code: "31", nameEn: "Oran", nameAr: "وهران", capital: "Oran", coordinates: { lat: 35.6971, lng: -0.6308 } },
  { id: 32, code: "32", nameEn: "El Bayadh", nameAr: "البيض", capital: "El Bayadh", coordinates: { lat: 33.6831, lng: 1.0192 } },
  { id: 33, code: "33", nameEn: "Illizi", nameAr: "إليزي", capital: "Illizi", coordinates: { lat: 26.4833, lng: 8.4667 } },
  { id: 34, code: "34", nameEn: "Bordj Bou Arreridj", nameAr: "برج بوعريريج", capital: "Bordj Bou Arreridj", coordinates: { lat: 36.0731, lng: 4.7608 } },
  { id: 35, code: "35", nameEn: "Boumerdès", nameAr: "بومرداس", capital: "Boumerdès", coordinates: { lat: 36.7667, lng: 3.4772 } },
  { id: 36, code: "36", nameEn: "El Tarf", nameAr: "الطارف", capital: "El Tarf", coordinates: { lat: 36.7672, lng: 8.3139 } },
  { id: 37, code: "37", nameEn: "Tindouf", nameAr: "تندوف", capital: "Tindouf", coordinates: { lat: 27.6711, lng: -8.1472 } },
  { id: 38, code: "38", nameEn: "Tissemsilt", nameAr: "تيسمسيلت", capital: "Tissemsilt", coordinates: { lat: 35.6072, lng: 1.8111 } },
  { id: 39, code: "39", nameEn: "El Oued", nameAr: "الوادي", capital: "El Oued", coordinates: { lat: 33.3683, lng: 6.8619 } },
  { id: 40, code: "40", nameEn: "Khenchela", nameAr: "خنشلة", capital: "Khenchela", coordinates: { lat: 35.4361, lng: 7.1436 } },
  { id: 41, code: "41", nameEn: "Souk Ahras", nameAr: "سوق أهراس", capital: "Souk Ahras", coordinates: { lat: 36.2864, lng: 7.9553 } },
  { id: 42, code: "42", nameEn: "Tipaza", nameAr: "تيبازة", capital: "Tipaza", coordinates: { lat: 36.5894, lng: 2.4483 } },
  { id: 43, code: "43", nameEn: "Mila", nameAr: "ميلة", capital: "Mila", coordinates: { lat: 36.4503, lng: 6.2644 } },
  { id: 44, code: "44", nameEn: "Aïn Defla", nameAr: "عين الدفلى", capital: "Aïn Defla", coordinates: { lat: 36.2639, lng: 1.9678 } },
  { id: 45, code: "45", nameEn: "Naâma", nameAr: "النعامة", capital: "Naâma", coordinates: { lat: 33.2667, lng: -0.3167 } },
  { id: 46, code: "46", nameEn: "Aïn Témouchent", nameAr: "عين تموشنت", capital: "Aïn Témouchent", coordinates: { lat: 35.2986, lng: -1.14 } },
  { id: 47, code: "47", nameEn: "Ghardaïa", nameAr: "غرداية", capital: "Ghardaïa", coordinates: { lat: 32.4909, lng: 3.6735 } },
  { id: 48, code: "48", nameEn: "Relizane", nameAr: "غليزان", capital: "Relizane", coordinates: { lat: 35.7372, lng: 0.5558 } },
  { id: 49, code: "49", nameEn: "Timimoun", nameAr: "تيميمون", capital: "Timimoun", coordinates: { lat: 29.2606, lng: 0.2394 } },
  { id: 50, code: "50", nameEn: "Bordj Badji Mokhtar", nameAr: "برج باجي مختار", capital: "Bordj Badji Mokhtar", coordinates: { lat: 21.335, lng: 0.9542 } },
  { id: 51, code: "51", nameEn: "Ouled Djellal", nameAr: "أولاد جلال", capital: "Ouled Djellal", coordinates: { lat: 34.4211, lng: 5.0631 } },
  { id: 52, code: "52", nameEn: "Béni Abbès", nameAr: "بني عباس", capital: "Béni Abbès", coordinates: { lat: 30.1306, lng: -2.1656 } },
  { id: 53, code: "53", nameEn: "In Salah", nameAr: "عين صالح", capital: "In Salah", coordinates: { lat: 27.1963, lng: 2.4667 } },
  { id: 54, code: "54", nameEn: "In Guezzam", nameAr: "عين قزام", capital: "In Guezzam", coordinates: { lat: 19.5723, lng: 5.7686 } },
  { id: 55, code: "55", nameEn: "Touggourt", nameAr: "تقرت", capital: "Touggourt", coordinates: { lat: 33.1036, lng: 6.0589 } },
  { id: 56, code: "56", nameEn: "Djanet", nameAr: "جانت", capital: "Djanet", coordinates: { lat: 24.5536, lng: 9.4842 } },
  { id: 57, code: "57", nameEn: "El M'Ghair", nameAr: "المغير", capital: "El M'Ghair", coordinates: { lat: 33.9542, lng: 6.9136 } },
  { id: 58, code: "58", nameEn: "El Meniaa", nameAr: "المنيعة", capital: "El Meniaa", coordinates: { lat: 30.5806, lng: 2.8833 } },
];

if (wilayas.length !== 58) {
  // Module-scope, on purpose: it fires at import time, so a dataset
  // that lost rows in a copy-paste cannot survive to match only the
  // northern half of the country.
  throw new Error(`wilayas: expected the full 58-wilaya dataset, got ${wilayas.length}`);
}

/** Find a wilaya by its standard numerical code or ID ("16" and 16
 *  both work — Wialon names, plate prefixes and hand-typed admin text
 *  arrive in both shapes). */
export function getWilayaByCode(code: string | number): Wilaya | undefined {
  const formattedCode = typeof code === "number" ? String(code).padStart(2, "0") : code.padStart(2, "0");
  return wilayas.find((w) => w.code === formattedCode);
}

/** Match-folding: lowercase, accents stripped (Béjaïa -> bejaia), and
 *  punctuation and spaces dropped (M'Sila -> msila). The office types
 *  accent-free and apostrophe-optional; a lookup that demanded the
 *  exact spelling would never survive contact with that. Arabic passes
 *  through untouched apart from its diacritics, which \p{M} removes. */
function fold(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\u0600-\u06FF]/g, "");
}

/** Case-, accent- and punctuation-insensitive match on the English or
 *  Arabic name, or the capital. The office writes "alger", "Alger",
 *  "bejaia", "الجزائر" — this is the lookup that survives all of them. */
export function getWilayaByName(name: string): Wilaya | undefined {
  const needle = fold(name);
  if (!needle) return undefined;
  const matches = (w: Wilaya) =>
    fold(w.nameEn) === needle ||
    fold(w.capital) === needle ||
    fold(w.nameAr) === needle ||
    (w.aliases?.some((a) => fold(a) === needle) ?? false);
  const exact = wilayas.find(matches);
  if (exact) return exact;
  // Prefix fallback, so a stub like "tizi" resolves to Tizi Ouzou.
  // Requiring UNIQUENESS keeps a stub like "el" — five El-* wilayas —
  // from resolving to whichever one the array happens to meet first.
  const prefixed = wilayas.filter(
    (w) =>
      fold(w.nameEn).startsWith(needle) ||
      fold(w.capital).startsWith(needle) ||
      fold(w.nameAr).startsWith(needle) ||
      (w.aliases?.some((a) => fold(a).startsWith(needle)) ?? false)
  );
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

/**
 * Great-circle distance between two coordinates, in KILOMETRES.
 *
 * Delegates to haversineMeters rather than carrying its own formula —
 * a codebase with two Haversines is a codebase where the distances
 * eventually disagree. Alias exists so wilaya call sites can read in
 * the domain's unit and vocabulary.
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineMeters(lat1, lng1, lat2, lng2) / 1000;
}

/** The wilaya whose capital is nearest to the point, with the distance
 *  to it in km. See the module header for what this can and cannot
 *  claim: near a border of a large southern wilaya the neighbour's
 *  capital may be closer than the truth. */
export function findClosestWilaya(
  lat: number,
  lng: number
): { wilaya: Wilaya; distanceKm: number } {
  // The dataset is a non-empty module constant, so a closest always
  // exists — no null branch to misuse.
  return wilayas.reduce<{ wilaya: Wilaya; distanceKm: number }>((closest, current) => {
    const distanceKm = calculateDistance(lat, lng, current.coordinates.lat, current.coordinates.lng);
    return distanceKm < closest.distanceKm ? { wilaya: current, distanceKm } : closest;
  }, { wilaya: wilayas[0], distanceKm: Infinity });
}

/** True when the point sits inside the box. Boxes are INCLUSIVE on
 *  every edge — a point exactly on the boundary is inside it. */
export function isWithinBounds(lat: number, lng: number, bounds: BoundingBox): boolean {
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

/**
 * The box that contains every point within `radiusKm` of the centre.
 *
 * The longitude half is WIDENED by the cosine of the latitude — a
 * degree of longitude is only cos(lat) × 111.32 km wide, and a box that
 * forgot that would be too narrow by 40% in Algiers. What comes back is
 * an approximation that always contains the circle (a box around a
 * circle necessarily pokes out at the corners); good for prefiltering
 * rows or framing a map, not for "is this point within R km" — that is
 * `calculateDistance <= R`, which is exact.
 */
export function boundingBoxAround(lat: number, lng: number, radiusKm: number): BoundingBox {
  const KM_PER_DEG_LAT = 110.574;
  const KM_PER_DEG_LNG_AT_EQUATOR = 111.32;
  const latDelta = radiusKm / KM_PER_DEG_LAT;
  const lngDelta = radiusKm / (KM_PER_DEG_LNG_AT_EQUATOR * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
