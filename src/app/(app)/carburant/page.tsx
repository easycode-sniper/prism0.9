"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Combobox, { type ComboOption } from "@/components/forms/Combobox";
import {
  getFuelPage,
  getFuelPageOptions,
  type FuelPageData,
  type FuelPageOptions,
  type FuelTransactionRow,
} from "@/lib/supabase/fuel";
import { formatOpsDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n/I18nProvider";

// Mirrors the query size in fuel.ts. The two must agree for the
// "showing x–y of z" maths; the RPC caps harder (500) as a guard, so
// raising this past that would need the SQL touched too.
const PAGE_SIZE = 200;

// The office's calendar is Africa/Algiers — fixed +01:00 all year, no
// DST — so "the current month" is computed by shifting UTC now one hour
// east and reading the UTC fields back. A browser west of that line at
// midnight would otherwise open yesterday's month. An `offset` of 0 is
// the current month, -1 the one before it.
function algiersMonth(offset: number): { from: string; to: string; year: number; month: number } {
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${year}-${p(month + 1)}-01`,
    to: `${year}-${p(month + 1)}-${p(lastDay)}`,
    year,
    month,
  };
}

const monthLabel = (year: number, month: number) =>
  new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month, 1))
  );

const nf = (n: number) => Math.round(n).toLocaleString("en-GB");

const NO_FILTERS = { driver: "", truck: "", model: "" };

export default function CarburantPage() {
  const { t } = useTranslation();

  // "Current month" is set on mount, not in the state initializer: the
  // initializer runs during SSR with the SERVER's clock, and a browser
  // east of it would flash the wrong month before hydrating.
  const [monthOffset, setMonthOffset] = useState<number | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [options, setOptions] = useState<FuelPageOptions | null>(null);
  const [data, setData] = useState<FuelPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const month = useMemo(() => (monthOffset === null ? null : algiersMonth(monthOffset)), [monthOffset]);

  // Stable for the component's lifetime — an unstable client identity
  // would tear down and re-fire the realtime subscription on every
  // render. Same reasoning as FleetProvider.
  const [supabase] = useState(() => createClient());

  // The sheet changed while you were looking at it. One small event per
  // sync (fuel_sync_signals, migration 066), debounced; bumps `version`,
  // which the read effects below depend on. With the push pipeline live
  // this lands a new fill on this page within seconds of it being typed.
  const [version, setVersion] = useState(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMonthOffset(0);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("carburant-fuel-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_sync_signals" }, () => {
        if (reloadTimer.current) clearTimeout(reloadTimer.current);
        reloadTimer.current = setTimeout(() => {
          reloadTimer.current = null;
          setVersion((v) => v + 1);
        }, 800);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [supabase]);

  // The pickers belong to the month on screen — a driver who only
  // filled in August does not belong in a September dropdown.
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    void getFuelPageOptions({ from: month.from, to: month.to }).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else if (res.data) setOptions(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [month, version]);

  // The rows. Deliberately NOT cleared while a new load is in flight —
  // changing page or a filter replaces a full table with a skeleton for
  // a 20ms RPC, which reads as a flicker, not as progress.
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    void getFuelPage({
      from: month.from,
      to: month.to,
      filters: {
        driver: filters.driver || null,
        truck: filters.truck || null,
        model: filters.model || null,
      },
      page,
    }).then((res) => {
      if (cancelled) return;
      if (res.error) setError(res.error);
      else {
        setData(res.data);
        setError(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [month, filters.driver, filters.truck, filters.model, page, version]);

  const stepMonth = (delta: number) => {
    setMonthOffset((m) => (m ?? 0) + delta);
    // A driver picked in September is a ghost in October; the filters
    // belong to the month that was on screen when they were chosen.
    setFilters(NO_FILTERS);
    setPage(0);
  };

  const comboOptionsFor = (values: string[], allLabel: string): ComboOption[] => [
    { id: "", label: allLabel },
    ...values.map((v) => ({ id: v, label: v })),
  ];

  const rows = data?.rows ?? [];
  const totalRows = data?.totalRows ?? 0;
  const showingFrom = totalRows === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalRows);
  const filtersActive = Boolean(filters.driver || filters.truck || filters.model);

  // The five month totals, as pills. Read from the SAME call as the
  // rows (fuel_page_transactions carries them as window aggregates), so
  // they cost no second round trip, honour the filters, and repaint
  // with the table when a fuel_sync_signals event bumps `version`.
  const varianceLabel = (v: number | null) =>
    v == null ? "—" : `${v > 0 ? "+" : ""}${nf(v)}`;

  const varianceTone = (v: number | null): "good" | "bad" | null =>
    v == null ? null : v > 0 ? "bad" : v < 0 ? "good" : null;

  return (
    <div style={{ padding: "24px 28px", height: "100%", overflowY: "auto" }}>
      <div style={{ marginBottom: "12px" }}>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600 }}>Carburant</h2>
        <p className="t-dim" style={{ fontSize: ".85rem", marginTop: "4px" }}>
          {data ? t("{n} fills", { n: nf(data.totalRows) }) : t("Reading the fuel sheet…")}
        </p>
      </div>

      {/* ── The month's five totals ──
          Little pills, not the dashboard's KPI cards: these answer
          "what does the month cost" in one glance and are read below
          the heading rather than replacing it. Achromatic except the
          variance pill — a signed figure against a known baseline
          keeps the money-column rule the dashboard already grants it
          (red overspend, green saving). */}
      <div className="totals-pills" aria-label={t("Month totals")}>
        <TotalPill label={t("Amount filled")} value={data ? nf(data.totalAmountDa) : "…"} unit="DA" />
        <TotalPill label={t("Litres consumed")} value={data ? nf(data.totalLitres) : "…"} unit="L" />
        <TotalPill
          label={t("Kilometres driven")}
          value={data ? (data.totalKm != null ? nf(data.totalKm) : "—") : "…"}
          unit="km"
        />
        <TotalPill
          label={t("Average consumption")}
          value={data ? (data.totalLitresPer100Km != null ? data.totalLitresPer100Km.toFixed(2) : "—") : "…"}
          unit="L/100km"
        />
        <TotalPill
          label={t("Total variance")}
          value={data ? varianceLabel(data.totalVarianceDa) : "…"}
          unit="DA"
          tone={data ? varianceTone(data.totalVarianceDa) : null}
        />
      </div>

      {error && (
        <div className="surface" style={{ padding: "14px 16px", color: "var(--red)", fontSize: ".85rem" }}>
          {error}
        </div>
      )}

      {/* ── Month stepper + filters ── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          className="btn-sm"
          disabled={monthOffset === null}
          onClick={() => stepMonth(-1)}
          title={t("Previous month")}
          aria-label={t("Previous month")}
        >
          ‹
        </button>
        <span
          style={{ minWidth: 150, textAlign: "center", fontWeight: 600, fontSize: ".85rem" }}
          aria-live="polite"
        >
          {month ? monthLabel(month.year, month.month) : "…"}
        </span>
        <button
          type="button"
          className="btn-sm"
          // No stepping into the future: today's month is the newest
          // there is.
          disabled={monthOffset === null || monthOffset >= 0}
          onClick={() => stepMonth(1)}
          title={t("Next month")}
          aria-label={t("Next month")}
        >
          ›
        </button>

        <div style={{ width: 12 }} />
        <Combobox
          options={comboOptionsFor(options?.drivers ?? [], t("All drivers"))}
          value={filters.driver}
          onChange={(id) => {
            setFilters((f) => ({ ...f, driver: id }));
            setPage(0);
          }}
          placeholder={t("All drivers")}
          listLabel={t("Drivers")}
          loadingText={t("Loading drivers and trucks…")}
          noMatchText={(q) => t("Nobody and no truck matches “{q}”", { q })}
          style={{ width: 200, maxWidth: "100%" }}
        />
        <Combobox
          options={comboOptionsFor(options?.trucks ?? [], t("All trucks"))}
          value={filters.truck}
          onChange={(id) => {
            setFilters((f) => ({ ...f, truck: id }));
            setPage(0);
          }}
          placeholder={t("All trucks")}
          listLabel={t("Trucks")}
          loadingText={t("Loading drivers and trucks…")}
          noMatchText={(q) => t("Nobody and no truck matches “{q}”", { q })}
          style={{ width: 170, maxWidth: "100%" }}
        />
        <Combobox
          options={comboOptionsFor(options?.models ?? [], t("All models"))}
          value={filters.model}
          onChange={(id) => {
            setFilters((f) => ({ ...f, model: id }));
            setPage(0);
          }}
          placeholder={t("All models")}
          listLabel={t("Models")}
          loadingText={t("Loading drivers and trucks…")}
          noMatchText={(q) => t("Nobody and no truck matches “{q}”", { q })}
          style={{ width: 150, maxWidth: "100%" }}
        />
        {filtersActive && (
          <button
            type="button"
            className="btn-sm"
            onClick={() => {
              setFilters(NO_FILTERS);
              setPage(0);
            }}
          >
            {t("Clear")}
          </button>
        )}
      </div>

      {!error && data === null && (
        <div className="skeleton-stack" role="status" aria-label="Loading transactions">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton skeleton--row" aria-hidden="true" />
          ))}
        </div>
      )}

      {!error && data !== null && rows.length === 0 && (
        <div className="surface t-dim" style={{ padding: "28px", textAlign: "center", fontSize: ".85rem" }}>
          {filtersActive
            ? t("No fills match the filters.")
            : t("No fills recorded in {month}.", { month: month ? monthLabel(month.year, month.month) : "" })}
        </div>
      )}

      {!error && rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("Model")}</th>
                  <th>{t("Truck")}</th>
                  <th>{t("Driver")}</th>
                  <th>{t("Date & Time")}</th>
                  <th>{t("Card No")}</th>
                  <th>{t("Station")}</th>
                  <th>{t("Fuel")}</th>
                  <th>{t("Amount (DA)")}</th>
                  <th>{t("Odometer")}</th>
                  <th>{t("Distance (km)")}</th>
                  <th>{t("Litres")}</th>
                  <th>{t("Variance (DA)")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <FuelRow key={r.sheetRow ?? `${r.occurredAt}-${r.cardNo ?? ""}`} row={r} />
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="t-dim"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 10,
              fontSize: ".8rem",
            }}
          >
            <span>
              {t("Showing {from}–{to} of {total}", {
                from: nf(showingFrom),
                to: nf(showingTo),
                total: nf(totalRows),
              })}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className="btn-sm"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                title={t("Previous month")}
                aria-label={t("Previous month")}
              >
                ‹
              </button>
              <button
                type="button"
                className="btn-sm"
                disabled={showingTo >= totalRows}
                onClick={() => setPage((p) => p + 1)}
                title={t("Next month")}
                aria-label={t("Next month")}
              >
                ›
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TotalPill({
  label,
  value,
  unit,
  tone,
}: {
  label: ReactNode;
  value: string;
  unit: string;
  tone?: "good" | "bad" | null;
}) {
  return (
    <div className={`total-pill${tone ? ` total-pill--${tone}` : ""}`}>
      <span className="total-pill__label">{label}</span>
      <span className="total-pill__value">{value}</span>
      <span className="total-pill__unit">{unit}</span>
    </div>
  );
}

function FuelRow({ row }: { row: FuelTransactionRow }) {
  const { t } = useTranslation();
  // Vh Service fills have no truck_id — the model column already reads
  // "VH SERVICE" for these, so that's what shows in the Truck slot rather
  // than leaving it blank.
  const truckLabel = row.truckId ?? (row.category === "vh_service" ? row.model : null) ?? "—";

  return (
    <tr>
      <td className="t-dim">{row.model ?? "—"}</td>
      <td className="truck-id">{truckLabel}</td>
      <td className="t-primary">{row.driverName ?? "—"}</td>
      {/* The sheet's own text, verbatim. The column is genuinely
          ambiguous — the sheet writes days 1-12 as month/day and days
          13+ as day/month — so any single reading of it is wrong for
          half the rows. Printing the cell is the one thing that always
          matches what the office sees. Falls back to the parsed instant
          only for a row synced before the raw cell was stored. */}
      <td className="t-dim">{row.occurredRaw ?? formatOpsDateTime(row.occurredAt)}</td>
      <td className="t-dim">{row.cardNo ?? "—"}</td>
      <td className="t-dim">{row.station ?? "—"}</td>
      <td className="t-dim">{row.fuelType ?? "—"}</td>
      <td className="t-primary">{Math.round(row.amountDa).toLocaleString("en-GB")}</td>
      <td className="t-dim">{row.odometerKm != null ? Math.round(row.odometerKm).toLocaleString("en-GB") : "—"}</td>
      <td className="t-dim">{row.distanceKm != null ? Math.round(row.distanceKm).toLocaleString("en-GB") : "—"}</td>
      <td className="t-primary">{row.litresFilled != null ? row.litresFilled.toLocaleString("en-GB") : "—"}</td>
      {/* variance = amount paid - expected cost for the distance driven.
          Positive means this fill cost more than the assumed rate
          predicted — the direction worth a second look — so that's red,
          not green. */}
      <td
        style={{
          color:
            row.varianceDa == null ? "var(--text-dim)" : row.varianceDa > 0 ? "var(--red)" : "var(--green)",
        }}
        title={t("Positive means this fill cost more than the assumed rate predicted.")}
      >
        {row.varianceDa != null ? Math.round(row.varianceDa).toLocaleString("en-GB") : "—"}
      </td>
    </tr>
  );
}
