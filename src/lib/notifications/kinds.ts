import { TriangleAlert, Gauge, Flag, Timer, Factory, ParkingCircle } from "lucide-react";

// One description of what each alert kind is, used by the feed, the
// toast and the chart. These had drifted apart: the notifications page
// knew five kinds, the sound module knew four (parc arrivals — the most
// common alert in the system — played nothing at all), and the dashboard
// chart kept its own colour list.

export type NotificationKind =
  | "off_route"
  | "speeding"
  | "site_approaching"
  | "site_arrival"
  | "factory_arrival"
  | "hq_arrival";

/**
 * Which section of the feed a kind belongs to.
 *
 * Destination-based rather than severity-based, because that is how the
 * work is organised: a truck is either coming back to the parc, going to
 * the factory to load, or out at a client. Route and speed alerts belong
 * to none of those — they can happen anywhere on a run — so they get
 * their own section rather than being forced into one.
 */
export type NotificationGroup = "parc" | "factory" | "client" | "alerts";

export const GROUP_ORDER: NotificationGroup[] = ["parc", "factory", "client", "alerts"];

export const GROUP_LABEL: Record<NotificationGroup, string> = {
  parc: "Parc",
  factory: "Factory",
  client: "Client",
  alerts: "Route & speed",
};

interface KindMeta {
  icon: typeof TriangleAlert;
  /** Resolves through the design tokens; colour is taxonomy here, not
   *  decoration — see CLAUDE.md. */
  color: string;
  group: NotificationGroup;
}

export const KIND_META: Record<NotificationKind, KindMeta> = {
  off_route: { icon: TriangleAlert, color: "var(--red)", group: "alerts" },
  speeding: { icon: Gauge, color: "var(--amber)", group: "alerts" },
  site_approaching: { icon: Timer, color: "var(--amber)", group: "client" },
  site_arrival: { icon: Flag, color: "var(--green)", group: "client" },
  factory_arrival: { icon: Factory, color: "var(--pink)", group: "factory" },
  hq_arrival: { icon: ParkingCircle, color: "var(--cyan)", group: "parc" },
};

/** Unknown kinds are possible — a row written by a newer deploy, read by
 *  an older tab — so callers get a usable fallback rather than a crash
 *  on an undefined lookup. */
export function metaFor(kind: string): KindMeta {
  return KIND_META[kind as NotificationKind] ?? KIND_META.off_route;
}

export function groupFor(kind: string): NotificationGroup {
  return metaFor(kind).group;
}
