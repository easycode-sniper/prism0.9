"use server";

import { createClient } from "@/lib/supabase/server";
import { loadWialonConfig, fetchWialonDrivers } from "@/lib/fleet/wialon";
import { isJunkDriverName } from "@/lib/drivers/filter";
import { matchDirectory, type DirectoryEntry } from "@/lib/drivers/match";
import { formatPhones, telHref } from "@/lib/drivers/phone";

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
  error?: string;
}

export async function listDrivers(): Promise<DriversResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Not authenticated" };

  const config = await loadWialonConfig(supabase);
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
      address: entry?.address ?? null,
      hiredOn: entry?.hiredOn ?? null,
      inDirectory: Boolean(entry),
      assigned: d.boundUnitId != null,
    };
  });

  drivers.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return { drivers, filteredOut };
}
