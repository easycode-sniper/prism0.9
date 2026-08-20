"use client";

import {
  markNotificationRead,
  markAllNotificationsRead,
  NotificationRecord,
} from "@/lib/supabase/history";
import { useFleet } from "@/components/providers/FleetProvider";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { TriangleAlert, Gauge, Flag, Factory, ParkingCircle } from "lucide-react";
import { formatDateTime } from "@/lib/format";

export default function NotificationsPage() {
  const { t } = useTranslation();
  // Shared app-wide (already realtime-subscribed by FleetProvider)
  // instead of this page fetching its own copy on every visit.
  const { notifications, refreshNotifications } = useFleet();

  async function handleMarkRead(id: string) {
    await markNotificationRead(id);
    refreshNotifications();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    refreshNotifications();
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

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

      {notifications.length === 0 ? (
        <p className="mt-8 text-center text-sm t-dim">No notifications yet.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read && handleMarkRead(n.id)}
              className={`flex items-start gap-3 rounded-lg border p-4 transition ${
                n.read
                  ? "bd bg-panel/30"
                  : "bd bg-panel cursor-pointer bg-raised-hover"
              }`}
            >
              <div className="mt-0.5">
                <NotificationIcon kind={n.kind} />
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
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationIcon({ kind }: { kind: NotificationRecord["kind"] }) {
  const config: Record<NotificationRecord["kind"], { icon: typeof TriangleAlert; color: string }> = {
    off_route: { icon: TriangleAlert, color: "var(--red)" },
    speeding: { icon: Gauge, color: "var(--amber)" },
    site_arrival: { icon: Flag, color: "var(--green)" },
    factory_arrival: { icon: Factory, color: "var(--pink)" },
    hq_arrival: { icon: ParkingCircle, color: "var(--cyan)" },
  };
  const { icon: Icon, color } = config[kind];
  return <Icon size={16} strokeWidth={2} color={color} />;
}
