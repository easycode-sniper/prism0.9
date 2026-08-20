"use client";

import { useEffect, useState, useMemo } from "react";
import { Copy, Check, Phone, MapPin, Download } from "lucide-react";
import { listDrivers, type DriverCard } from "@/lib/supabase/drivers";
import { normalizeName } from "@/lib/drivers/match";
import { formatDate } from "@/lib/format";

type Filter = "all" | "reachable" | "missing";

export default function DriversPage() {
  const [drivers, setDrivers] = useState<DriverCard[] | null>(null);
  const [filteredOut, setFilteredOut] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listDrivers();
      if (cancelled) return;
      if (res.error) setError(res.error);
      else {
        setDrivers(res.drivers ?? []);
        setFilteredOut(res.filteredOut ?? 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    if (!drivers) return [];
    // Search runs over the normalized name so typing "amrouche" finds
    // "AMROUCHE Taher" regardless of case, and over the address so an
    // operator can find everyone in one town.
    const q = normalizeName(search);
    return drivers.filter((d) => {
      if (filter === "reachable" && !d.phone) return false;
      if (filter === "missing" && d.phone) return false;
      if (!q) return true;
      return (
        normalizeName(d.name).includes(q) ||
        (d.address ? normalizeName(d.address).includes(q) : false) ||
        (d.phone ? d.phone.replace(/\s/g, "").includes(search.replace(/\s/g, "")) : false)
      );
    });
  }, [drivers, search, filter]);

  const withPhone = drivers?.filter((d) => d.phone).length ?? 0;

  function cardText(d: DriverCard): string {
    return [d.name, d.phone ?? "n/a", d.address ?? "n/a"].join(" — ");
  }

  async function copyOne(d: DriverCard) {
    try {
      await navigator.clipboard.writeText(cardText(d));
      setCopiedName(d.name);
      setTimeout(() => setCopiedName((n) => (n === d.name ? null : n)), 2000);
    } catch {
      setError("Could not reach the clipboard");
    }
  }

  async function copyAll() {
    if (!visible.length) return;
    // Tab-separated so it lands in spreadsheet columns, same as Rapport Parc.
    const header = ["Driver", "Phone", "Address"].join("\t");
    const body = visible.map((d) => [d.name, d.phone ?? "n/a", d.address ?? "n/a"].join("\t"));
    try {
      await navigator.clipboard.writeText([header, ...body].join("\n"));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      setError("Could not reach the clipboard — use Download CSV instead");
    }
  }

  function downloadCsv() {
    if (!visible.length) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Driver", "Phone", "Address"].map(esc).join(","),
      ...visible.map((d) => [d.name, d.phone ?? "n/a", d.address ?? "n/a"].map(esc).join(",")),
    ];
    // BOM so Excel reads it as UTF-8 rather than mangling accented names.
    const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drivers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ padding: "24px 28px", height: "100%", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.15rem", fontWeight: 600 }}>Drivers</h2>
          <p className="t-dim" style={{ fontSize: ".85rem", marginTop: "4px" }}>
            {drivers
              ? `${drivers.length} drivers from Wialon · ${withPhone} with a phone number` +
                (filteredOut > 0 ? ` · ${filteredOut} placeholder ${filteredOut === 1 ? "entry" : "entries"} hidden` : "")
              : "Loading from Wialon…"}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={copyAll} disabled={!visible.length} className="btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            {copiedAll ? <Check size={13} /> : <Copy size={13} />}
            {copiedAll ? "Copied" : `Copy ${visible.length}`}
          </button>
          <button onClick={downloadCsv} disabled={!visible.length} className="btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <Download size={13} />
            CSV
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone or town…"
          className="t-primary placeholder-current"
          style={{ maxWidth: "300px", background: "var(--well-bg)", boxShadow: "var(--well-shadow)", border: "none", borderRadius: "11px", padding: "8px 13px", fontSize: ".83rem" }}
        />
        {([
          ["all", "All"],
          ["reachable", "Has phone"],
          ["missing", "No phone"],
        ] as [Filter, string][]).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              background: filter === value ? "var(--accent)" : "var(--well-bg)",
              boxShadow: "var(--well-shadow)",
              color: filter === value ? "var(--bg)" : "var(--text-dim)",
              border: "none",
              borderRadius: "11px",
              padding: "8px 14px",
              fontSize: ".78rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="surface" style={{ padding: "14px 16px", color: "var(--red)", fontSize: ".85rem" }}>
          {error}
        </div>
      )}

      {!error && drivers === null && (
        <div className="t-dim" style={{ fontSize: ".85rem", padding: "24px 0" }}>Loading drivers…</div>
      )}

      {!error && drivers !== null && visible.length === 0 && (
        <div className="surface t-dim" style={{ padding: "28px", textAlign: "center", fontSize: ".85rem" }}>
          No drivers match.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(268px, 1fr))", gap: "12px" }}>
        {visible.map((d) => (
          <div key={d.name} className="glass" style={{ padding: "13px 15px", display: "flex", flexDirection: "column", gap: "9px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: ".88rem", fontWeight: 600, lineHeight: 1.25 }}>{d.name}</div>
                {d.hiredOn && (
                  <div className="t-faint" style={{ fontFamily: "var(--font-mono)", fontSize: ".64rem", marginTop: "3px" }}>
                    since {formatDate(new Date(d.hiredOn))}
                  </div>
                )}
              </div>
              <button
                onClick={() => copyOne(d)}
                title="Copy name, phone and address"
                aria-label={`Copy details for ${d.name}`}
                className="t-dim"
                style={{ flex: "none", background: "transparent", border: "none", cursor: "pointer", padding: "2px", lineHeight: 0 }}
              >
                {copiedName === d.name ? <Check size={14} className="c-green" /> : <Copy size={14} />}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "7px", fontFamily: "var(--font-mono)", fontSize: ".76rem" }}>
              <Phone size={12} className="t-faint" style={{ flex: "none" }} />
              {d.phone ? (
                <a href={d.phoneHref ?? undefined} className="c-cyan" style={{ textDecoration: "none" }}>{d.phone}</a>
              ) : (
                <span className="t-faint">n/a</span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "flex-start", gap: "7px", fontSize: ".74rem" }}>
              <MapPin size={12} className="t-faint" style={{ flex: "none", marginTop: "2px" }} />
              {d.address ? (
                <span className="t-dim" style={{ lineHeight: 1.35 }}>{d.address}</span>
              ) : (
                <span className="t-faint">n/a</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
