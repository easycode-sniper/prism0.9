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
  sheetRow: number | null;
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

// One page of the month, read through fuel_page_transactions (068).
// The RPC is what makes this page possible at all: it paginates in SQL
// (PostgREST silently truncates at 1000 rows, and a month at current
// volume outgrew that), matches drivers through norm_driver_name the
// way every other fuel surface does, and carries the filtered month's
// totals alongside the rows so the header costs no second call.
//
// Not exported: every export of a "use server" file has to be an async
// function, so a bare const here fails the build outright.
const FUEL_PAGE_SIZE = 200;

export interface FuelPageFilters {
  driver: string | null;
  truck: string | null;
  model: string | null;
}

export interface FuelPageData {
  rows: FuelTransactionRow[];
  totalRows: number;
  totalLitres: number;
  totalAmountDa: number;
}

export async function getFuelPage(params: {
  from: string;
  to: string;
  filters: FuelPageFilters;
  page: number;
}): Promise<{ data: FuelPageData | null; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { data: null, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("fuel_page_transactions", {
    p_from: params.from,
    p_to: params.to,
    p_driver: params.filters.driver,
    p_truck: params.filters.truck,
    p_model: params.filters.model,
    p_page: params.page,
    p_page_size: FUEL_PAGE_SIZE,
  });
  if (error) return { data: null, error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  const first = rows[0] ?? null;

  return {
    data: {
      rows: rows.map((r) => ({
        sheetRow: r.sheet_row != null ? Number(r.sheet_row) : null,
        model: (r.model as string | null) ?? null,
        truckId: (r.truck_id as string | null) ?? null,
        category: r.category as "truck" | "vh_service",
        driverName: (r.driver_name as string | null) ?? null,
        occurredAt: r.occurred_at as string,
        occurredRaw: (r.occurred_raw as string | null) ?? null,
        cardNo: (r.card_no as string | null) ?? null,
        station: (r.station as string | null) ?? null,
        fuelType: (r.fuel_type as string | null) ?? null,
        amountDa: Number(r.amount_da),
        odometerKm: r.odometer_km != null ? Number(r.odometer_km) : null,
        distanceKm: r.distance_km != null ? Number(r.distance_km) : null,
        litresFilled: r.litres_filled != null ? Number(r.litres_filled) : null,
        varianceDa: r.variance_da != null ? Number(r.variance_da) : null,
      })),
      totalRows: Number(first?.total_rows ?? 0),
      totalLitres: Number(first?.total_litres ?? 0),
      totalAmountDa: Number(first?.total_amount_da ?? 0),
    },
  };
}

// The pickers' options, scoped to the month on screen — a driver who
// only filled in August does not belong in a September dropdown.
export interface FuelPageOptions {
  drivers: string[];
  trucks: string[];
  models: string[];
}

export async function getFuelPageOptions(params: {
  from: string;
  to: string;
}): Promise<{ data: FuelPageOptions | null; error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { data: null, error: "Not authenticated" };

  const { data, error } = await supabase.rpc("fuel_page_options", {
    p_from: params.from,
    p_to: params.to,
  });
  if (error) return { data: null, error: error.message };

  const o = (data ?? {}) as Record<string, unknown>;
  return {
    data: {
      drivers: (o.drivers as string[]) ?? [],
      trucks: (o.trucks as string[]) ?? [],
      models: (o.models as string[]) ?? [],
    },
  };
}
