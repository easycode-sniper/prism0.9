"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Service baselines — the starting point each truck's service interval
 * counts from. See migration 050 for why this is one row per truck and
 * not a service history.
 *
 * Both dates are optional and independent: a dispatcher may learn when a
 * truck was last serviced weeks before anyone remembers when its tyres
 * went on, and the point of capturing these opportunistically is that
 * half an answer can be saved.
 */
export interface ServiceBaseline {
  truckId: string;
  oilChangedOn: string | null;
  oilChangedKm: number | null;
  tyresFittedOn: string | null;
  tyresFittedKm: number | null;
  updatedAt: string;
}

interface Row {
  truck_id: string;
  oil_changed_on: string | null;
  oil_changed_km: number | string | null;
  tyres_fitted_on: string | null;
  tyres_fitted_km: number | string | null;
  updated_at: string;
}

const toBaseline = (r: Row): ServiceBaseline => ({
  truckId: r.truck_id,
  oilChangedOn: r.oil_changed_on,
  oilChangedKm: r.oil_changed_km != null ? Number(r.oil_changed_km) : null,
  tyresFittedOn: r.tyres_fitted_on,
  tyresFittedKm: r.tyres_fitted_km != null ? Number(r.tyres_fitted_km) : null,
  updatedAt: r.updated_at,
});

export async function listServiceBaselines(): Promise<{
  data: ServiceBaseline[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("truck_service_baselines")
    .select("truck_id, oil_changed_on, oil_changed_km, tyres_fitted_on, tyres_fitted_km, updated_at");

  if (error) return { data: [], error: error.message };
  return { data: ((data ?? []) as Row[]).map(toBaseline), error: null };
}

export interface ServiceBaselineInput {
  oilChangedOn: string | null;
  oilChangedKm: number | null;
  tyresFittedOn: string | null;
  tyresFittedKm: number | null;
}

export async function saveServiceBaseline(
  truckId: string,
  input: ServiceBaselineInput
): Promise<{ data: ServiceBaseline | null; error: string | null }> {
  const supabase = await createClient();

  // Stamping the author here rather than in a database default: the
  // trigger keeps updated_at honest, but auth.uid() inside a DEFAULT
  // would be evaluated for service-role writes too, and this column is
  // only meaningful for a person sitting in front of the app.
  const { data: userData } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("truck_service_baselines")
    .upsert(
      {
        truck_id: truckId,
        oil_changed_on: input.oilChangedOn,
        oil_changed_km: input.oilChangedKm,
        tyres_fitted_on: input.tyresFittedOn,
        tyres_fitted_km: input.tyresFittedKm,
        updated_by: userData.user?.id ?? null,
        // An UPSERT that resolves to INSERT never fires the BEFORE UPDATE
        // trigger, so the timestamp is set here as well to keep both
        // paths agreeing.
        updated_at: new Date().toISOString(),
      },
      { onConflict: "truck_id" }
    )
    .select("truck_id, oil_changed_on, oil_changed_km, tyres_fitted_on, tyres_fitted_km, updated_at")
    .single();

  if (error) return { data: null, error: error.message };
  return { data: toBaseline(data as Row), error: null };
}
