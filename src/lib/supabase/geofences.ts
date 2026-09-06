"use server";

import { createClient } from "@/lib/supabase/server";
import { rowsToGeofences } from "@/lib/supabase/geofenceShape";
import type { GeofenceRecord, GeofenceRow } from "@/lib/supabase/geofenceShape";

export type { GeofenceKind, GeofenceRecord } from "@/lib/supabase/geofenceShape";

export async function listGeofences(): Promise<{ data: GeofenceRecord[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_geofences_geojson");
  if (error) return { data: [], error: error.message };

  const records = rowsToGeofences((data ?? []) as GeofenceRow[]);

  return { data: records, error: null };
}
