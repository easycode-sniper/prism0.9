// Wialon client, parameterised on a Supabase client for reading the
// stored credentials.
//
// The config lives in app_config, whose RLS policy grants SELECT to the
// authenticated role. The session-scoped path (a signed-in user pressing
// "Check") satisfies that; the scheduled tick has no session at all and
// must read it with the service role. Resolving the config outside these
// functions is what lets one Wialon client serve both — reading it with
// a cookie-bound client inside them is exactly what made the tick report
// "Wialon is not configured" on a project where it plainly was.
//
// Not a "use server" module: every export of one becomes a public HTTP
// endpoint, and these take a Supabase client and a resolved config
// carrying the API token.

import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_RELAY = "https://wialon-relay1.ferdjellahsouhaibomd.workers.dev";
const DEFAULT_SERVER = "hst-api.wialon.eu";

export interface ResolvedWialonConfig {
  relay: string;
  server: string;
  token: string;
}

export async function loadWialonConfig(
  supabase: SupabaseClient
): Promise<ResolvedWialonConfig | null> {
  const { data } = await supabase
    .from("app_config")
    .select("config_value")
    .eq("config_key", "wialon")
    .single();

  const cfg = data?.config_value as { relay?: string; server?: string; token?: string } | undefined;
  if (!cfg?.token) return null;

  return {
    relay: cfg.relay || DEFAULT_RELAY,
    server: cfg.server || DEFAULT_SERVER,
    token: cfg.token,
  };
}

export interface WialonPosition {
  lat: number;
  lng: number;
  speed: number;
  course: number;
  timestamp: number;
}

export interface WialonUnit {
  id: number;
  name: string;
  pos: WialonPosition | null;
}

export type VehicleCategory = "truck" | "staff";

export interface FleetTruck {
  truck_id: string;
  // Absent on snapshots written before categories existed; treat as
  // "truck" when missing so old rows keep rendering.
  category?: VehicleCategory;
  lat: number | null;
  lng: number | null;
  speed: number;
  course: number;
  age_minutes: number | null;
  status: "moving" | "idle" | "offline";
  driverName: string | null;
}

export interface FleetData {
  trucks: FleetTruck[];
  lastUpdated: Date | null;
  error: string | null;
}

// Call Wialon via the relay
async function wialonCall(config: ResolvedWialonConfig, svc: string, params: object, sid?: string): Promise<any> {
  let url = `${config.relay}/?server=${encodeURIComponent(config.server)}&svc=${encodeURIComponent(svc)}&params=${encodeURIComponent(JSON.stringify(params))}`;
  if (sid) url += `&sid=${encodeURIComponent(sid)}`;

  const resp = await fetch(url);
  return resp.json();
}

// Login and get session ID
async function wialonLogin(config: ResolvedWialonConfig): Promise<string> {
  const data = await wialonCall(config, "token/login", { token: config.token });
  if (data.error) throw new Error(`Wialon login failed: ${data.error}`);
  return data.eid;
}

// Get all fleet units
async function fetchAllUnits(config: ResolvedWialonConfig, sid: string): Promise<WialonUnit[]> {
  const data = await wialonCall(
    config,
    "core/search_items",
    {
      spec: {
        itemsType: "avl_unit",
        propName: "sys_name",
        propValueMask: "*",
        sortType: "sys_name",
      },
      force: 1,
      flags: 1439,
      from: 0,
      to: 0,
    },
    sid
  );

  if (data.error) throw new Error(`Wialon search failed: ${data.error}`);

  return (data.items || []).map((item: any) => ({
    id: item.id,
    name: item.nm,
    pos: item.pos
      ? {
          lat: item.pos.y,
          lng: item.pos.x,
          speed: item.pos.s || 0,
          course: item.pos.c || 0,
          timestamp: item.pos.t,
        }
      : null,
  }));
}

// Match our truck IDs against Wialon units
function matchTrucksToUnits(
  allTruckIds: string[],
  units: WialonUnit[]
): Map<string, WialonUnit> {
  const results = new Map<string, WialonUnit>();

  for (const truckId of allTruckIds) {
    const candidates = [
      truckId,
      truckId.replace(/^0+/, ""),
      truckId.split("-")[0],
    ];

    for (const candidate of candidates) {
      const match = units.find(
        (u) => u.name && u.name.toLowerCase().includes(candidate.toLowerCase())
      );
      if (match) {
        results.set(truckId, match);
        break;
      }
    }
  }

  return results;
}

// Classify truck status based on speed and age
function classifyStatus(unit: WialonUnit | undefined): "moving" | "idle" | "offline" {
  if (!unit || !unit.pos) return "offline";

  const ageMinutes = (Date.now() / 1000 - unit.pos.timestamp) / 60;
  if (ageMinutes >= 30) return "offline";
  if (unit.pos.speed > 5) return "moving";
  return "idle";
}


// ── Driver resolution ──
// Wialon stores drivers under a "resource" (account-level), each with an
// optional "bound unit" (bu) — the truck they're currently assigned to.
// We match on that binding first, falling back to a driver code found on
// the unit's own last-message data if present.

interface WialonDriverMaps {
  driverByUnitId: Record<number, string>;
  driverByCode: Record<string, string>;
}

/** One driver as Wialon stores it. `boundUnitId` is the truck they're
 *  currently assigned to, absent for most of the library. */
export interface WialonDriver {
  id: number;
  name: string;
  code: string | null;
  boundUnitId: number | null;
}

/** Every driver in the account's resources, flattened. This is the raw
 *  library — placeholders and long-departed staff included — because
 *  deciding who is real is the caller's job, not this function's. */
async function fetchWialonDriverList(config: ResolvedWialonConfig, sid: string): Promise<WialonDriver[]> {
  const data = await wialonCall(
    config,
    "core/search_items",
    {
      spec: { itemsType: "avl_resource", propName: "sys_name", propValueMask: "*", sortType: "sys_name" },
      force: 1,
      flags: 0x0001ffff,
      from: 0,
      to: 0,
    },
    sid
  );
  if (data.error) throw new Error(`Wialon resource search failed (code ${data.error})`);

  const drivers: WialonDriver[] = [];
  for (const resource of data.items || []) {
    for (const drv of Object.values(resource.drvrs || {}) as any[]) {
      if (!drv?.n) continue;
      drivers.push({
        id: drv.id,
        name: String(drv.n),
        code: drv.c ? String(drv.c) : null,
        boundUnitId: drv.bu || null,
      });
    }
  }
  return drivers;
}

// The two lookup maps the fleet path needs, derived from that same list
// rather than a second call to Wialon.
function buildDriverMaps(drivers: WialonDriver[]): WialonDriverMaps {
  const driverByUnitId: Record<number, string> = {};
  const driverByCode: Record<string, string> = {};
  for (const drv of drivers) {
    if (drv.boundUnitId) driverByUnitId[drv.boundUnitId] = drv.name;
    if (drv.code) driverByCode[drv.code] = drv.name;
  }
  return { driverByUnitId, driverByCode };
}

async function fetchWialonDriverMaps(config: ResolvedWialonConfig, sid: string): Promise<WialonDriverMaps> {
  return buildDriverMaps(await fetchWialonDriverList(config, sid));
}

/** Public entry point for the Drivers page: log in, return the whole
 *  driver library. Deduplicated by name, because a driver defined on two
 *  resources is one person and would otherwise render as two cards. */
export async function fetchWialonDrivers(config: ResolvedWialonConfig): Promise<WialonDriver[]> {
  const sid = await wialonLogin(config);
  const drivers = await fetchWialonDriverList(config, sid);

  const seen = new Set<string>();
  const unique: WialonDriver[] = [];
  for (const drv of drivers) {
    const key = drv.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(drv);
  }
  return unique;
}

function resolveDriverName(unit: WialonUnit, maps: WialonDriverMaps): string | null {
  if (maps.driverByUnitId[unit.id]) return maps.driverByUnitId[unit.id];
  const code = (unit as any).lmsg?.p?.drv || (unit as any).pos?.p?.drv || (unit as any).drv;
  if (code && maps.driverByCode[code]) return maps.driverByCode[code];
  return null; // graceful — caller falls back to showing just the truck ID
}

export async function findUnit(config: ResolvedWialonConfig, truckId: string): Promise<{ id: number; name: string; pos: WialonPosition | null; driverName: string | null } | null> {
  const sid = await wialonLogin(config);
  const [units, driverMaps] = await Promise.all([
    fetchAllUnits(config, sid),
    fetchWialonDriverMaps(config, sid).catch((err) => {
      console.warn("Driver library fetch failed — proceeding without driver name:", err.message);
      return { driverByUnitId: {}, driverByCode: {} };
    }),
  ]);
  const matched = matchTrucksToUnits([truckId], units);
  const unit = matched.get(truckId);
  if (!unit) return null;

  return {
    id: unit.id,
    name: unit.name,
    pos: unit.pos,
    driverName: resolveDriverName(unit, driverMaps),
  };
}

// Main export: get fleet data. The whole Wialon account is this
// company's fleet (confirmed — unlike the Wialon geofence/zone export,
// which does mix in stale entries from other companies), so every unit
// Wialon returns is a truck; there's no separate "which trucks are
// ours" registry to match against anymore. A unit's own name is the
// truck ID everywhere in the app now.
export async function fetchFleetData(config: ResolvedWialonConfig): Promise<FleetData> {
  try {
    // One login shared by both calls (previously each did its own),
    // and the two independent lookups run in parallel rather than
    // sequentially — cuts what was 4 round-trips to the Wialon relay
    // down to 2 concurrent ones.
    const sid = await wialonLogin(config);
    const [units, driverMaps] = await Promise.all([
      fetchAllUnits(config, sid),
      // Resolved once for the whole fleet, not per-truck — the same
      // pattern findWialonUnit uses for a single truck, just applied
      // in bulk so labeling every marker with a driver name doesn't
      // mean one driver-map fetch per truck.
      fetchWialonDriverMaps(config, sid).catch((err) => {
        console.warn("Driver library fetch failed — proceeding without driver names:", err.message);
        return { driverByUnitId: {}, driverByCode: {} };
      }),
    ]);

    const now = Date.now() / 1000;
    const trucks: FleetTruck[] = units.map((unit) => {
      if (!unit.pos) {
        return {
          truck_id: unit.name,
          lat: null,
          lng: null,
          speed: 0,
          course: 0,
          age_minutes: null,
          status: "offline",
          driverName: resolveDriverName(unit, driverMaps),
        };
      }

      return {
        truck_id: unit.name,
        lat: unit.pos.lat,
        lng: unit.pos.lng,
        speed: unit.pos.speed,
        course: unit.pos.course,
        age_minutes: Math.round((now - unit.pos.timestamp) / 60),
        status: classifyStatus(unit),
        driverName: resolveDriverName(unit, driverMaps),
      };
    });

    return {
      trucks,
      lastUpdated: new Date(),
      error: null,
    };
  } catch (err: any) {
    return {
      trucks: [],
      lastUpdated: null,
      error: err.message,
    };
  }
}
