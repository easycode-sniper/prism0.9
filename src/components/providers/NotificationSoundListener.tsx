"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { playAlertTone, type AlertKind } from "@/lib/sound";

// Mounted once at the app shell. Plays a generated tone whenever a new
// notification row is inserted, regardless of which page the user is on.
export function NotificationSoundListener() {
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notification-sound-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const kind = (payload.new as { kind?: AlertKind }).kind;
          if (kind) playAlertTone(kind);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
