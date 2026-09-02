"use client";

// "Déchargés" — trucks that have finished at the client and are free.
//
// The dispatcher's question is "who can I count on next", and until 042
// nothing could answer it. A dispatch completes on ARRIVAL at the site,
// so Active Runs drops a truck the moment it gets there — hours before
// it is actually available. The moment that matters is when it drives
// back OUT, which is what a closed zone_visits row with
// zone_kind='site' records.
//
// WHY IT SITS BESIDE THE TABLE RATHER THAN ABOVE IT: measured at 1366
// before building. The monitoring table wants 949px to render without
// wrapping. Inside the page's old max-w-6xl cap a split left it ~720px,
// which forced a horizontal scroll AND took rows from 54px to 83px —
// a third of the visible fleet lost, on the page whose whole job is
// scanning the fleet. Dropping the cap and pinning this panel at 320px
// gives the table 980px at 1366: rows stay at exactly 54px, unchanged
// from before this panel existed, and it only gets roomier above that.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUnloadedTrucks, type UnloadedTruck } from "@/lib/supabase/unloaded";
import { formatAge } from "@/lib/format";
import {
  UNLOADED_MIN_SECONDS,
  UNLOADED_MAX_AGE_HOURS,
  UNLOADED_SETTLE_SECONDS,
} from "@/lib/constants";

/** Live status per truck, passed down rather than subscribed to here:
 *  the page already holds the fleet from FleetProvider, and a second
 *  subscription would be a second realtime channel for data one
 *  component already has. */
export interface UnloadedPanelProps {
  statusOf: Map<string, "moving" | "idle" | "offline">;
  positionOf: Map<string, { lat: number; lng: number }>;
}

function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function hoursMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}`;
}

export default function UnloadedPanel({ statusOf, positionOf }: UnloadedPanelProps) {
  const [rows, setRows] = useState<UnloadedTruck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getUnloadedTrucks();
    if (result.error) { setError(result.error); return; }
    setError(null);
    setRows(result.data);
  }, []);

  // Polled, not fetched once. The tick writes at most one exit a minute,
  // so 60s is the fastest this can meaningfully change — and a panel
  // that silently froze on the state at page-load would be worse than
  // no panel, because "free" is a claim about right now. (The dashboard
  // fetching only on mount is a known wart; not repeating it here.)
  useEffect(() => {
    let cancelled = false;
    const run = () => { if (!cancelled) void load(); };
    run();
    const id = setInterval(run, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [load]);

  return (
    <aside className="panel p-4" style={{ alignSelf: "start" }}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold t-primary">Déchargés</h2>
        {rows && (
          <span className="font-mono text-xs" style={{ color: "var(--text-dim)" }}>
            {rows.length}
          </span>
        )}
      </div>
      {/* The rule is stated on the panel rather than hidden in the code.
          A dispatcher deciding who to call next needs to know what this
          list counts as "unloaded" — and the 25 minutes is the only
          reason a truck that drove past a site is not in it. */}
      <p className="mt-0.5 text-xs t-dim">
        {Math.round(UNLOADED_MIN_SECONDS / 60)} min or more at the client, then{" "}
        {Math.round(UNLOADED_SETTLE_SECONDS / 60)} min since leaving, and not yet back at the plant
        or the parc.
      </p>

      {error && <p className="mt-3 text-xs c-red">{error}</p>}

      {rows === null && !error && (
        <p className="mt-4 text-xs t-faint">Loading…</p>
      )}

      {rows?.length === 0 && (
        <p className="mt-4 text-xs t-faint">
          No truck has finished unloading in the last {UNLOADED_MAX_AGE_HOURS} hours.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-3" style={{ display: "flex", flexDirection: "column", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((r) => {
            const status = statusOf.get(r.truck_id);
            // The same mapping MonitoringRow uses, deliberately: the two
            // halves of this screen are read together, and a dot that
            // meant something different on each side would be worse than
            // no dot. Free AND moving is a truck already on its way
            // back; free and idle is one sitting somewhere.
            const dot =
              status === "moving" ? "var(--green)"
              : status === "idle" ? "var(--amber)"
              : "var(--text-dim)";
            const pos = positionOf.get(r.truck_id);
            return (
              <li key={r.truck_id} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-mono text-sm c-cyan">
                    <span
                      aria-hidden
                      style={{ width: 6, height: 6, borderRadius: "50%", background: dot, display: "inline-block", flex: "none" }}
                    />
                    {r.truck_id}
                  </span>
                  {pos && (
                    <Link href={`/dispatch?lat=${pos.lat}&lng=${pos.lng}`} className="text-xs c-accent hover:opacity-80">
                      Locate
                    </Link>
                  )}
                </div>
                <div className="mt-0.5 text-xs t-primary">{r.driver_name || "—"}</div>
                <div className="text-xs t-dim" title={r.zone_name}>{r.zone_name}</div>
                <div className="mt-0.5 font-mono text-xs" style={{ color: "var(--text-dim)" }}>
                  {/* Free since, not left-at: the settle timer means
                      those are 25 minutes apart, and the one that
                      matters is when the truck became available. Paired
                      with time on site because "free 20 minutes" and
                      "was there four hours" answer different halves of
                      "can I use this truck". */}
                  free {formatAge(minutesSince(r.free_at))} · {hoursMinutes(r.seconds_on_site)} on site
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
