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
// WHY IT SITS BESIDE THE TABLE RATHER THAN ABOVE IT and why the two
// panels are the SAME SIZE: the monitoring table used to need 949px
// unwrapped; with the side panel at 320px it got 980px at 1366 and rows
// stayed at 54px. Now both panels share 1fr/1fr at 704px tall (≈20 rows +
// header, inner scroll), same border/radius and same header treatment, so
// neither reads as secondary. The table here mirrors the left table's
// column treatment (fixed layout, 118/130/—/92/96/68) with its own six
// columns: Truck / Driver / Last client / Time on site / Free since /
// Locate.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUnloadedTrucks, type UnloadedTruck } from "@/lib/supabase/unloaded";
import { formatAge } from "@/lib/format";
import { useTranslation } from "@/lib/i18n/I18nProvider";
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
  const { t } = useTranslation();
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
    <aside className="panel flex flex-col overflow-hidden" style={{ height: 704, minHeight: 0 }}>
      <div className="flex-none p-4 pb-3">
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
          {t(
            "{min} min or more at the client, then {settle} min since leaving, and not yet back at the plant or the parc.",
            {
              min: Math.round(UNLOADED_MIN_SECONDS / 60),
              settle: Math.round(UNLOADED_SETTLE_SECONDS / 60),
            },
          )}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto border-t bd" style={{ overscrollBehavior: "contain" }}>
      {error && <p className="p-4 text-xs c-red">{t(error)}</p>}

      {rows === null && !error && (
        <p className="p-4 text-xs t-faint">{t("Loading…")}</p>
      )}

      {rows?.length === 0 && (
        <p className="p-4 text-xs t-faint">
          {t("No truck has finished unloading in the last {hours} hours.", { hours: UNLOADED_MAX_AGE_HOURS })}
        </p>
      )}

      {rows && rows.length > 0 && (
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 118 }} />
            <col style={{ width: 130 }} />
            <col />
            <col style={{ width: 92 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 68 }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b bd bg-panel text-left text-xs uppercase t-dim">
              <th className="px-3 py-2">{t("Truck")}</th>
              <th className="px-3 py-2">{t("Driver")}</th>
              <th className="px-3 py-2">{t("Last client")}</th>
              <th className="px-3 py-2">{t("Time on site")}</th>
              <th className="px-3 py-2">{t("Free since")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-token">
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
              <tr key={r.truck_id} className="text-sm bg-raised-hover">
                <td className="px-3 py-2 font-mono c-cyan" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      style={{ width: 6, height: 6, borderRadius: "50%", background: dot, display: "inline-block", flex: "none" }}
                    />
                    {r.truck_id}
                  </span>
                </td>
                <td className="px-3 py-2 t-primary" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.driver_name || undefined}>{r.driver_name || "—"}</td>
                <td className="px-3 py-2 t-dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.zone_name}>{r.zone_name}</td>
                <td className="px-3 py-2 t-primary" style={{ whiteSpace: "nowrap" }}>{hoursMinutes(r.seconds_on_site)}</td>
                <td className="px-3 py-2 t-dim" style={{ whiteSpace: "nowrap" }}>{formatAge(minutesSince(r.free_at))}</td>
                <td className="px-3 py-2 text-right" style={{ whiteSpace: "nowrap" }}>
                  {pos && (
                    <Link href={`/dispatch?lat=${pos.lat}&lng=${pos.lng}`} className="text-xs c-accent hover:opacity-80">
                      {t("Locate")}
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      )}
      </div>
    </aside>
  );
}
