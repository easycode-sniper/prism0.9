"use server";

// Session-scoped Wialon entry points — the ones a signed-in user's
// browser calls as server actions. They resolve the stored credentials
// with the caller's own Supabase session and hand off to the client in
// lib/fleet/wialon.ts.
//
// This file stays "use server" so the API token is never bundled into
// client JS. The scheduled tick does not come through here: it has no
// session, so it resolves the config with the service role instead.

import { createClient } from "@/lib/supabase/server";
import { loadWialonConfig, fetchFleetData, findUnit } from "@/lib/fleet/wialon";
import type {
  ResolvedWialonConfig,
  WialonPosition,
  WialonUnit,
  FleetTruck,
  FleetData,
} from "@/lib/fleet/wialon";

export type { ResolvedWialonConfig, WialonPosition, WialonUnit, FleetTruck, FleetData };

export async function getWialonConfig(): Promise<ResolvedWialonConfig | null> {
  return loadWialonConfig(await createClient());
}

export async function getFleetData(): Promise<FleetData> {
  const config = await getWialonConfig();
  if (!config) {
    return {
      trucks: [],
      lastUpdated: null,
      error: "Wialon is not configured — set the API token in Admin → Settings.",
    };
  }
  return fetchFleetData(config);
}

export async function findWialonUnit(
  truckId: string
): Promise<{ id: number; name: string; pos: WialonPosition | null; driverName: string | null } | null> {
  const config = await getWialonConfig();
  if (!config) return null;
  return findUnit(config, truckId);
}
