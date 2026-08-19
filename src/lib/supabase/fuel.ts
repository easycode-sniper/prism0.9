"use server";

import { createClient } from "@/lib/supabase/server";

// Columns deliberately left out of every read here, per the office's own
// call on what's worth showing: shift, transaction_no (an internal pump
// reference, meaningless to a human), and the sheet's two intermediate
// "what the truck should have cost" figures — expected_litres and
// expected_cost_da. variance_da (the DA difference those two feed into)
// stays, since that's the actual signal; the two numbers on the way to
// it are noise on a page meant to be read at a glance.

export interface FuelTransactionRow {
  model: string | null;
  truckId: string | null;
  category: "truck" | "vh_service";
  driverName: string | null;
  occurredAt: string;
  cardNo: string | null;
  station: string | null;
  fuelType: string | null;
  amountDa: number;
  odometerKm: number | null;
  distanceKm: number | null;
  litresFilled: number | null;
  varianceDa: number | null;
}

export async function listRecentFuelTransactions(): Promise<{
  data: FuelTransactionRow[];
  error?: string;
}> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { data: [], error: "Not authenticated" };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(
      "model, truck_id, category, driver_name, occurred_at, card_no, station, fuel_type, amount_da, odometer_km, distance_km, litres_filled, variance_da"
    )
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false });

  if (error) return { data: [], error: error.message };

  return {
    data: (data ?? []).map((r) => ({
      model: r.model as string | null,
      truckId: r.truck_id as string | null,
      category: r.category as "truck" | "vh_service",
      driverName: r.driver_name as string | null,
      occurredAt: r.occurred_at as string,
      cardNo: r.card_no as string | null,
      station: r.station as string | null,
      fuelType: r.fuel_type as string | null,
      amountDa: Number(r.amount_da),
      odometerKm: r.odometer_km != null ? Number(r.odometer_km) : null,
      distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
      litresFilled: r.litres_filled != null ? Number(r.litres_filled) : null,
      varianceDa: r.variance_da != null ? Number(r.variance_da) : null,
    })),
  };
}
