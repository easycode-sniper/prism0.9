"use client";

import { useEffect, useState } from "react";
import { listRecentFuelTransactions, type FuelTransactionRow } from "@/lib/supabase/fuel";
import { formatOpsDateTime } from "@/lib/format";

export default function CarburantPage() {
  const [rows, setRows] = useState<FuelTransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listRecentFuelTransactions();
      if (cancelled) return;
      if (res.error) setError(res.error);
      else setRows(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalLitres = (rows ?? []).reduce((s, r) => s + (r.litresFilled ?? 0), 0);
  const totalDa = (rows ?? []).reduce((s, r) => s + r.amountDa, 0);

  return (
    <div style={{ padding: "24px 28px", height: "100%", overflowY: "auto" }}>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600 }}>Carburant</h2>
        <p className="t-dim" style={{ fontSize: ".85rem", marginTop: "4px" }}>
          {rows
            ? `Last ${rows.length} transactions · ${Math.round(totalLitres).toLocaleString("en-GB")} L · ${Math.round(totalDa).toLocaleString("en-GB")} DA`
            : "Reading the fuel sheet…"}
        </p>
      </div>

      {error && (
        <div className="surface" style={{ padding: "14px 16px", color: "var(--red)", fontSize: ".85rem" }}>
          {error}
        </div>
      )}

      {!error && rows === null && (
        <div className="skeleton-stack" role="status" aria-label="Loading transactions">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton skeleton--row" aria-hidden="true" />
          ))}
        </div>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <div className="surface t-dim" style={{ padding: "28px", textAlign: "center", fontSize: ".85rem" }}>
          No fuel transactions recorded yet.
        </div>
      )}

      {!error && rows !== null && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Truck</th>
                <th>Driver</th>
                <th>Date &amp; Time</th>
                <th>Card No</th>
                <th>Station</th>
                <th>Fuel</th>
                <th>Amount (DA)</th>
                <th>Odometer</th>
                <th>Distance (km)</th>
                <th>Litres</th>
                <th>Variance (DA)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <FuelRow key={i} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FuelRow({ row }: { row: FuelTransactionRow }) {
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
      <td style={{ color: row.varianceDa == null ? "var(--text-dim)" : row.varianceDa > 0 ? "var(--red)" : "var(--green)" }}>
        {row.varianceDa != null ? Math.round(row.varianceDa).toLocaleString("en-GB") : "—"}
      </td>
    </tr>
  );
}
