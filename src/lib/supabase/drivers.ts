"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchWialonDrivers } from "@/lib/fleet/wialon";
import { loadWialonConfig } from "@/lib/fleet/wialon";
import { createServiceClient } from "@/lib/supabase/service";
import { isJunkDriverName } from "@/lib/drivers/filter";
import { matchDirectory, normalizeName, type DirectoryEntry } from "@/lib/drivers/match";
import { formatPhones, telHref } from "@/lib/drivers/phone";

// Who drives comes from Wialon; how to reach them comes from
// driver_directory. Neither side alone is the answer, and the join is by
// name because that is the only field the two share — see lib/drivers/
// match.ts for why that needs four passes rather than an equality test.
//
// Since migration 059 the page shows the UNION, not just the join: a
// directory row that matched no Wialon driver is its own card rather than
// being dropped. That is what makes adding a driver here possible at all
// — before it, an inserted row was invisible. Wialon remains the roster
// everywhere else in the app, so a driver added here has no name on a
// truck marker, in dispatch or in any report.

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
  /** False for a driver that exists only in driver_directory — added on
   *  this page rather than read from the Wialon library. The card says so,
   *  because such a driver is a contact record and nothing more: no truck
   *  marker, dispatch row or report will ever carry the name. */
  inWialon: boolean;
}

export interface DriversResult {
  drivers?: DriverCard[];
  /** How many Wialon entries were placeholders (TEST/PANNE/…), so the
   *  page can say what it removed instead of silently shrinking. */
  filteredOut?: number;
  /** How many cards came from Wialon, so the page can report the two
   *  sources separately instead of implying the whole list is the fleet's. */
  fromWialon?: number;
  /** Whether this session may add and edit. Since migration 059 that is
   *  every signed-in user, so it is simply true here — the field stays
   *  because it is the one place to turn the controls off again, and the
   *  page already refuses to render them without it. */
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

  // Which directory rows got claimed by a Wialon driver. Keyed on
  // fullName, the table's own unique key, rather than on object identity:
  // two Wialon spellings of one man legitimately resolve to the same row,
  // and that row must not then also appear as a card of its own.
  const claimed = new Set<string>();

  const drivers: DriverCard[] = real.map((d) => {
    const match = matchDirectory(d.name, directory);
    const entry = match?.entry;
    if (entry) claimed.add(entry.fullName);
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
      inWialon: true,
    };
  });

  const fromWialon = drivers.length;

  // The rows nobody claimed. Before 059 these were dropped on the floor;
  // they are now cards, which is what an added driver becomes until (and
  // unless) someone creates the same person in Wialon. Note this also
  // surfaces pre-existing orphans — directory rows whose spelling drifted
  // too far from Wialon's for match.ts to pair them — which is a fair
  // thing to see rather than silently hide.
  for (const entry of directory) {
    if (claimed.has(entry.fullName)) continue;
    drivers.push({
      name: entry.fullName.trim(),
      phone: formatPhones(entry.phone),
      phoneHref: telHref(entry.phone),
      phoneRaw: entry.phone,
      address: entry.address,
      hiredOn: entry.hiredOn,
      directoryName: entry.fullName,
      inDirectory: true,
      assigned: false,
      inWialon: false,
    });
  }

  drivers.sort((a, b) => a.name.localeCompare(b.name, "fr"));

  return { drivers, filteredOut, fromWialon, canEdit: true };
}

// Empty means "no value on file", which is a null, not an empty string —
// otherwise the page's has-phone filter counts blanks as reachable.
function clean(v: string): string | null {
  const t = v.trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
}

/** Shared by both writers so one date rule cannot drift from the other. */
function cleanHiredOn(raw: string): { value: string | null } | { error: string } {
  const hired = raw.trim();
  if (hired && !/^\d{4}-\d{2}-\d{2}$/.test(hired)) {
    return { error: "Hired date must look like 2026-08-23" };
  }
  return { value: hired === "" ? null : hired };
}

/**
 * Write a driver's contact details.
 *
 * This never creates a *Wialon* driver — it creates or updates the
 * directory row that hangs off one. `directoryName` is the matched row's
 * own spelling when there is one: the Wialon join is fuzzy, so upserting
 * on Wialon's spelling instead would leave the old row untouched and add
 * a second one for the same person.
 *
 * No role check since migration 059: any signed-in user may edit, and the
 * RLS policy is the enforcement rather than this line. Keeping a guard
 * here that the database no longer agrees with is how the two drift.
 */
export async function saveDriverContact(input: {
  wialonName: string;
  directoryName: string | null;
  phone: string;
  address: string;
  hiredOn: string;
}): Promise<{ error?: string }> {
  const target = (input.directoryName ?? input.wialonName).trim();
  if (!target) return { error: "Missing driver name" };

  const hired = cleanHiredOn(input.hiredOn);
  if ("error" in hired) return { error: hired.error };

  const supabase = await createClient();
  const { error } = await supabase
    .from("driver_directory")
    .upsert(
      {
        full_name: target,
        phone: clean(input.phone),
        address: clean(input.address),
        hired_on: hired.value,
      },
      { onConflict: "full_name" }
    );

  if (error) return { error: error.message };
  return {};
}

/**
 * Add a driver.
 *
 * This writes a driver_directory row and nothing else. It does NOT create
 * the driver in Wialon — the integration is read-only (token/login and
 * core/search_items are the only calls it makes) — so the new person
 * appears on this page and nowhere else in the app until someone adds
 * them in Wialon too. The page says as much on the card and in the form.
 *
 * Deliberately an INSERT, not the upsert saveDriverContact uses: "add"
 * that silently overwrote an existing person's phone number would be the
 * worst possible reading of the button, and the unique index on full_name
 * turns the collision into an error we can name instead.
 */
export async function addDriver(input: {
  fullName: string;
  phone: string;
  address: string;
  hiredOn: string;
}): Promise<{ error?: string; name?: string }> {
  const name = clean(input.fullName);
  if (!name) return { error: "A name is required" };

  // normalizeName strips everything but letters, so a "name" of digits or
  // punctuation would pass the blank test and then match nothing on the
  // page — including itself, since search normalizes too.
  if (!normalizeName(name)) {
    return { error: "A name needs at least one letter" };
  }

  const hired = cleanHiredOn(input.hiredOn);
  if ("error" in hired) return { error: hired.error };

  const supabase = await createClient();
  const { error } = await supabase.from("driver_directory").insert({
    full_name: name,
    phone: clean(input.phone),
    address: clean(input.address),
    hired_on: hired.value,
  });

  // 23505 is unique_violation on driver_directory_full_name_key. The row
  // may belong to a driver already on screen under a different Wialon
  // spelling, so point at the page rather than claiming a duplicate card.
  if (error) {
    if (error.code === "23505") {
      return { error: `"${name}" is already on file — find them in the list and edit instead.` };
    }
    return { error: error.message };
  }
  return { name };
}
