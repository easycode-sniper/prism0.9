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
import { createServiceClient } from "@/lib/supabase/service";
import { loadWialonConfig, findUnit } from "@/lib/fleet/wialon";
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
 * Is anybody home?
 *
 * Both exports below resolve the credential with the SERVICE role, which
 * bypasses RLS — so unlike every other read in the app, RLS is not what
 * stands between an anonymous caller and the answer. Today the
 * middleware is: its matcher covers every path except /api, and a server
 * action POSTs to a page route, so an unauthenticated request is
 * redirected to /login before the action runs.
 *
 * That is one gate, in a file whose own header explains that an export
 * here is a public HTTP endpoint, and it lives in a different file from
 * the thing it protects. One edit to that matcher's exclusion list — the
 * kind of edit someone makes to fix an unrelated route — and these two
 * become reachable. Every other server action in this codebase checks
 * for itself; found in the 2026-09-14 pre-ship audit, these two were the
 * only ones that did not.
 */
async function hasSession(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user != null;
}

/**
 * Whether Wialon has a token stored — a boolean, never the token.
 *
 * Callers only ever needed "is it configured", and handing back the
 * whole config to answer that is what made the credential reachable.
 */
export async function isWialonConfigured(): Promise<boolean> {
  if (!(await hasSession())) return false;
  return (await resolveWialonConfig())?.token != null;
}

/**
 * One truck's live position and the driver on it.
 *
 * Returns null without a session rather than throwing: the sole caller,
 * checkPositionForDispatch, already reads null as "no fix available" and
 * reports that to the operator, so an unauthenticated caller gets the
 * same nothing as a truck the fleet feed cannot see.
 */
export async function findWialonUnit(
  truckId: string
): Promise<{ id: number; name: string; pos: WialonPosition | null; driverName: string | null } | null> {
  if (!(await hasSession())) return null;
  const config = await resolveWialonConfig();
  if (!config) return null;
  return findUnit(config, truckId);
}
