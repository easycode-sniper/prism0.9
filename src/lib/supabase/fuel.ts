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
  occurredRaw: string | null;
  cardNo: string | null;
  station: string | null;
  fuelType: string | null;
  amountDa: number;
  odometerKm: number | null;
  distanceKm: number | null;
  litresFilled: number | null;
  varianceDa: number | null;
}

// A fixed number of rows rather than a time window. A 24-hour window
// answers "what happened today", which is a different question from the
// one this page is asked — the sheet syncs in bursts, so a quiet day
// showed a nearly empty table and a catch-up sync showed several
// hundred rows at once. A hundred is a page you can scroll to the end
// of, and it is the same size whenever you open it.
//
// Not exported: every export of a "use server" file has to be an async
// function, so a bare const here fails the build outright.
const FUEL_ROW_LIMIT = 100;

export async function listRecentFuelTransactions(): Promise<{
  data: FuelTransactionRow[];
  error?: string;
}> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { data: [], error: "Not authenticated" };

  const { data, error } = await supabase
    .from("fuel_transactions")
    .select(
      "model, truck_id, category, driver_name, occurred_at, occurred_raw, sheet_row, card_no, station, fuel_type, amount_da, odometer_km, distance_km, litres_filled, variance_da"
    )
    // Ordered by position in the sheet, not by occurred_at. The sheet is
    // append-ordered, so its last rows are the last logged — and 163 of
    // its rows carry a date in the future, which sorted every one of
    // them above today. This page was showing 44 December fills, 41
    // November and 15 October, and not one real recent one.
    // nullsFirst: false keeps any row synced before sheet_row existed at
    // the bottom rather than the top.
    .order("sheet_row", { ascending: false, nullsFirst: false })
    .limit(FUEL_ROW_LIMIT);

  if (error) return { data: [], error: error.message };

  return {
    data: (data ?? []).map((r) => ({
      model: r.model as string | null,
      truckId: r.truck_id as string | null,
      category: r.category as "truck" | "vh_service",
      driverName: r.driver_name as string | null,
      occurredAt: r.occurred_at as string,
      occurredRaw: (r.occurred_raw as string | null) ?? null,
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
