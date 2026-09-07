"use server";

import { createClient } from "@/lib/supabase/server";
import { findWialonUnit, isWialonConfigured } from "@/lib/wialon/config";
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
//
// checkPositionManual went the same way on 2026-09-07, at the owner's
// request: the run card's "Enter coordinates manually" form was removed,
// and every export of a "use server" file is a callable HTTP endpoint —
// so leaving the action behind an absent button would keep the endpoint
// and lose the only thing that explained it.

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

  // A boolean, not the config: this only ever needed to know whether
  // Wialon is set up, and findWialonUnit resolves the credentials itself.
  if (!(await isWialonConfigured())) return { error: "Wialon not configured" };

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
