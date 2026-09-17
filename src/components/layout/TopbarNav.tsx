"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Map, Radar, History as HistoryIcon, FileText, Users, Building2, Fuel, Wrench, Bell, Settings} from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { useFleet } from "@/components/providers/FleetProvider";
import { NavBar, type TubelightNavItem } from "@/components/ui/tubelight-navbar";

const NAV_ITEMS: { href: string; key: string; icon: typeof LayoutDashboard }[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/dispatch", key: "nav.dispatch", icon: Map },
  { href: "/monitoring", key: "nav.monitoring", icon: Radar },
  { href: "/history", key: "nav.history", icon: HistoryIcon },
  { href: "/reports", key: "nav.reports", icon: FileText },
  { href: "/drivers", key: "nav.drivers", icon: Users },
  { href: "/clients", key: "nav.clients", icon: Building2 },
  { href: "/carburant", key: "nav.carburant", icon: Fuel },
  { href: "/maintenance", key: "nav.maintenance", icon: Wrench },
  { href: "/notifications", key: "nav.notifications", icon: Bell },
];

export function TopbarNav({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const items: TubelightNavItem[] = NAV_ITEMS.map(({ href, key, icon }) => ({
    name: t(key),
    url: href,
    icon,
  }));
  if (isAdmin) {
    items.push({ name: t("nav.admin"), url: "/admin", icon: Settings });
  }

  return (
    <>
      {/* Keeps .brand on the element itself: the header is a grid and
          .topbar > .brand is what puts it in column 1, so wrapping it in
          a link would take it out of that column. The link IS the
          brand. */}
      <Link href="/dashboard" className="brand brand-link" aria-label={`${t("brand.title")} — ${t("go to dashboard")}`}>
        <div className="brand-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/prism-mark.svg" alt="" width={24} height={24} style={{ objectFit: "contain" }} />
        </div>
        {/* The title is IN THE DOM BUT NOT DRAWN. Four pages —
            dashboard, drivers, carburant, maintenance — have no <h1> of
            their own, so deleting this one would leave them with no
            heading at all; hiding it visually changes what the header
            looks like without changing the document outline. What is
            drawn is the product name alone, because on a screen where
            you already know which app you are in, the app's own name is
            the line paying the least for its width — and with eleven
            tabs the header has none to spare. */}
        <div className="brand-text">
          <h1 className="sr-only">{t("brand.title")}</h1>
          <span className="brand-sub">{t("brand.subtitle")}</span>
        </div>
      </Link>

      {/* The tubelight pill replaces the old segment strip. Labels are
          gone — eleven translated names never fit a centred pill on a
          common screen — so each tab's name rides its title and
          aria-label. Under md the pill detaches to a fixed bottom bar
          (see the component), which is why #tabs must not hide it: the
          wrapper stays display:contents on phones so the fixed pill
          escapes the topbar entirely. */}
      <div id="tabs">
        <NavBar items={items} />
      </div>
    </>
  );
}

export function FleetActiveCount() {
  const { activeRuns, fleetData } = useFleet();
  const { t } = useTranslation();
  return (
    <span className="topbar-active">
      <span className="topbar-active__label">{t("Active:")}</span>{" "}
      <strong style={{ color: "var(--amber)" }}>{activeRuns}</strong> / <span>{fleetData.trucks.length || "—"}</span>
    </span>
  );
}
