"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Map, Radar, History as HistoryIcon, FileText, Users, Fuel, Bell, Settings} from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { useFleet } from "@/components/providers/FleetProvider";
import type { Language } from "@/lib/i18n/translations";

const NAV_ITEMS: { href: string; key: string; icon: typeof LayoutDashboard }[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/dispatch", key: "nav.dispatch", icon: Map },
  { href: "/monitoring", key: "nav.monitoring", icon: Radar },
  { href: "/history", key: "nav.history", icon: HistoryIcon },
  { href: "/reports", key: "nav.reports", icon: FileText },
  { href: "/drivers", key: "nav.drivers", icon: Users },
  { href: "/carburant", key: "nav.carburant", icon: Fuel },
  { href: "/notifications", key: "nav.notifications", icon: Bell },
];

export function TopbarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <>
      {/* Keeps .brand on the element itself: the header is a grid and
          .topbar > .brand is what puts it in column 1, so wrapping it in
          a link would take it out of that column. The link IS the
          brand. */}
      <Link href="/dashboard" className="brand brand-link" aria-label={`${t("brand.title")} — go to dashboard`}>
        <div className="brand-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/omd-logo.png" alt="OMD" width={24} height={24} style={{ objectFit: "contain" }} />
        </div>
        <div className="brand-text">
          <h1 className="brand-title">{t("brand.title")}</h1>
          <span className="brand-sub">{t("brand.subtitle")}</span>
        </div>
      </Link>

      <nav id="tabs" className="seg">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            title={t(item.key)}
            className={`seg-item${pathname === item.href ? " is-active" : ""}`}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <item.icon size={15} strokeWidth={2} />
            <span className="nav-label">{t(item.key)}</span>
          </Link>
        ))}
        {isAdmin && (
          <Link
            href="/admin"
            title={t("nav.admin")}
            className={`seg-item${pathname.startsWith("/admin") ? " is-active" : ""}`}
            aria-current={pathname.startsWith("/admin") ? "page" : undefined}
          >
            <Settings size={15} strokeWidth={2} />
            <span className="nav-label">{t("nav.admin")}</span>
          </Link>
        )}
      </nav>
    </>
  );
}

export function FleetActiveCount() {
  const { activeRuns, fleetData } = useFleet();
  return (
    <span className="topbar-active">
      <span className="topbar-active__label">Active:</span>{" "}
      <strong style={{ color: "var(--amber)" }}>{activeRuns}</strong> / <span>{fleetData.trucks.length || "—"}</span>
    </span>
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
    <div className="seg seg--sm">
      {options.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => setLanguage(opt.code)}
          className={`seg-item${language === opt.code ? " is-active" : ""}`}
          aria-pressed={language === opt.code}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
