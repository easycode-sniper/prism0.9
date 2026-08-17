"use server";

import { createClient } from "@/lib/supabase/server";
import { findWialonUnit, getWialonConfig } from "@/lib/wialon/config";
import { listGeofences } from "@/lib/supabase/geofences";
import { loadDispatchAndSite, runPositionCheck } from "@/lib/fleet/positionCheck";
import type { PositionCheckResult } from "@/lib/fleet/positionCheck";

// The check logic itself moved to lib/fleet/positionCheck.ts so the
// scheduled tick can run it with a service-role client. What stays here
// are the session-scoped server actions the UI calls: the manual "Check"
// button and the coordinate-paste fallback.
//
// checkPositionAuto used to live here too — the per-dispatch sweep the
// browser ran every 60s. The scheduled tick owns that now, which also
// retires an exported server action that had no auth check on it at all.

export type { PositionCheckResult };

export async function checkPositionForDispatch(
  truckId: string,
  dispatchId: string
): Promise<{ result?: PositionCheckResult; error?: string }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  const loaded = await loadDispatchAndSite(supabase, dispatchId);
  if ("error" in loaded) return { error: loaded.error };
  const { dispatch, site } = loaded;

  const config = await getWialonConfig();
  if (!config?.token) return { error: "Wialon not configured" };

  const unit = await findWialonUnit(truckId);
  if (!unit) return { error: `Truck ${truckId} not found in Wialon` };
  if (!unit.pos) return { error: `No position data for ${truckId}` };

  const { data: geofences } = await listGeofences();
  const result = await runPositionCheck(
    supabase,
    dispatch,
    site,
    [unit.pos.lat, unit.pos.lng],
    unit.pos.speed,
    unit.driverName,
    geofences
  );

  return { result };
}

// Fallback for when the live Wialon fetch fails — lets the dispatcher paste
// a coordinate pair (from a phone call with the driver, another tracking
// tool, etc.) and still get a real on-route/off-route + ETA check.
export async function checkPositionManual(
  dispatchId: string,
  lat: number,
  lng: number
): Promise<{ result?: PositionCheckResult; error?: string }> {
  const supabase = await createClient();
  const user = await supabase.auth.getUser();
  if (!user.data.user) return { error: "Not authenticated" };

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: "Enter valid numeric coordinates" };
  }

  const loaded = await loadDispatchAndSite(supabase, dispatchId);
  if ("error" in loaded) return { error: loaded.error };
  const { dispatch, site } = loaded;

  // No live speed available from a manual paste — speeding simply won't
  // fire for this check, which is correct: this is a live-fetch-failed
  // fallback, not a speed source.
  const { data: geofences } = await listGeofences();
  const result = await runPositionCheck(supabase, dispatch, site, [lat, lng], 0, null, geofences);

  return { result };
}
