"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { useFleet } from "@/components/providers/FleetProvider";
import type { Language } from "@/lib/i18n/translations";

const NAV_ITEMS: { href: string; key: string }[] = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/dispatch", key: "nav.dispatch" },
  { href: "/monitoring", key: "nav.monitoring" },
  { href: "/live-fleet", key: "nav.liveFleet" },
  { href: "/history", key: "nav.history" },
  { href: "/notifications", key: "nav.notifications" },
];

export function TopbarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <>
      <div className="brand" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div className="brand-mark" style={{ width: "38px", height: "38px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "8px", background: "linear-gradient(135deg, var(--indigo), var(--purple))" }}>
          <span style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>P</span>
        </div>
        <div>
          <h1 style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", fontWeight: 600, letterSpacing: ".02em" }}>{t("brand.title")}</h1>
          <span style={{ display: "block", fontSize: ".65rem", color: "var(--text-dim)", letterSpacing: ".08em", textTransform: "uppercase", marginTop: "1px" }}>{t("brand.subtitle")}</span>
        </div>
      </div>

      <nav id="tabs" style={{ display: "flex", gap: "6px", background: "var(--panel-2)", padding: "4px", borderRadius: "10px", border: "1px solid var(--line)" }}>
        {NAV_ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className="tab-btn" style={tabStyle(pathname === item.href)}>
            {t(item.key)}
          </Link>
        ))}
        {isAdmin && (
          <Link href="/admin" className="tab-btn" style={tabStyle(pathname.startsWith("/admin"))}>
            {t("nav.admin")}
          </Link>
        )}
      </nav>
    </>
  );
}

export function FleetActiveCount() {
  const { activeRuns, fleetData } = useFleet();
  return (
    <span>Active: <strong style={{ color: "var(--amber)" }}>{activeRuns}</strong> / <span>{fleetData.trucks.length || "—"}</span></span>
  );
}

export function LanguageSwitcher() {
  const { language, setLanguage } = useTranslation();
  const options: { code: Language; label: string }[] = [
    { code: "en", label: "EN" },
    { code: "fr", label: "FR" },
    { code: "ar", label: "AR" },
  ];

  return (
    <div style={{ display: "flex", gap: "2px", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: "6px", padding: "2px" }}>
      {options.map((opt) => (
        <button
          key={opt.code}
          onClick={() => setLanguage(opt.code)}
          style={{
            background: language === opt.code ? "var(--indigo)" : "transparent",
            color: language === opt.code ? "#fff" : "var(--text-dim)",
            border: "none",
            borderRadius: "4px",
            padding: "3px 8px",
            fontSize: ".72rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "linear-gradient(135deg, var(--indigo), var(--purple))" : "transparent",
    border: "none",
    color: active ? "#fff" : "var(--text-dim)",
    fontFamily: "var(--font-sans)",
    fontSize: ".85rem",
    fontWeight: 600,
    padding: "8px 16px",
    borderRadius: "7px",
    cursor: "pointer",
    transition: ".15s",
    textDecoration: "none",
    boxShadow: active ? "0 2px 10px rgba(109,91,255,.35)" : "none",
    display: "inline-block",
  };
}
