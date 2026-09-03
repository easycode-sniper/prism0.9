"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { checkPositionForDispatch } from "@/lib/supabase/positions";
import type { PositionCheckResult } from "@/lib/supabase/positions";
import type { MonitoringTruck } from "@/lib/supabase/monitoring";
import { useFleet } from "@/components/providers/FleetProvider";
import { joinFleetWithDispatches } from "@/lib/fleetJoin";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { formatAge } from "@/lib/format";
import UnloadedPanel from "@/components/monitoring/UnloadedPanel";

type FilterType = "all" | "dispatched" | "moving" | "idle" | "offline";

const FILTERS: FilterType[] = ["all", "dispatched", "moving", "idle", "offline"];

export default function MonitoringPage() {
  const { t } = useTranslation();
  // Fleet positions and active dispatches both come from the app-wide
  // FleetProvider context — already polling/subscribed in the
  // background — instead of this page fetching (and opening its own
  // realtime channel on) the same data every time it's visited.
  const { fleetData, dispatches, refreshDispatches } = useFleet();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [checkResults, setCheckResults] = useState<Map<string, PositionCheckResult>>(new Map());
  const [checking, setChecking] = useState<string | null>(null);

  const trucks = useMemo(
    () => joinFleetWithDispatches(fleetData.trucks, dispatches),
    [fleetData.trucks, dispatches]
  );

  // Handed to the panel so it can show whether a freed truck is already
  // rolling, without opening a second subscription to fleet data this
  // page is already holding.
  const statusOf = useMemo(
    () => new Map(trucks.map((tr) => [tr.truck_id, tr.status])),
    [trucks]
  );
  const positionOf = useMemo(
    () => new Map(
      trucks
        .filter((tr) => tr.lat != null && tr.lng != null)
        .map((tr) => [tr.truck_id, { lat: tr.lat as number, lng: tr.lng as number }])
    ),
    [trucks]
  );

  async function handleCheckPosition(dispatchId: string, truckId: string) {
    setChecking(truckId);
    const result = await checkPositionForDispatch(truckId, dispatchId);
    if (result.result) {
      setCheckResults(prev => new Map(prev).set(dispatchId, result.result!));
    }
    setChecking(null);
    await refreshDispatches();
  }

  if (trucks.length === 0 && !fleetData.lastUpdated && !fleetData.error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm t-dim">{t("Waiting for first fleet sync…")}</div>
      </div>
    );
  }

  // Matches the legacy app's search scope exactly: driver name or truck
  // ID only (not site/client — that's what the filter buttons are for).
  const filteredTrucks = trucks.filter((tr) => {
    if (search) {
      const s = search.toLowerCase();
      const matchTruck = tr.truck_id.toLowerCase().includes(s);
      const matchDriver = tr.driver_name?.toLowerCase().includes(s) ?? false;
      if (!matchTruck && !matchDriver) return false;
    }
    if (filter === "dispatched") return tr.dispatched;
    if (filter === "moving") return tr.status === "moving";
    if (filter === "idle") return tr.status === "idle";
    if (filter === "offline") return tr.status === "offline";
    return true;
  });

  return (
    // Two equal panels, same dimensions. The left fleet table is fixed at
    // 20 rows (704px incl. header) with its own scroll so the full 101-row
    // list is reachable without pushing Déchargés off-screen. Destination
    // column removed — it took the most width for the least signal on this
    // page (most rows are "—"). Both panels now share 1fr/1fr, same height
    // (704px), same border/radius, same header treatment, so neither reads
    // as secondary.
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold t-primary">{t("monitoring.title")}</h1>
          <p className="text-xs t-dim">{t("Search and filter every truck in the fleet, dispatched or not")}</p>
        </div>
        <span className="font-mono text-sm" style={{ color: "var(--text-dim)" }}>{filteredTrucks.length} / {trucks.length}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          placeholder={t("Search driver or truck ID…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border bd bg-raised px-3 py-1.5 text-sm t-primary placeholder-current focus:border-[var(--accent)] focus:outline-none"
          style={{ maxWidth: "280px" }}
        />
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn-sm capitalize ${filter === f ? "is-on" : ""}`}
          >
            {t(f)}
          </button>
        ))}
      </div>

      <div
        className="mt-4"
        // EQUAL HEIGHT, NOT EQUAL WIDTH. Both panels are 704px tall and
        // that half of the balancing is right — but 1fr/1fr was measured
        // on 2026-09-03 and clips the data. The table is table-layout:
        // fixed over a 628px colgroup, so it never scrolls sideways; it
        // truncates instead, and at half the viewport there is not enough
        // to truncate from. At 1366 the truck cell needs 140px and gets
        // 122, so EVERY truck id rendered as "000051-52…" — the one
        // identifier a dispatcher reads off this screen — and half the
        // driver names went with it. Rows also grew 45px → 63px, costing
        // about seven trucks of the density CLAUDE.md asks for.
        //
        // 380px is not a new number: it is what the previous commit used
        // before the equal-width pass. Measured across three widths:
        //
        //   1fr/1fr    1280  24/24 trucks clipped   63px rows
        //              1366  24/24 clipped          63px rows
        //   1fr/380px  1280   0/24 clipped          45px rows
        //              1366   0/24 clipped, 0/24 drivers clipped
        //
        // The panel is a list of truck, driver and site — it has never
        // needed half the screen, and the table has always needed more.
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px", gap: 16, alignItems: "stretch" }}
      >
      <div className="flex flex-col overflow-hidden rounded-lg border bd" style={{ height: 704, minHeight: 0 }}>
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
        <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 118 }} />
            <col style={{ width: 158 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 78 }} />
            <col style={{ width: 118 }} />
            <col style={{ width: 68 }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b bd bg-panel text-left text-xs uppercase t-dim">
              <th className="px-3 py-2">{t("Truck")}</th>
              <th className="px-3 py-2">{t("Driver")}</th>
              <th className="px-3 py-2">{t("Status")}</th>
              <th className="px-3 py-2">{t("Speed")}</th>
              <th className="px-3 py-2">{t("Updated")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-token">
            {filteredTrucks.map((tr) => (
              <MonitoringRow
                key={tr.truck_id}
                truck={tr}
                check={tr.dispatch_id ? checkResults.get(tr.dispatch_id) : undefined}
                checking={checking === tr.truck_id}
                onCheckPosition={() => tr.dispatch_id && handleCheckPosition(tr.dispatch_id, tr.truck_id)}
              />
            ))}
          </tbody>
        </table>
        {filteredTrucks.length === 0 && (
          <div className="p-8 text-center text-sm t-dim">{t("No trucks match.")}</div>
        )}
        </div>
      </div>

      {/* Outside the search/filter state on purpose: this answers "who
          is free", which is a question about the whole fleet. Narrowing
          it with the table's search would hide the very truck a
          dispatcher is about to reach for. */}
      <UnloadedPanel statusOf={statusOf} positionOf={positionOf} />
      </div>
    </div>
  );
}

function MonitoringRow({
  truck,
  check,
  checking,
  onCheckPosition,
}: {
  truck: MonitoringTruck;
  check: PositionCheckResult | undefined;
  checking: boolean;
  onCheckPosition: () => void;
}) {
  const { t } = useTranslation();
  const isOffRoute = truck.dispatched && truck.last_on_route === false;
  // The filter buttons above use the same keys, so a truck reads the same
  // word in the table as on the button that selected it.
  const statusLabel = isOffRoute ? t("off-route") : t(truck.status);
  // Amber for idle, matching the taxonomy in CLAUDE.md and globals.css
  // — cyan is parking and stations. This row and dispatch's statusColor
  // were the app's two hold-outs; the map, the dashboard and
  // .status-pill.idle were amber all along, so an idle truck read amber
  // on the map and cyan in this table. Corrected 2026-09-01.
  const statusColor = isOffRoute ? "var(--red)" : truck.status === "moving" ? "var(--green)" : truck.status === "idle" ? "var(--amber)" : "var(--text-dim)";

  const locateHref = truck.lat != null && truck.lng != null
    ? `/dispatch?lat=${truck.lat}&lng=${truck.lng}`
    : null;

  return (
    <tr className="text-sm bg-raised-hover">
      <td className="px-3 py-2 font-mono c-cyan" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span className="inline-flex items-center gap-1.5">
          {truck.truck_id}
          {truck.category === "staff" && (
            <span className="vehicle-tag" title={t("Staff car — excluded from notifications")}>{t("staff")}</span>
          )}
        </span>
      </td>
      <td className="px-3 py-2 t-primary" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={truck.driver_name || undefined}>{truck.driver_name || "—"}</td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium" style={{ color: statusColor }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
          {statusLabel}
        </span>
      </td>
      <td className="px-3 py-2 t-primary" style={{ whiteSpace: "nowrap" }}>{truck.speed != null ? `${truck.speed} km/h` : "—"}</td>
      <td className="px-3 py-2 t-dim" style={{ whiteSpace: "nowrap" }}>{formatAge(truck.age_minutes)}</td>
      <td className="px-3 py-2 text-right" style={{ whiteSpace: "nowrap" }}>
        {truck.dispatched && truck.last_on_route == null && truck.dispatch_id && (
          <button
            onClick={onCheckPosition}
            disabled={checking}
            className="mr-2 text-xs c-accent hover:opacity-80 disabled:opacity-50"
            title={check ? `${check.etaLabel}` : undefined}
          >
            {checking ? "…" : t("Check")}
          </button>
        )}
        {locateHref && (
          <Link href={locateHref} className="text-xs c-accent hover:opacity-80">{t("Locate")}</Link>
        )}
      </td>
    </tr>
  );
}
