"use client";

import { useEffect, useState } from "react";
import { useFleet } from "@/components/providers/FleetProvider";
import { formatTime } from "@/lib/format";
import { formatDuration } from "@/lib/geometry";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { feedAgeSeconds, feedHealth, type FeedHealth } from "@/lib/fleet/freshness";

export function OperationsStrip() {
  const { fleetData, activeRuns, offRouteCount } = useFleet();
  const { t } = useTranslation();

  // ── The strip has to keep its own time ──
  //
  // It would be cheaper to let FleetProvider's 60-second poll re-render
  // this, and most of the time that is what happens. But the thing being
  // measured is whether that feed is still arriving, and an indicator
  // that only updates when its subject updates cannot report its
  // subject's absence: if the poll stalls — a thrown read, a socket that
  // never reconnects, a tab that came back from the background — the
  // strip would freeze on whatever it last said, which is the failure
  // being fixed. So it ticks on its own clock, independent of the feed.
  //
  // 30 seconds is half the smallest band (3 minutes) it has to resolve.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const health = feedHealth(fleetData.lastUpdated, fleetData.error, now);
  const ageSeconds = feedAgeSeconds(fleetData.lastUpdated, now);

  // Amber is already "idle, stale" in the palette and red is already
  // what this strip spends on a tracking error, so neither band invents
  // a meaning. Nothing here is a vehicle state, which is why "paused" —
  // a feed that has never run — stays achromatic.
  const STATUS: Record<FeedHealth, { label: string; colour: string }> = {
    error: { label: t("Live tracking error"), colour: "var(--red)" },
    down: { label: t("Live tracking down"), colour: "var(--red)" },
    stale: { label: t("Live tracking stale"), colour: "var(--amber)" },
    live: { label: t("Live tracking active"), colour: "var(--green)" },
    paused: { label: t("Live tracking paused"), colour: "var(--text-dim)" },
  };
  const { label: statusLabel, colour: dotColor } = STATUS[health];

  // The age is spelled out the moment the feed is not fresh. A bare
  // "16:53" is the thing that hid a seventeen-hour outage: it is only
  // alarming if you happen to know what time it is now, and at a glance
  // nobody does.
  const lastUpdateText = fleetData.lastUpdated
    ? health === "live" || ageSeconds == null
      ? formatTime(fleetData.lastUpdated)
      : `${formatTime(fleetData.lastUpdated)} · ${t("{age} ago", { age: formatDuration(ageSeconds) })}`
    : t("Not yet synced");

  return (
    <div id="operations-strip" aria-label={t("Operational status")}>
      <div
        className="glass ops-pill"
        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        // Announced, because a colour change alone reaches nobody who
        // cannot see it and nobody who is not looking at that corner.
        role="status"
        title={
          health === "stale" || health === "down"
            ? t("The fleet feed has not been updated for {age}.", { age: formatDuration(ageSeconds ?? 0) })
            : undefined
        }
      >
        <span className="ops-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: dotColor, boxShadow: `0 0 0 3px ${dotColor}2b` }}></span>
        <span>{statusLabel}</span>
      </div>
      <div className="glass ops-pill">
        {t("Active runs")} <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>{activeRuns}</strong>
      </div>
      <div className="glass ops-pill">
        {t("Off route")} <strong style={{ color: offRouteCount > 0 ? 'var(--red)' : 'var(--text)', fontSize: '.78rem' }}>{offRouteCount}</strong>
      </div>
      <div className="glass ops-pill">
        {t("Last update")}{" "}
        <strong style={{ color: health === "live" ? 'var(--text)' : dotColor, fontSize: '.78rem' }}>
          {lastUpdateText}
        </strong>
      </div>
    </div>
  );
}
