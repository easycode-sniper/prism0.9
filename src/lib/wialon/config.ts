"use server";

// Session-scoped Wialon entry points — the ones a signed-in user's
// browser calls as server actions. They resolve the stored credentials
// with the caller's own Supabase session and hand off to the client in
// lib/fleet/wialon.ts.
//
// This file stays "use server" so the API token is never bundled into
// client JS. The scheduled tick does not come through here: it has no
// session, so it resolves the config with the service role instead.

import { createServiceClient } from "@/lib/supabase/service";
import { loadWialonConfig, fetchFleetData, findUnit } from "@/lib/fleet/wialon";
import type {
  ResolvedWialonConfig,
  WialonPosition,
  WialonUnit,
  FleetTruck,
  FleetData,
} from "@/lib/fleet/wialon";

export type { ResolvedWialonConfig, WialonPosition, WialonUnit, FleetTruck, FleetData };

/**
 * Resolve the stored Wialon credentials.
 *
 * NOT EXPORTED, and that is the point: every export of a "use server"
 * file becomes a callable HTTP endpoint, so an exported function
 * returning { relay, server, token } hands the fleet credential to
 * anyone with a session. It used to be exported.
 *
 * Read with the SERVICE role rather than the caller's session. These
 * functions already run on the server and already decide what goes back
 * to the browser — a drivers list, a fleet snapshot, a position check,
 * never the token — so the service role does not widen what a user can
 * do. It is what lets app_config stop granting SELECT on the wialon key
 * to the authenticated role at all, which is the actual fix: an operator
 * querying Supabase directly with their own session can no longer read
 * it either.
 */
async function resolveWialonConfig(): Promise<ResolvedWialonConfig | null> {
  return loadWialonConfig(createServiceClient());
}

/**
 * Whether Wialon has a token stored — a boolean, never the token.
 *
 * Callers only ever needed "is it configured", and handing back the
 * whole config to answer that is what made the credential reachable.
 */
export async function isWialonConfigured(): Promise<boolean> {
  return (await resolveWialonConfig())?.token != null;
}

export async function getFleetData(): Promise<FleetData> {
  const config = await resolveWialonConfig();
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
  const config = await resolveWialonConfig();
  if (!config) return null;
  return findUnit(config, truckId);
}
