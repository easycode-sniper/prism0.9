"use client";

import { useTranslation } from "@/lib/i18n/I18nProvider";

export default function ReportsPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-white">{t("reports.title")}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>{t("reports.subtitle")}</p>
    </div>
  );
}
