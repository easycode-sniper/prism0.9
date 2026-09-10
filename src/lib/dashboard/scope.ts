// What the dashboard is currently about.
//
// A PLAIN MODULE, not "use server" — the same reason OpsRange lives in
// range.ts rather than in supabase/dashboard.ts. A "use server" file may
// only export async functions; exporting a type or a constant from one
// compiles fine and then breaks the render at runtime, which is a lesson
// this codebase has already paid for once.

/** The whole fleet, one driver, or one truck. */
export type Scope =
  | { kind: "fleet" }
  | { kind: "driver"; name: string }
  | { kind: "truck"; id: string };

export const FLEET: Scope = { kind: "fleet" };

/** What the RPCs take. Both null means fleet-wide, which is what every
 *  one of them did before migration 060 — so an unscoped call is byte
 *  for byte the call the dashboard has always made. */
export interface ScopeArgs {
  driver: string | null;
  truck: string | null;
}

export function scopeArgs(scope: Scope): ScopeArgs {
  return {
    driver: scope.kind === "driver" ? scope.name : null,
    truck: scope.kind === "truck" ? scope.id : null,
  };
}

/** A type guard, not a boolean: callers narrow on this before reaching
 *  for scope.name or scope.id, and a plain boolean leaves them casting. */
export function isFleet(scope: Scope): scope is { kind: "fleet" } {
  return scope.kind === "fleet";
}

/** The name to print. Not a label with a prefix — the page says "driver"
 *  or "truck" in its own copy, and repeating it inside the value reads
 *  as stuttering once both are on screen. */
export function scopeLabel(scope: Scope): string | null {
  return scope.kind === "fleet" ? null : scope.kind === "driver" ? scope.name : scope.id;
}

/**
 * A driver's name reduced for comparison, mirroring migration 060's
 * public.norm_driver_name(): accents stripped, upper-cased, everything
 * that is not a letter dropped, then TOKENS SORTED so "AMIR SMARA" and
 * "SMARA Amir" agree.
 *
 * TWO IMPLEMENTATIONS OF ONE RULE, which is a thing worth justifying.
 * The SQL one has to exist because the filtering happens in Postgres;
 * this one has to exist because the variance tables are filtered on the
 * client, from a list the page already holds, rather than by a sixth
 * round trip. scripts/check-dashboard-scope.sh asserts the two agree on
 * a shared list of names, so a change to one that is not made to the
 * other fails a check rather than quietly splitting a driver in half.
 *
 * Deliberately NOT the four-pass matchDirectory in lib/drivers/match.ts:
 * its fuzzy passes exist to put a phone number on a card, where a wrong
 * guess is a wrong address. Here a wrong guess attributes one man's fuel
 * to another.
 */
export function normalizeDriverKey(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    // Combining marks, which is what NFD just split the accents into.
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Whether a name refers to the scope's driver. False for any non-driver
 *  scope, so callers can use it without checking the kind first. */
export function matchesDriver(scope: Scope, name: string | null | undefined): boolean {
  if (scope.kind !== "driver") return false;
  const key = normalizeDriverKey(scope.name);
  return key !== "" && normalizeDriverKey(name) === key;
}

// ── URL round trip ────────────────────────────────────────────────────
//
// The scope lives in the query string so a focused dashboard can be sent
// to someone — the same reasoning behind dispatch's ?truck= param, and
// the reason Locate could be linked to from three other pages.

export function scopeFromParams(params: URLSearchParams): Scope {
  const driver = params.get("driver");
  if (driver && driver.trim()) return { kind: "driver", name: driver.trim() };
  const truck = params.get("truck");
  if (truck && truck.trim()) return { kind: "truck", id: truck.trim() };
  return FLEET;
}

/** The query string for a scope, "" for the fleet. Only ever one key:
 *  a URL carrying both would be ambiguous, and scopeFromParams above
 *  silently preferring driver would make the truck vanish with no
 *  explanation. */
export function scopeToQuery(scope: Scope): string {
  if (scope.kind === "fleet") return "";
  const key = scope.kind === "driver" ? "driver" : "truck";
  return `?${key}=${encodeURIComponent(scopeLabel(scope) ?? "")}`;
}

// ── The picker's roster ───────────────────────────────────────────────

export interface ScopeOption {
  kind: "driver" | "truck";
  /** What gets sent to the RPC as p_driver / p_truck. */
  id: string;
  label: string;
  /** Fuel-sheet rows behind this option. */
  fills: number;
  /** Tracker zone visits behind it. */
  visits: number;
}

export function optionToScope(o: ScopeOption): Scope {
  return o.kind === "driver" ? { kind: "driver", name: o.id } : { kind: "truck", id: o.id };
}

/** A driver the fuel sheet and the tracker do not agree about shows up
 *  with one side at zero. Worth surfacing in the picker rather than
 *  leaving someone to wonder why half a dashboard is empty: it means the
 *  two sources spell this person differently, which is a correction for
 *  the sheet and not something SQL should guess at. See migration 060. */
export function isSplitSource(o: ScopeOption): boolean {
  return o.kind === "driver" && (o.fills === 0 || o.visits === 0);
}
