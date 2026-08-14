"use server";

// Wialon configuration is loaded from app_config (Supabase), not hardcoded.
// This file is "use server" specifically so it's never bundled into client
// JS — the token must not ship to the browser. Client components (e.g.
// FleetProvider) call these as server actions instead of importing the
// config directly.

import { createClient } from "@/lib/supabase/server";

const DEFAULT_RELAY = "https://wialon-relay1.ferdjellahsouhaibomd.workers.dev";
const DEFAULT_SERVER = "hst-api.wialon.eu";

interface ResolvedWialonConfig {
  relay: string;
  server: string;
  token: string;
}

export async function getWialonConfig(): Promise<ResolvedWialonConfig | null> {
  const supabase = await createClient();
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

export interface FleetTruck {
  truck_id: string;
  matched: boolean;
  lat: number | null;
  lng: number | null;
  speed: number;
  course: number;
  age_minutes: number | null;
  status: "moving" | "idle" | "offline";
  unit_name: string | null;
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
async function fetchAllUnits(config: ResolvedWialonConfig): Promise<WialonUnit[]> {
  const sid = await wialonLogin(config);

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

// Find a single unit by truck ID
export async function findWialonUnit(truckId: string): Promise<{ id: number; name: string; pos: WialonPosition | null; driverName: string | null } | null> {
  const config = await getWialonConfig();
  if (!config) return null;

  const units = await fetchAllUnits(config);
  const matched = matchTrucksToUnits([truckId], units);
  const unit = matched.get(truckId);
  if (!unit) return null;

  const driverMaps = await fetchWialonDriverMaps(config).catch((err) => {
    console.warn("Driver library fetch failed — proceeding without driver name:", err.message);
    return { driverByUnitId: {}, driverByCode: {} };
  });

  return {
    id: unit.id,
    name: unit.name,
    pos: unit.pos,
    driverName: resolveDriverName(unit, driverMaps),
  };
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

async function fetchWialonDriverMaps(config: ResolvedWialonConfig): Promise<WialonDriverMaps> {
  const sid = await wialonLogin(config);

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

  const driverByUnitId: Record<number, string> = {};
  const driverByCode: Record<string, string> = {};

  for (const resource of data.items || []) {
    const drvrs = resource.drvrs || {};
    for (const drv of Object.values(drvrs) as any[]) {
      if (drv.bu) driverByUnitId[drv.bu] = drv.n;
      if (drv.c) driverByCode[drv.c] = drv.n;
    }
  }

  return { driverByUnitId, driverByCode };
}

function resolveDriverName(unit: WialonUnit, maps: WialonDriverMaps): string | null {
  if (maps.driverByUnitId[unit.id]) return maps.driverByUnitId[unit.id];
  const code = (unit as any).lmsg?.p?.drv || (unit as any).pos?.p?.drv || (unit as any).drv;
  if (code && maps.driverByCode[code]) return maps.driverByCode[code];
  return null; // graceful — caller falls back to showing just the truck ID
}

// Main export: get fleet data
export async function getFleetData(allTruckIds: string[]): Promise<FleetData> {
  const config = await getWialonConfig();
  if (!config) {
    return {
      trucks: allTruckIds.map((truck_id) => ({
        truck_id,
        matched: false,
        lat: null,
        lng: null,
        speed: 0,
        course: 0,
        age_minutes: null,
        status: "offline",
        unit_name: null,
      })),
      lastUpdated: null,
      error: "Wialon is not configured — set the API token in Admin → Settings.",
    };
  }

  try {
    const units = await fetchAllUnits(config);
    const matched = matchTrucksToUnits(allTruckIds, units);

    const now = Date.now() / 1000;
    const trucks: FleetTruck[] = allTruckIds.map((truckId) => {
      const unit = matched.get(truckId);

      if (!unit || !unit.pos) {
        return {
          truck_id: truckId,
          matched: !!unit,
          lat: null,
          lng: null,
          speed: 0,
          course: 0,
          age_minutes: null,
          status: "offline",
          unit_name: unit?.name || null,
        };
      }

      const ageMinutes = Math.round((now - unit.pos.timestamp) / 60);
      const status = classifyStatus(unit);

      return {
        truck_id: truckId,
        matched: true,
        lat: unit.pos.lat,
        lng: unit.pos.lng,
        speed: unit.pos.speed,
        course: unit.pos.course,
        age_minutes: ageMinutes,
        status,
        unit_name: unit.name,
      };
    });

    return {
      trucks,
      lastUpdated: new Date(),
      error: null,
    };
  } catch (err: any) {
    return {
      trucks: allTruckIds.map((truck_id) => ({
        truck_id,
        matched: false,
        lat: null,
        lng: null,
        speed: 0,
        course: 0,
        age_minutes: null,
        status: "offline",
        unit_name: null,
      })),
      lastUpdated: null,
      error: err.message,
    };
  }
}
