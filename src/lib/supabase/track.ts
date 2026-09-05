"use server";

import { createClient } from "@/lib/supabase/server";
import { TRACK_GAP_SECONDS, TRACK_STOP_SECONDS } from "@/lib/constants";

/**
 * Quick Track — where a truck has actually been.
 *
 * One row per place the truck occupied, newest last, from the
 * truck_track RPC. See migration 049 for why the shape is places rather
 * than fixes, and why offline readings never reach here.
 */
export interface TrackPoint {
  started_at: string;
  ended_at: string;
  lat: number;
  lng: number;
  top_speed: number | null;
  dwell_seconds: number;
}

export interface TrackSegment {
  /** One unbroken run of fixes. A new segment starts wherever the
   *  tracker went quiet long enough that joining the two ends would be
   *  a guess rather than a measurement. */
  line: [number, number][];
}

export interface TrackStop {
  lat: number;
  lng: number;
  seconds: number;
  started_at: string;
}

export interface TruckTrack {
  truckId: string;
  hours: number;
  segments: TrackSegment[];
  stops: TrackStop[];
  /** Every point, for framing the map. */
  bounds: [number, number][];
  pointCount: number;
  topSpeed: number | null;
  firstAt: string | null;
  lastAt: string | null;
}

export async function getTruckTrack(
  truckId: string,
  hours: number
): Promise<{ data: TruckTrack | null; error: string | null }> {
  const supabase = await createClient();

  const to = new Date();
  const from = new Date(to.getTime() - hours * 3600 * 1000);

  const { data, error } = await supabase.rpc("truck_track", {
    p_truck_id: truckId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });

  if (error) return { data: null, error: error.message };

  const points = (data ?? []) as TrackPoint[];
  if (points.length === 0) {
    return {
      data: {
        truckId, hours, segments: [], stops: [], bounds: [],
        pointCount: 0, topSpeed: null, firstAt: null, lastAt: null,
      },
      error: null,
    };
  }

  // Split on tracker gaps rather than drawing through them. 40% of all
  // readings are offline and the RPC drops them, so a unit that went
  // quiet leaves a hole here — and a straight edge across that hole
  // would assert a route across country the truck may never have taken.
  // A break says "not known", which is the truth.
  const segments: TrackSegment[] = [];
  let current: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const gap =
        (new Date(p.started_at).getTime() - new Date(points[i - 1].ended_at).getTime()) / 1000;
      if (gap > TRACK_GAP_SECONDS) {
        if (current.length > 1) segments.push({ line: current });
        current = [];
      }
    }
    current.push([p.lat, p.lng]);
  }
  if (current.length > 1) segments.push({ line: current });

  const stops = points
    .filter((p) => p.dwell_seconds >= TRACK_STOP_SECONDS)
    .map((p) => ({ lat: p.lat, lng: p.lng, seconds: p.dwell_seconds, started_at: p.started_at }));

  const speeds = points.map((p) => p.top_speed).filter((s): s is number => s != null);

  return {
    data: {
      truckId,
      hours,
      segments,
      stops,
      bounds: points.map((p) => [p.lat, p.lng] as [number, number]),
      pointCount: points.length,
      topSpeed: speeds.length ? Math.max(...speeds) : null,
      firstAt: points[0].started_at,
      lastAt: points[points.length - 1].ended_at,
    },
    error: null,
  };
}
