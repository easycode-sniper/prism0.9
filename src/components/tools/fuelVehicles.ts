// The five staff vehicles the fuel estimator knows, with the prices and
// consumption rates the owner calibrated them at. Ported verbatim from
// the standalone "Comanche" tool (2026-09-22) so the numbers stay the
// ones he already trusts — the only change is "Essence" becoming the
// proper English "Petrol", with the French "Essence" living in the
// translations file (check-i18n fails identical en/fr strings).

export type FuelKind = "diesel" | "petrol" | "gpl";

export type DrivingCondition = "city" | "highway" | "mixed";

export interface FuelVehicle {
  id: string;
  /** Display name — a proper noun, rendered literally, never through t(). */
  name: string;
  /** Engine tagline, also literal ("HDI 2.0 · 31 DA/L"). */
  detail: string;
  fuel: FuelKind;
  /** DA per litre. */
  pricePerLitre: number;
  /** L/100km per driving condition. */
  rates: Record<DrivingCondition, number>;
}

export const FUEL_VEHICLES: FuelVehicle[] = [
  {
    id: "scudo",
    name: "Fiat Scudo 2024",
    detail: "HDI 2.0 · 31 DA/L",
    fuel: "diesel",
    pricePerLitre: 31,
    rates: { city: 9.5, highway: 6.8, mixed: 8.0 },
  },
  {
    id: "logan",
    name: "Renault Logan 2015",
    detail: "1.6L · 47 DA/L",
    fuel: "petrol",
    pricePerLitre: 47,
    rates: { city: 8.5, highway: 6.0, mixed: 7.2 },
  },
  {
    id: "hilux",
    name: "Toyota Hilux 2.5",
    detail: "2.5D · 31 DA/L",
    fuel: "diesel",
    pricePerLitre: 31,
    rates: { city: 11.0, highway: 8.0, mixed: 9.5 },
  },
  {
    id: "duster",
    name: "Dacia Duster 2015",
    detail: "1.6 SCe GPL · 18 DA/L",
    fuel: "gpl",
    pricePerLitre: 18,
    rates: { city: 10.5, highway: 7.5, mixed: 9.0 },
  },
  {
    id: "gonow",
    name: "Gonow Mini Truck",
    detail: "1.3L SC · 47 DA/L",
    fuel: "petrol",
    pricePerLitre: 47,
    rates: { city: 9.5, highway: 7.0, mixed: 8.5 },
  },
];

export interface FuelEstimate {
  litres: number;
  costDa: number;
  rate: number;
}

/**
 * Fuel Needed (L) = Distance (km) / 100 × Rate;
 * Total Cost (DA) = Fuel Needed (L) × Fuel Price (DA/L).
 * The same two lines the standalone tool used.
 */
export function estimateFuel(
  vehicle: FuelVehicle,
  distanceKm: number,
  condition: DrivingCondition
): FuelEstimate | null {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  const rate = vehicle.rates[condition];
  const litres = (distanceKm / 100) * rate;
  return { litres, costDa: litres * vehicle.pricePerLitre, rate };
}
