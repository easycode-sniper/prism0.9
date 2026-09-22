"use client";

import { useState } from "react";
import { Car, Info } from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import {
  FUEL_VEHICLES,
  estimateFuel,
  type DrivingCondition,
  type FuelKind,
} from "./fuelVehicles";

const CONDITIONS: DrivingCondition[] = ["city", "highway", "mixed"];

const FUEL_TAG_STYLE: Record<FuelKind, { color: string; borderColor: string }> = {
  diesel: { color: "var(--amber)", borderColor: "var(--amber)" },
  petrol: { color: "var(--red)", borderColor: "var(--red)" },
  gpl: { color: "var(--green)", borderColor: "var(--green)" },
};

const FUEL_LABEL_KEY: Record<FuelKind, string> = {
  diesel: "Diesel",
  petrol: "Petrol",
  gpl: "GPL",
};

/**
 * Fuel estimator. Vehicle cards, a distance field and a driving-condition
 * switch; the estimate recomputes on every change, exactly like the
 * standalone tool — there is no submit because there is nothing to submit.
 */
export function FuelEstimator() {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState(FUEL_VEHICLES[0].id);
  const [distance, setDistance] = useState("");
  const [condition, setCondition] = useState<DrivingCondition>("mixed");

  const vehicle = FUEL_VEHICLES.find((v) => v.id === vehicleId) ?? FUEL_VEHICLES[0];
  const estimate = estimateFuel(vehicle, parseFloat(distance), condition);

  return (
    <section className="panel" style={{ padding: "18px" }}>
      <span
        className="t-faint"
        style={{ display: "block", fontSize: ".64rem", marginBottom: "8px", textTransform: "uppercase", letterSpacing: ".06em" }}
      >
        {t("Select vehicle")}
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
        {FUEL_VEHICLES.map((v) => {
          const active = v.id === vehicleId;
          const tag = FUEL_TAG_STYLE[v.fuel];
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVehicleId(v.id)}
              className="card-interactive"
              aria-pressed={active}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                alignItems: "flex-start",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: "var(--r-lg)",
                border: active ? "1px solid var(--accent)" : "1px solid var(--line)",
                background: active ? "var(--panel-2)" : "var(--surface)",
                cursor: "pointer",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                <Car size={14} aria-hidden="true" style={{ color: active ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: ".62rem",
                    fontWeight: 700,
                    padding: "1px 7px",
                    borderRadius: "99px",
                    border: `1px solid ${tag.borderColor}`,
                    color: tag.color,
                  }}
                >
                  {t(FUEL_LABEL_KEY[v.fuel])}
                </span>
              </span>
              {/* Proper nouns — rendered literally, never through t(). */}
              <span style={{ fontSize: ".8rem", fontWeight: 700 }}>{v.name}</span>
              <span className="t-faint" style={{ fontSize: ".68rem", fontFamily: "var(--font-mono)" }}>{v.detail}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px", marginTop: "14px" }}>
        <label>
          <span className="t-faint" style={{ display: "block", fontSize: ".64rem", marginBottom: "3px" }}>
            {t("Distance (km)")}
          </span>
          <input
            className="field"
            type="number"
            min={0}
            step="0.1"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder={t("Enter distance in kilometres")}
            style={{ fontSize: ".85rem", padding: "8px 10px" }}
          />
        </label>
        <div>
          <span className="t-faint" style={{ display: "block", fontSize: ".64rem", marginBottom: "3px" }}>
            {t("Driving conditions")}
          </span>
          <div className="seg seg--sm" role="group" aria-label={t("Driving conditions")}>
            {CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCondition(c)}
                className={`seg-item${condition === c ? " is-active" : ""}`}
                aria-pressed={condition === c}
              >
                {t(c === "city" ? "City" : c === "highway" ? "Highway" : "Mixed")}
              </button>
            ))}
          </div>
        </div>
      </div>

      {estimate && (
        <div
          className="panel-2"
          // Capped: at full page width the two headline figures sit
          // half a screen apart and the detail rows pull to opposite
          // edges, which reads as broken rather than spacious.
          style={{ marginTop: "14px", borderRadius: "var(--r-lg)", padding: "14px", maxWidth: "720px" }}
          aria-live="polite"
        >
          <span
            className="t-faint"
            style={{ display: "block", fontSize: ".64rem", marginBottom: "8px", textTransform: "uppercase", letterSpacing: ".06em" }}
          >
            {t("Trip estimate")}
          </span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "10px" }}>
            <div style={{ textAlign: "center" }}>
              <div className="t-faint" style={{ fontSize: ".68rem" }}>{t("Fuel needed")}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{estimate.litres.toFixed(2)} L</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div className="t-faint" style={{ fontSize: ".68rem" }}>{t("Total cost")}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{estimate.costDa.toFixed(0)} DA</div>
            </div>
          </div>
          <dl style={{ display: "grid", gap: "2px", fontSize: ".74rem", margin: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <dt className="t-faint">{t("Vehicle")}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{vehicle.name}</dd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <dt className="t-faint">{t("Distance")}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{parseFloat(distance)} km</dd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <dt className="t-faint">{t("Consumption")}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>{estimate.rate} {t("L/100km")}</dd>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <dt className="t-faint">{t("Fuel price")}</dt>
              <dd style={{ margin: 0, fontWeight: 600 }}>
                {vehicle.pricePerLitre} DA/L ({t(FUEL_LABEL_KEY[vehicle.fuel])})
              </dd>
            </div>
          </dl>
        </div>
      )}

      <p className="t-faint" style={{ display: "flex", gap: "6px", fontSize: ".7rem", lineHeight: 1.5, marginTop: "12px", marginBottom: 0 }}>
        <Info size={13} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
        {t("Estimates use real-world consumption figures. Actual use varies with driving style, load, road conditions, and vehicle state.")}
      </p>
    </section>
  );
}
