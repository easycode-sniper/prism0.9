"use client";

import { useMemo, useState } from "react";
import {
  markNotificationRead,
  markAllNotificationsRead,
  NotificationRecord,
} from "@/lib/supabase/history";
import { useFleet } from "@/components/providers/FleetProvider";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { formatDateTime } from "@/lib/format";
import {
  metaFor,
  groupFor,
  GROUP_ORDER,
  GROUP_LABEL,
  type NotificationGroup,
} from "@/lib/notifications/kinds";

export default function NotificationsPage() {
  const { t } = useTranslation();
  // Shared app-wide (already realtime-subscribed by FleetProvider)
  // instead of this page fetching its own copy on every visit.
  const { notifications, refreshNotifications } = useFleet();
  const [only, setOnly] = useState<NotificationGroup | "all">("all");

  async function handleMarkRead(id: string) {
    await markNotificationRead(id);
    refreshNotifications();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    refreshNotifications();
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Grouped by where the truck is, not by severity: a parc entry, a
  // factory load and a client delivery are different jobs to different
  // people, and mixing them into one stream is what made the feed hard
  // to scan. Order within a group stays newest-first, as it arrives.
  const grouped = useMemo(() => {
    const map = new Map<NotificationGroup, NotificationRecord[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const n of notifications) map.get(groupFor(n.kind))!.push(n);
    return map;
  }, [notifications]);

  const visibleGroups = GROUP_ORDER.filter(
    (g) => (only === "all" || only === g) && (grouped.get(g)?.length ?? 0) > 0
  );

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold t-primary">{t("notifications.title")}</h1>
          <p className="mt-1 text-sm t-dim">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="rounded-md border bd px-3 py-1.5 text-sm t-primary transition bg-raised-hover"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <GroupChip label="All" active={only === "all"} count={notifications.length} onClick={() => setOnly("all")} />
        {GROUP_ORDER.map((g) => {
          const items = grouped.get(g) ?? [];
          if (items.length === 0) return null;
          return (
            <GroupChip
              key={g}
              label={GROUP_LABEL[g]}
              active={only === g}
              count={items.length}
              unread={items.filter((n) => !n.read).length}
              onClick={() => setOnly(g)}
            />
          );
        })}
      </div>

      {notifications.length === 0 ? (
        <p className="mt-8 text-center text-sm t-dim">No notifications yet.</p>
      ) : visibleGroups.length === 0 ? (
        <p className="mt-8 text-center text-sm t-dim">Nothing in this group.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {visibleGroups.map((g) => {
            const items = grouped.get(g)!;
            const unread = items.filter((n) => !n.read).length;
            return (
              <section key={g}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider t-dim">
                    {GROUP_LABEL[g]}
                  </h2>
                  <span className="font-mono text-xs t-faint">
                    {items.length}
                    {unread > 0 ? ` · ${unread} new` : ""}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((n) => (
                    <NotificationRow key={n.id} n={n} onMarkRead={handleMarkRead} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupChip({
  label,
  active,
  count,
  unread = 0,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  unread?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`seg-item${active ? " is-active" : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: ".78rem" }}
    >
      {label}
      <span className="font-mono" style={{ opacity: 0.7, fontSize: ".7rem" }}>
        {unread > 0 ? unread : count}
      </span>
    </button>
  );
}

function NotificationRow({
  n,
  onMarkRead,
}: {
  n: NotificationRecord;
  onMarkRead: (id: string) => void;
}) {
  const meta = metaFor(n.kind);
  const Icon = meta.icon;

  return (
    <div
      onClick={() => !n.read && onMarkRead(n.id)}
      className={`flex items-start gap-3 rounded-lg border p-4 transition ${
        n.read ? "bd bg-panel/30" : "bd bg-panel cursor-pointer bg-raised-hover"
      }`}
    >
      <div className="mt-0.5">
        <Icon size={16} strokeWidth={2} color={meta.color} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium t-primary">{n.title}</span>
          <span className="font-mono text-xs c-cyan">{n.truck_id}</span>
        </div>
        <p className="mt-0.5 text-sm t-dim">{n.message}</p>
        <span className="mt-1 text-xs t-faint">{formatDateTime(n.created_at)}</span>
      </div>
      {!n.read && (
        <div className="mt-1 h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
      )}
    </div>
  );
}
