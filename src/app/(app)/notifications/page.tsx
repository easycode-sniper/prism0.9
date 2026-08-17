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
          <h1 className="text-2xl font-semibold text-white">{t("notifications.title")}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="mt-8 text-center text-sm text-gray-500">No notifications yet.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.read && handleMarkRead(n.id)}
              className={`flex items-start gap-3 rounded-lg border p-4 transition ${
                n.read
                  ? "border-gray-800 bg-gray-900/30"
                  : "border-indigo-900/50 bg-gray-900/70 cursor-pointer hover:bg-gray-800/70"
              }`}
            >
              <div className="mt-0.5">
                <NotificationIcon kind={n.kind} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{n.title}</span>
                  <span className="font-mono text-xs text-cyan-400">{n.truck_id}</span>
                </div>
                <p className="mt-0.5 text-sm text-gray-400">{n.message}</p>
                <span className="mt-1 text-xs text-gray-600">{formatDateTime(n.created_at)}</span>
              </div>
              {!n.read && (
                <div className="mt-1 h-2 w-2 rounded-full bg-indigo-500" />
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
    off_route: { icon: TriangleAlert, color: "#f87171" },
    speeding: { icon: Gauge, color: "#fb923c" },
    site_arrival: { icon: Flag, color: "#4ade80" },
    factory_arrival: { icon: Factory, color: "#a855f7" },
    hq_arrival: { icon: ParkingCircle, color: "#22d3ee" },
  };
  const { icon: Icon, color } = config[kind];
  return <Icon size={16} strokeWidth={2.25} color={color} />;
}
