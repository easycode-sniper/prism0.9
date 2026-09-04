"use client";

import { useTranslation } from "@/lib/i18n/I18nProvider";
import type { Language } from "@/lib/i18n/translations";

/**
 * The language control, shared by the topbar and the sign-in card.
 *
 * It lived inside TopbarNav until /login needed one too. Importing it
 * from there would have pulled the fleet hooks into the sign-in bundle
 * for a component that only needs useTranslation, so it moved here and
 * TopbarNav imports it back.
 *
 * `codes` exists because the two callers do not offer the same set —
 * see the sign-in page for why it asks for en/fr only.
 */

const LABELS: Record<Language, string> = { en: "EN", fr: "FR", ar: "AR" };

const ALL: Language[] = ["en", "fr", "ar"];

export function LanguageSwitcher({
  codes = ALL,
  className = "",
}: {
  codes?: Language[];
  className?: string;
}) {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div className={`seg seg--sm${className ? ` ${className}` : ""}`} role="group" aria-label={t("common.language")}>
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLanguage(code)}
          className={`seg-item${language === code ? " is-active" : ""}`}
          aria-pressed={language === code}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
