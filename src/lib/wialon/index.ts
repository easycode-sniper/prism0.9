"use server";

export interface WialonConfig {
  relay: string;
  server: string;
  token: string;
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

// Get Wialon config from app_config (stored as JSONB)
export async function getWialonConfig(): Promise<WialonConfig | null> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("app_config")
    .select("config_value")
    .eq("config_key", "wialon")
    .single();

  if (error || !data) return null;

  const config = data.config_value as WialonConfig;
  return config;
}

// Call Wialon via the relay
async function wialonCall(
  config: WialonConfig,
  svc: string,
  params: object,
  sid?: string
): Promise<any> {
  let url = `${config.relay}/?server=${encodeURIComponent(config.server)}&svc=${encodeURIComponent(svc)}&params=${encodeURIComponent(JSON.stringify(params))}`;
  if (sid) url += `&sid=${encodeURIComponent(sid)}`;

  const resp = await fetch(url);
  return resp.json();
}

// Login and get session ID
export async function wialonLogin(config: WialonConfig): Promise<string> {
  const data = await wialonCall(config, "token/login", { token: config.token });
  if (data.error) throw new Error(`Wialon login failed: ${data.error}`);
  return data.eid;
}

// Search for a unit by truck ID (trying multiple name patterns)
export async function findWialonUnit(
  config: WialonConfig,
  truckId: string
): Promise<WialonUnit | null> {
  const sid = await wialonLogin(config);
  const candidates = [truckId, truckId.replace(/^0+/, ""), truckId.split("-")[0]];

  for (const candidate of candidates) {
    const data = await wialonCall(
      config,
      "core/search_items",
      {
        spec: {
          itemsType: "avl_unit",
          propName: "sys_name",
          propValueMask: `*${candidate}*`,
          sortType: "sys_name",
        },
        force: 1,
        flags: 1439,
        from: 0,
        to: 0,
      },
      sid
    );

    if (data.items && data.items.length > 0) {
      const unit = data.items[0];
      return {
        id: unit.id,
        name: unit.nm,
        pos: unit.pos
          ? {
              lat: unit.pos.y,
              lng: unit.pos.x,
              speed: unit.pos.s || 0,
              course: unit.pos.c || 0,
              timestamp: unit.pos.t,
            }
          : null,
      };
    }
  }

  return null;
}

// Get all fleet positions
export async function getAllFleetPositions(
  config: WialonConfig,
  truckIds: string[]
): Promise<Map<string, WialonUnit>> {
  const sid = await wialonLogin(config);
  const results = new Map<string, WialonUnit>();

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

  if (!data.items) return results;

  const units: WialonUnit[] = data.items.map((item: any) => ({
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

  // Match truck IDs to units using the 3-pattern matching from original app
  for (const truckId of truckIds) {
    const candidates = [truckId, truckId.replace(/^0+/, ""), truckId.split("-")[0]];
    for (const candidate of candidates) {
      const match = units.find(
        (u) => u.name && u.name.includes(candidate)
      );
      if (match) {
        results.set(truckId, match);
        break;
      }
    }
  }

  return results;
}
