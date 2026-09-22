"use client";

import { useState } from "react";
import { Calculator, FileSpreadsheet } from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { FuelEstimator } from "@/components/tools/FuelEstimator";
import { ExcelProcessor } from "@/components/tools/ExcelProcessor";

type Module = "estimator" | "processor";

/**
 * Tools. Two everyday utilities that used to live in a standalone HTML
 * file: a trip fuel/cost estimator for the five staff vehicles, and the
 * fuel-transaction spreadsheet cleaner. Both run entirely in the browser
 * — the page has no server round trips of its own.
 */
export default function ToolsPage() {
  const { t } = useTranslation();
  const [module, setModule] = useState<Module>("estimator");

  return (
    <div className="tools-page">
      <header className="tools-head">
        <h2 className="tools-title">{t("Tools")}</h2>
        <p className="tools-sub">{t("Everyday utilities: trip fuel estimates and the transaction spreadsheet cleaner.")}</p>
      </header>

      <div className="seg" role="tablist" aria-label={t("Tools")} style={{ marginBottom: "12px" }}>
        <button
          type="button"
          role="tab"
          aria-selected={module === "estimator"}
          onClick={() => setModule("estimator")}
          className={`seg-item${module === "estimator" ? " is-active" : ""}`}
        >
          <Calculator size={15} strokeWidth={2} aria-hidden="true" />
          {t("Fuel estimator")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={module === "processor"}
          onClick={() => setModule("processor")}
          className={`seg-item${module === "processor" ? " is-active" : ""}`}
        >
          <FileSpreadsheet size={15} strokeWidth={2} aria-hidden="true" />
          {t("Excel transaction processor")}
        </button>
      </div>

      {module === "estimator" ? <FuelEstimator /> : <ExcelProcessor />}
    </div>
  );
}
