"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { listClientSites, createClientSite, deleteClientSite, type ClientSite } from "@/lib/supabase/sites";
import { ChevronLeft, Building2, Trash2, Plus, MapPin, Crosshair } from "lucide-react";

export default function AdminSitesPage() {
  const [sites, setSites] = useState<ClientSite[]>([]);
  const [loading, setLoading] = useState(true);

  const [client, setClient] = useState("");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Sites aren't in FleetProvider (unlike gas stations, which the map and
  // the dashboard both read every poll), so this page loads its own copy.
  const reload = useCallback(async () => {
    const { data, error: listError } = await listClientSites();
    if (listError) setError(listError);
    else setSites(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.client ?? "").toLowerCase().includes(q)
    );
  }, [sites, search]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setSaving(true);

    const result = await createClientSite({ client, name, lat, lng });
    if (result.error) { setError(result.error); setSaving(false); return; }

    setSuccess(`${result.site!.name} added — it can be dispatched to now.`);
    setClient(""); setName(""); setLat(""); setLng("");
    setSaving(false);
    await reload();
  }

  async function handleDelete(id: string, siteName: string) {
    if (!window.confirm(`Remove ${siteName} from the client list?`)) return;
    setError(null); setSuccess(null); setRemoving(id);

    const result = await deleteClientSite(id);
    if (result.error) { setError(result.error); setRemoving(null); return; }

    setRemoving(null);
    await reload();
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-5">
      <div>
        <Link href="/admin" className="btn-sm mb-3">
          <ChevronLeft size={13} strokeWidth={2.5} /> Admin
        </Link>
        <h1 className="text-2xl font-semibold t-primary flex items-center gap-2">
          <Building2 size={20} strokeWidth={2} style={{ color: "var(--pink)" }} />
          Clients &amp; sites
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
          Where trucks deliver. A site becomes selectable when dispatching,
          and its coordinates are what the arrival and &ldquo;arriving
          shortly&rdquo; alerts measure against. Click a site to see where it
          sits.
        </p>
      </div>

      {error && (
        <div className="rounded-md p-3 text-sm" style={{ background: "rgba(255,45,63,0.08)", border: "1px solid rgba(255,45,63,0.35)", color: "var(--red)" }}>{error}</div>
      )}
      {success && (
        <div className="rounded-md p-3 text-sm" style={{ background: "rgba(0,255,123,0.08)", border: "1px solid rgba(0,255,123,0.22)", color: "var(--green)" }}>{success}</div>
      )}

      <form onSubmit={handleAdd} className="panel p-5">
        <div className="section-label mb-3">
          <span className="step-badge"><Plus size={11} strokeWidth={3} /></span>
          Add a client site
        </div>

        <fieldset disabled={saving} className="grid gap-3" style={{ border: "none", padding: 0, margin: 0 }}>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Client name</span>
            <input
              className="field"
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="e.g. SARL ZIRAKAM BETON"
            />
          </label>

          <label className="block">
            <span className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Location</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ZIRAKAM Aïn Oussara"
            />
          </label>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Latitude</span>
              <input
                className="field"
                inputMode="decimal"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="35.4310875"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </label>
            <label className="block">
              <span className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Longitude</span>
              <input
                className="field"
                inputMode="decimal"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="2.9249219"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </label>
          </div>

          <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-faint)" }}>
            <MapPin size={11} strokeWidth={2} />
            Decimal degrees. In Google Maps, right-click the site and the first
            number is latitude.
          </p>

          <button type="submit" className="btn-brand" style={{ justifySelf: "start" }}>
            {saving ? "Adding…" : "Add client site"}
          </button>
        </fieldset>
      </form>

      <div className="panel p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <div className="section-label" style={{ margin: 0 }}>Client list</div>
          <span className="psection__count">{visible.length} of {sites.length}</span>
        </div>

        <input
          className="field mb-3"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search client or location..."
        />

        {loading ? (
          <div className="skeleton-stack" role="status" aria-label="Loading sites">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton skeleton--row" aria-hidden="true" />
            ))}
          </div>
        ) : sites.length === 0 ? (
          <p className="panel-empty">No clients yet. Add the first one above.</p>
        ) : visible.length === 0 ? (
          <p className="panel-empty">No client matches that search.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: "420px" }}>
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Location</th>
                  <th>Latitude</th>
                  <th>Longitude</th>
                  <th style={{ width: "1%" }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id}>
                    <td style={{ color: "var(--text-dim)" }}>{s.client ?? "—"}</td>
                    <td style={{ padding: 0 }}>
                      {/* Reuses the same focus route Monitoring's Locate uses:
                          the dispatch map reads ?lat/?lng and setViews there at
                          zoom 13. Embedding a second map here is not an option —
                          MapView holds a module-level singleton Leaflet
                          instance, so mounting it twice would move the map out
                          of the dispatch page rather than clone it. */}
                      {s.lat != null && s.lng != null ? (
                        <Link
                          href={`/dispatch?lat=${s.lat}&lng=${s.lng}`}
                          className="station-locate"
                          title={`Show ${s.name} on the map`}
                        >
                          <Crosshair size={12} strokeWidth={2} className="station-locate__icon" />
                          <span>{s.name}</span>
                        </Link>
                      ) : (
                        <span style={{ padding: "0 16px" }}>{s.name}</span>
                      )}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: ".78rem", color: "var(--text-dim)" }}>
                      {s.lat != null ? s.lat.toFixed(6) : "—"}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: ".78rem", color: "var(--text-dim)" }}>
                      {s.lng != null ? s.lng.toFixed(6) : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id, s.name)}
                        disabled={removing === s.id}
                        className="btn-sm danger"
                        aria-label={`Remove ${s.name}`}
                      >
                        <Trash2 size={12} strokeWidth={2} />
                        {removing === s.id ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
