"use client";

import React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TubelightNavItem {
  /** Translated label — tooltip and screen-reader name. The pill is
   *  icons-only by design: eleven Prism tabs with labels do not fit a
   *  centred pill on any common screen. */
  name: string;
  url: string;
  icon: LucideIcon;
}

interface NavBarProps {
  items: TubelightNavItem[];
  /** Framer Motion's shared-layout id. One instance per page, so the
   *  default is fine; pass a distinct one if two pills ever coexist. */
  layoutId?: string;
  className?: string;
}

/**
 * The tubelight navbar — a floating pill whose active tab carries a
 * spring-animated lamp that slides between items (framer-motion
 * layoutId). Adapted for Prism from the shadcn-style original:
 *
 * - ACTIVE STATE COMES FROM THE URL, not from clicks. The original kept
 *   activeTab in state and set it onClick, so a refresh, a back button
 *   or a shared link lit the wrong (first) tab.
 * - Prism's own tokens replace the shadcn set: the pill is panel glass,
 *   the lamp burns accent cream — the same cream the active tab used to
 *   wear in the old segment control.
 * - Placement is responsive by class, not by JS breakpoint: in-flow in
 *   the topbar from md up, a fixed bottom bar under it (the original's
 *   mobile behaviour, which is worth keeping on a phone).
 */
export function NavBar({ items, layoutId = "lamp", className }: NavBarProps) {
  const pathname = usePathname();

  const isActive = (url: string) =>
    url === "/dashboard"
      ? pathname === "/dashboard" || pathname === "/"
      : pathname === url || pathname.startsWith(url + "/");

  return (
    <div
      className={cn(
        // Bottom bar under md, in-flow pill inside the topbar from md up.
        "max-md:fixed max-md:bottom-4 max-md:left-1/2 max-md:-translate-x-1/2 max-md:z-[2600]",
        "w-fit",
        className
      )}
    >
      <div className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--panel)]/85 py-1 pl-1.5 pr-1.5 shadow-lg backdrop-blur-lg">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.url);

          return (
            <Link
              key={item.url}
              href={item.url}
              title={item.name}
              aria-label={item.name}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex cursor-pointer items-center justify-center rounded-full px-3 py-2 transition-colors md:px-3.5",
                active
                  ? "text-[var(--text)]"
                  : "text-[color:var(--text-dim)] hover:text-[color:var(--text)]"
              )}
            >
              <Icon size={17} strokeWidth={2} aria-hidden />
              {active && (
                <motion.div
                  layoutId={layoutId}
                  className="absolute inset-0 w-full rounded-full bg-[var(--accent)]/10 -z-10"
                  initial={false}
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  }}
                >
                  {/* The tubelight itself: a short bar on the item's top
                      edge, with the three blur layers that make it glow. */}
                  <div className="absolute -top-px left-1/2 h-0.5 w-7 -translate-x-1/2 rounded-full bg-[var(--accent)]">
                    <div className="absolute -top-2 -left-2 h-6 w-12 rounded-full bg-[var(--accent)]/20 blur-md" />
                    <div className="absolute -top-1 h-6 w-8 rounded-full bg-[var(--accent)]/20 blur-md" />
                    <div className="absolute top-0 left-2 h-4 w-4 rounded-full bg-[var(--accent)]/20 blur-sm" />
                  </div>
                </motion.div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
