"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { checkPositionForDispatch } from "@/lib/supabase/positions";
import type { PositionCheckResult } from "@/lib/supabase/positions";
import type { MonitoringTruck } from "@/lib/supabase/monitoring";
import { useFleet } from "@/components/providers/FleetProvider";
import { joinFleetWithDispatches } from "@/lib/fleetJoin";
import { useTranslation } from "@/lib/i18n/I18nProvider";

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
        <div className="text-sm text-gray-500">Waiting for first fleet sync...</div>
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
    <div className="mx-auto max-w-6xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">{t("monitoring.title")}</h1>
          <p className="text-xs text-gray-500">Search and filter every truck in the fleet, dispatched or not</p>
        </div>
        <span className="font-mono text-sm" style={{ color: "var(--text-dim)" }}>{filteredTrucks.length} / {trucks.length}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          placeholder="Search driver or truck ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
          style={{ maxWidth: "280px" }}
        />
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2.5 py-1 text-xs capitalize transition ${filter === f ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-2">Truck</th>
              <th className="px-4 py-2">Driver</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Speed</th>
              <th className="px-4 py-2">Destination</th>
              <th className="px-4 py-2">Updated</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
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
          <div className="p-8 text-center text-sm text-gray-500">No trucks match.</div>
        )}
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
  const isOffRoute = truck.dispatched && truck.last_on_route === false;
  const statusLabel = isOffRoute ? "off-route" : truck.status;
  const statusColor = isOffRoute ? "#f87171" : truck.status === "moving" ? "#4ade80" : truck.status === "idle" ? "#22d3ee" : "var(--text-dim)";

  const locateHref = truck.lat != null && truck.lng != null
    ? `/dispatch?lat=${truck.lat}&lng=${truck.lng}`
    : null;

  return (
    <tr className="text-sm hover:bg-gray-800/30">
      <td className="px-4 py-2 font-mono text-cyan-400">
        <span className="inline-flex items-center gap-1.5">
          {truck.truck_id}
          {truck.category === "staff" && (
            <span className="vehicle-tag" title="Staff car — excluded from notifications">staff</span>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-white">{truck.driver_name || "—"}</td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium" style={{ color: statusColor }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, display: "inline-block" }} />
          {statusLabel}
        </span>
      </td>
      <td className="px-4 py-2 text-gray-300">{truck.speed != null ? `${truck.speed} km/h` : "—"}</td>
      <td className="px-4 py-2 text-gray-400">
        {truck.dispatched ? (
          <span className="text-white">{truck.site_name ?? "—"}</span>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-gray-400">{truck.age_minutes != null ? `${truck.age_minutes}min ago` : "—"}</td>
      <td className="px-4 py-2 text-right">
        {truck.dispatched && truck.last_on_route == null && truck.dispatch_id && (
          <button
            onClick={onCheckPosition}
            disabled={checking}
            className="mr-2 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            title={check ? `${check.etaLabel}` : undefined}
          >
            {checking ? "..." : "Check"}
          </button>
        )}
        {locateHref && (
          <Link href={locateHref} className="text-xs text-indigo-400 hover:text-indigo-300">Locate</Link>
        )}
      </td>
    </tr>
  );
}
