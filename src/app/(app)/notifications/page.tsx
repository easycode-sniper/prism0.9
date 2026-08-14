"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  NotificationRecord,
} from "@/lib/supabase/history";

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const result = await getNotifications();
    setNotifications(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleMarkRead(id: string) {
    await markNotificationRead(id);
    loadData();
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    loadData();
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading notifications...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Notifications</h1>
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

      {error && <div className="mt-4 rounded-md bg-red-900/50 p-3 text-sm text-red-300">{error}</div>}

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
                <span className="mt-1 text-xs text-gray-600">{new Date(n.created_at).toLocaleString()}</span>
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
  const icons: Record<NotificationRecord["kind"], string> = {
    off_route: "🔴",
    speeding: "🟠",
    site_arrival: "🟢",
    factory_arrival: "🟣",
  };
  return <span className="text-sm">{icons[kind]}</span>;
}
