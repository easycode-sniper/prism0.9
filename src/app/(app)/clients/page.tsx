"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle } from "lucide-react";
import { listClients, type ClientRecord } from "@/lib/supabase/clients";
import { isOpenAt, hoursLabel } from "@/lib/clientHours";
import { useTranslation } from "@/lib/i18n/I18nProvider";

type Filter = "all" | "open" | "24h" | "friday" | "nophone" | "nosite";
const FILTERS: Filter[] = ["all", "open", "24h", "friday", "nophone", "nosite"];

export default function ClientsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ClientRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Ticks once a minute so "open now" does not go stale on a screen left
  // up all shift — the same reason the fleet pages poll.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listClients();
      if (cancelled) return;
      if (res.error) setError(res.error);
      else setRows(res.data);
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (q) {
        const hay = [c.name, c.clientCode, c.siteName, c.rep, ...c.phones]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === "open") return isOpenAt(c, now) === true;
      if (filter === "24h") return c.is24h === true;
      if (filter === "friday") return c.fridayExcluded === true;
      if (filter === "nophone") return c.phones.length === 0;
      if (filter === "nosite") return c.siteId == null;
      return true;
    });
  }, [rows, search, filter, now]);

  const openCount = useMemo(
    () => (rows ?? []).filter((c) => isOpenAt(c, now) === true).length,
    [rows, now]
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold t-primary">{t("clients.title")}</h1>
          <p className="text-xs t-dim">{t("Every delivery point, who to call and when it is open")}</p>
        </div>
        <span className="font-mono text-sm" style={{ color: "var(--text-dim)" }}>
          {filtered.length} / {rows?.length ?? 0}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          placeholder={t("Search client, site, phone or rep…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border bd bg-raised px-3 py-1.5 text-sm t-primary placeholder-current focus:border-[var(--accent)] focus:outline-none"
          style={{ maxWidth: "320px" }}
        />
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn-sm ${filter === f ? "is-on" : ""}`}
          >
            {t(`clients.filter.${f}`)}
          </button>
        ))}
        <span className="cl-openflag">{t("{n} open now", { n: openCount })}</span>
      </div>

      {error && (
        <div className="surface mt-4" style={{ padding: "14px 16px", color: "var(--red)", fontSize: ".85rem" }}>
          {error}
        </div>
      )}

      {!error && rows === null && (
        <div className="skeleton-stack mt-4" role="status" aria-label={t("Loading clients")}>
          {Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton skeleton--row" aria-hidden="true" />)}
        </div>
      )}

      {rows !== null && (
        <div className="mt-4 overflow-hidden rounded-lg border bd">
          <div className="table-wrap--capped" style={{ overflowX: "auto" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-panel">
                <tr className="border-b bd bg-panel text-left text-xs uppercase t-dim">
                  <th className="px-3 py-2">{t("Client")}</th>
                  <th className="px-3 py-2">{t("Delivery point")}</th>
                  <th className="px-3 py-2">{t("Hours")}</th>
                  <th className="px-3 py-2">{t("Phone")}</th>
                  <th className="px-3 py-2">{t("Rep")}</th>
                  <th className="px-3 py-2 text-right">{t("km")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-token">
                {filtered.map((c) => <ClientRow key={c.id} client={c} now={now} />)}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm t-dim">{t("No clients match.")}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ClientRow({ client: c, now }: { client: ClientRecord; now: Date }) {
  const { t } = useTranslation();
  const open = isOpenAt(c, now);
  const label = hoursLabel(c);

  return (
    <tr className="text-sm bg-raised-hover">
      <td className="px-3 py-2">
        <div className="cl-name" title={c.name}>{c.name}</div>
        <ClientCode code={c.clientCode} />
      </td>
      <td className="px-3 py-2 t-dim">
        <SiteCell name={c.siteName} siteId={c.siteId} t={t} />
      </td>
      <td className="px-3 py-2" style={{ whiteSpace: "nowrap" }}>
        <HoursCell label={label} open={open} fridayExcluded={c.fridayExcluded} raw={c.hoursRaw} t={t} />
      </td>
      <td className="px-3 py-2">
        <PhoneCell phones={c.phones} note={c.phoneNote} />
      </td>
      <td className="px-3 py-2 t-dim cl-rep" title={c.rep ?? undefined}>{c.rep ?? "—"}</td>
      <td className="px-3 py-2 text-right t-dim" style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {c.distanceKm != null ? Math.round(c.distanceKm).toLocaleString("en-GB") : "—"}
      </td>
      <td className="px-3 py-2 text-right" style={{ whiteSpace: "nowrap" }}>
        <LocateLink lat={c.lat} lng={c.lng} t={t} />
      </td>
    </tr>
  );
}

/* Each of these is a component rather than an inline && beside its
   siblings — a bare conditional text node in a row that re-renders every
   minute is the shape that broke every page for the French Chrome user. */
/* Same destination and wording as the monitoring table's Locate, so the
   two mean the same thing: open the dispatch map on this point. Absent
   for the delivery points with no site row — there is no coordinate to
   send it to, and a dead link is worse than no link. */
function LocateLink({ lat, lng, t }: { lat: number | null; lng: number | null; t: (k: string) => string }) {
  if (lat == null || lng == null) return null;
  return (
    <Link href={`/dispatch?lat=${lat}&lng=${lng}`} className="text-xs c-accent hover:opacity-80">
      {t("Locate")}
    </Link>
  );
}

function ClientCode({ code }: { code: string | null }) {
  if (!code) return null;
  return <div className="cl-code">{code}</div>;
}

function SiteCell({ name, siteId, t }: { name: string | null; siteId: string | null; t: (k: string) => string }) {
  if (!name) return <span>—</span>;
  if (siteId) return <span className="cl-site" title={name}>{name}</span>;
  // 8 of the 130 delivery points have no site record, so no geofence and
  // no arrival detection. That is worth showing rather than hiding.
  return (
    <span className="cl-site cl-site--unlinked" title={t("No geofenced site for this delivery point yet")}>
      {name}
    </span>
  );
}

function HoursCell({
  label, open, fridayExcluded, raw, t,
}: {
  label: string | null; open: boolean | null; fridayExcluded: boolean | null;
  raw: string | null; t: (k: string) => string;
}) {
  if (!label) return <span className="t-faint" title={raw ?? undefined}>{t("not recorded")}</span>;
  return (
    <span className="cl-hours" title={raw ?? undefined}>
      <OpenDot open={open} />
      <span className={open === false ? "t-faint" : "t-primary"}>{label}</span>
      <FridayTag excluded={fridayExcluded} t={t} />
    </span>
  );
}

/* Cream ramp, not a hue. Whether a client's gate is open is not one of
   the five vehicle states, and spending a colour on it here would make a
   coloured pixel mean something other than a truck. */
function OpenDot({ open }: { open: boolean | null }) {
  if (open === null) return null;
  return <span className={`cl-dot${open ? " is-open" : ""}`} aria-hidden="true" />;
}

function FridayTag({ excluded, t }: { excluded: boolean | null; t: (k: string) => string }) {
  if (!excluded) return null;
  return <span className="cl-fri">{t("Fri excl.")}</span>;
}

function PhoneCell({ phones, note }: { phones: string[]; note: string | null }) {
  if (phones.length === 0) return <span className="t-faint">—</span>;
  return (
    <span className="cl-phones">
      {phones.map((p) => (
        <a key={p} href={`tel:${p}`} className="cl-phone">
          <Phone size={11} strokeWidth={2} aria-hidden="true" />
          {p}
        </a>
      ))}
      <WhatsAppTag note={note} phone={phones[0]} />
    </span>
  );
}

function WhatsAppTag({ note, phone }: { note: string | null; phone: string }) {
  if (note !== "whatsapp") return null;
  return (
    <a className="cl-phone" href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">
      <MessageCircle size={11} strokeWidth={2} aria-hidden="true" />
      WhatsApp
    </a>
  );
}
