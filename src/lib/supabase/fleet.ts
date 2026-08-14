"use server";

import { getAllFleetPositions, getWialonConfig, WialonUnit } from "@/lib/wialon";

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

export async function getFleetLiveData(): Promise<{
  trucks: FleetTruck[];
  error: string | null;
}> {
  const config = await getWialonConfig();
  if (!config || !config.token) {
    return { trucks: [], error: "Wialon not configured. Set token in Admin." };
  }

  // Get fleet trucks from DB
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const { data: truckRows, error: truckError } = await supabase
    .from("fleet_trucks")
    .select("truck_id")
    .eq("status", "active");

  if (truckError || !truckRows) {
    return { trucks: [], error: "Failed to load trucks" };
  }

  const truckIds = truckRows.map((t) => t.truck_id);

  try {
    const positions = await getAllFleetPositions(config, truckIds);

    const now = Date.now() / 1000;
    const trucks: FleetTruck[] = truckIds.map((truckId) => {
      const unit = positions.get(truckId);

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
      let status: "moving" | "idle" | "offline" = "offline";

      if (ageMinutes < 30) {
        if (unit.pos.speed > 5) {
          status = "moving";
        } else {
          status = "idle";
        }
      }

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

    return { trucks, error: null };
  } catch (err: any) {
    return { trucks: [], error: err.message };
  }
}
