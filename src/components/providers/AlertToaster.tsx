"use client";

import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playAlertTone } from "@/lib/sound";
import { metaFor } from "@/lib/notifications/kinds";
import { formatTime } from "@/lib/format";

// Mounted once in the app shell, so an alert reaches the operator on
// whatever page they happen to be on rather than only in the
// notifications tab.
//
// This replaces NotificationSoundListener rather than sitting beside it:
// both would subscribe to the same INSERT stream, and two subscriptions
// means the tone fires twice for one alert.

interface Toast {
  id: string;
  kind: string;
  title: string;
  message: string;
  truckId: string;
  at: string;
}

// Long enough to read a truck ID and a destination without being an
// obstacle. Off-route and speeding stay until dismissed — those are the
// two that warrant interrupting someone.
const DISMISS_AFTER_MS = 8000;
const STICKY_KINDS = new Set(["off_route", "speeding"]);

// A busy minute can insert a dozen arrivals at once. Showing all of them
// would cover the screen, so the stack is capped and the oldest fall off
// — the notifications tab remains the complete record.
const MAX_VISIBLE = 4;

export function AlertToaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const timers: ReturnType<typeof setTimeout>[] = [];

    const channel = supabase
      .channel("notification-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const row = payload.new as {
            id?: string;
            kind?: string;
            title?: string;
            message?: string;
            truck_id?: string;
            created_at?: string;
          };
          if (!row.kind || !row.id) return;

          playAlertTone(row.kind);

          const toast: Toast = {
            id: row.id,
            kind: row.kind,
            title: row.title ?? "Alert",
            message: row.message ?? "",
            truckId: row.truck_id ?? "",
            at: row.created_at ?? new Date().toISOString(),
          };

          setToasts((cur) => [...cur.filter((t) => t.id !== toast.id), toast].slice(-MAX_VISIBLE));

          if (!STICKY_KINDS.has(row.kind)) {
            timers.push(setTimeout(() => dismiss(toast.id), DISMISS_AFTER_MS));
          }
        }
      )
      .subscribe();

    return () => {
      timers.forEach(clearTimeout);
      supabase.removeChannel(channel);
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      // aria-live so a screen reader announces an alert that arrives
      // while the operator is working elsewhere on the page.
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: "16px",
        bottom: "16px",
        zIndex: 4000,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        maxWidth: "min(360px, calc(100vw - 32px))",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => {
        const meta = metaFor(t.kind);
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            className="glass"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "12px 14px",
              pointerEvents: "auto",
              // The one place a coloured edge is worth spending: it makes
              // the kind readable before the text is.
              borderLeft: `3px solid ${meta.color}`,
            }}
          >
            <Icon size={16} strokeWidth={2} color={meta.color} style={{ flex: "none", marginTop: "2px" }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span style={{ fontSize: ".85rem", fontWeight: 600 }}>{t.title}</span>
                {t.truckId && (
                  <span className="c-cyan" style={{ fontFamily: "var(--font-mono)", fontSize: ".72rem" }}>
                    {t.truckId}
                  </span>
                )}
              </div>
              <p className="t-dim" style={{ fontSize: ".78rem", margin: "3px 0 0", lineHeight: 1.35 }}>
                {t.message}
              </p>
              <span className="t-faint" style={{ fontFamily: "var(--font-mono)", fontSize: ".66rem" }}>
                {formatTime(t.at)}
              </span>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="t-faint"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px", lineHeight: 0, flex: "none" }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
