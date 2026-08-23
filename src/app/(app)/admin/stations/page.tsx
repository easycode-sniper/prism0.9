"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createGasStation, deleteGasStation } from "@/lib/supabase/stations";
import { useFleet } from "@/components/providers/FleetProvider";
import { ChevronLeft, Fuel, Trash2, Plus, MapPin, Crosshair } from "lucide-react";

export default function AdminStationsPage() {
  const { gasStations, refreshGasStations } = useFleet();

  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return gasStations;
    return gasStations.filter((s) => s.name.toLowerCase().includes(q));
  }, [gasStations, search]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setSaving(true);

    const result = await createGasStation(name, lat, lng);
    if (result.error) { setError(result.error); setSaving(false); return; }

    setSuccess(`${result.station!.name} added — it is on the map now.`);
    setName(""); setLat(""); setLng("");
    setSaving(false);
    await refreshGasStations();
  }

  async function handleDelete(id: string, stationName: string) {
    // Removing a pump changes what the fuel-stop analysis counts, so it
    // asks first rather than treating the row like a UI element.
    if (!window.confirm(`Remove ${stationName} from the station list?`)) return;
    setError(null); setSuccess(null); setRemoving(id);

    const result = await deleteGasStation(id);
    if (result.error) { setError(result.error); setRemoving(null); return; }

    setRemoving(null);
    await refreshGasStations();
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-5">
      <div>
        <Link href="/admin" className="btn-sm mb-3">
          <ChevronLeft size={13} strokeWidth={2.5} /> Admin
        </Link>
        <h1 className="text-2xl font-semibold t-primary flex items-center gap-2">
          <Fuel size={20} strokeWidth={2} style={{ color: "var(--cyan)" }} />
          Gas stations
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
          Stations plot on the map and drive the dashboard&rsquo;s fuel-stop
          analysis, which counts a truck as fuelling within 150 m of one.
          Click a station to see where it sits.
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
          Add a station
        </div>

        <fieldset disabled={saving} className="grid gap-3" style={{ border: "none", padding: 0, margin: 0 }}>
          <label className="block">
            <span className="block text-xs mb-1" style={{ color: "var(--text-dim)" }}>Station name</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GD BECHLOUL NORD"
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
                placeholder="36.3115083"
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
                placeholder="4.064975"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </label>
          </div>

          <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--text-faint)" }}>
            <MapPin size={11} strokeWidth={2} />
            Decimal degrees. In Google Maps, right-click the pump and the first
            number is latitude.
          </p>

          <button type="submit" className="btn-brand" style={{ justifySelf: "start" }}>
            {saving ? "Adding…" : "Add station"}
          </button>
        </fieldset>
      </form>

      <div className="panel p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <div className="section-label" style={{ margin: 0 }}>Station list</div>
          <span className="psection__count">{visible.length} of {gasStations.length}</span>
        </div>

        <input
          className="field mb-3"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search stations..."
        />

        {gasStations.length === 0 ? (
          <p className="panel-empty">No stations yet. Add the first one above.</p>
        ) : visible.length === 0 ? (
          <p className="panel-empty">No station matches that search.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: "420px" }}>
            <table>
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Latitude</th>
                  <th>Longitude</th>
                  <th style={{ width: "1%" }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.id}>
                    <td style={{ padding: 0 }}>
                      {/* Reuses the same focus route Monitoring's Locate uses:
                          the dispatch map reads ?lat/?lng and setViews there at
                          zoom 13. Embedding a second map here is not an option —
                          MapView holds a module-level singleton Leaflet
                          instance, so mounting it twice would move the map out
                          of the dispatch page rather than clone it. */}
                      <Link
                        href={`/dispatch?lat=${s.lat}&lng=${s.lng}`}
                        className="station-locate"
                        title={`Show ${s.name} on the map`}
                      >
                        <Crosshair size={12} strokeWidth={2} className="station-locate__icon" />
                        <span>{s.name}</span>
                      </Link>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: ".78rem", color: "var(--text-dim)" }}>{s.lat.toFixed(6)}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: ".78rem", color: "var(--text-dim)" }}>{s.lng.toFixed(6)}</td>
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
