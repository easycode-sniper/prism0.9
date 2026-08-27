"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchWialonDrivers } from "@/lib/fleet/wialon";
import { loadWialonConfig } from "@/lib/fleet/wialon";
import { createServiceClient } from "@/lib/supabase/service";
import { isJunkDriverName } from "@/lib/drivers/filter";
import { matchDirectory, type DirectoryEntry } from "@/lib/drivers/match";
import { formatPhones, telHref } from "@/lib/drivers/phone";
import { isAdmin } from "@/lib/supabase/auth";

// Who exists comes from Wialon; how to reach them comes from
// driver_directory. Neither side alone is the answer, and the join is by
// name because that is the only field the two share — see lib/drivers/
// match.ts for why that needs four passes rather than an equality test.

export interface DriverCard {
  /** Wialon's spelling — the name the rest of the app shows on a truck. */
  name: string;
  phone: string | null;
  phoneHref: string | null;
  address: string | null;
  hiredOn: string | null;
  /** The matched directory row's own spelling of the name, which is not
   *  always Wialon's — the join is fuzzy. An update has to target this,
   *  or a differently-spelled row would be duplicated instead of edited. */
  directoryName: string | null;
  /** Unformatted, for prefilling the edit field with what was typed. */
  phoneRaw: string | null;
  /** False when no directory row matched: the card renders n/a. */
  inDirectory: boolean;
  /** Currently assigned to a truck in Wialon. */
  assigned: boolean;
}

export interface DriversResult {
  drivers?: DriverCard[];
  /** How many Wialon entries were placeholders (TEST/PANNE/…), so the
   *  page can say what it removed instead of silently shrinking. */
  filteredOut?: number;
  /** Editing is admin-only (see migration 024), so the page knows whether
   *  to offer it rather than showing controls that will be refused. */
  canEdit?: boolean;
  error?: string;
}

export async function listDrivers(): Promise<DriversResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  // Service role for the CREDENTIAL only; everything else on this page
  // still goes through the caller's session and its RLS. Reading it with
  // the user's client is what required app_config to grant SELECT on the
  // Wialon token to every authenticated user — this is what lets that
  // grant go away without breaking the Drivers page for operators.
  const config = await loadWialonConfig(createServiceClient());
  if (!config) return { error: "Wialon is not configured" };

  const [wialonDrivers, directoryRows] = await Promise.all([
    fetchWialonDrivers(config).catch((err: Error) => err),
    supabase
      .from("driver_directory")
      .select("full_name, phone, address, hired_on")
      .order("full_name"),
  ]);

  if (wialonDrivers instanceof Error) {
    return { error: `Wialon: ${wialonDrivers.message}` };
  }

  const directory: DirectoryEntry[] = (directoryRows.data ?? []).map((r) => ({
    fullName: r.full_name as string,
    phone: (r.phone as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    hiredOn: (r.hired_on as string | null) ?? null,
  }));

  const real = wialonDrivers.filter((d) => !isJunkDriverName(d.name));
  const filteredOut = wialonDrivers.length - real.length;

  const drivers: DriverCard[] = real.map((d) => {
    const match = matchDirectory(d.name, directory);
    const entry = match?.entry;
    return {
      name: d.name.trim(),
      phone: formatPhones(entry?.phone),
      phoneHref: telHref(entry?.phone),
      phoneRaw: entry?.phone ?? null,
      address: entry?.address ?? null,
      hiredOn: entry?.hiredOn ?? null,
      directoryName: entry?.fullName ?? null,
      inDirectory: Boolean(entry),
      assigned: d.boundUnitId != null,
    };
  });

  drivers.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return { drivers, filteredOut, canEdit: await isAdmin() };
}

/**
 * Write a driver's contact details.
 *
 * Who exists comes from Wialon, so this never creates a driver — it
 * creates or updates the directory row that hangs off one. `directoryName`
 * is the matched row's own spelling when there is one: the Wialon join is
 * fuzzy, so upserting on Wialon's spelling instead would leave the old row
 * untouched and add a second one for the same person.
 */
export async function saveDriverContact(input: {
  wialonName: string;
  directoryName: string | null;
  phone: string;
  address: string;
  hiredOn: string;
}): Promise<{ error?: string }> {
  if (!(await isAdmin())) return { error: "Only admins can edit driver records" };

  const target = (input.directoryName ?? input.wialonName).trim();
  if (!target) return { error: "Missing driver name" };

  // Empty means "no value on file", which is a null, not an empty string —
  // otherwise the page's has-phone filter counts blanks as reachable.
  const clean = (v: string) => {
    const t = v.trim().replace(/\s+/g, " ");
    return t === "" ? null : t;
  };
  const hired = input.hiredOn.trim();
  if (hired && !/^\d{4}-\d{2}-\d{2}$/.test(hired)) {
    return { error: "Hired date must look like 2026-08-23" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("driver_directory")
    .upsert(
      {
        full_name: target,
        phone: clean(input.phone),
        address: clean(input.address),
        hired_on: hired === "" ? null : hired,
      },
      { onConflict: "full_name" }
    );

  if (error) return { error: error.message };
  return {};
}
