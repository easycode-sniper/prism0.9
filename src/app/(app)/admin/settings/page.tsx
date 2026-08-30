"use client";

import { useState, useEffect } from "react";
import { adminGetSettings, adminSaveSettings, adminProbeWialonZones } from "@/lib/supabase/admin-actions";
import type { AppSettings } from "@/lib/supabase/admin-actions";
import type { WialonResourceShape } from "@/lib/fleet/wialon";

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [relay, setRelay] = useState("");
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [probe, setProbe] = useState<WialonResourceShape[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  async function runProbe() {
    setProbing(true);
    setProbeError(null);
    const res = await adminProbeWialonZones();
    setProbing(false);
    if (res.error) { setProbeError(res.error); return; }
    setProbe(res.resources);
  }

  useEffect(() => {
    loadSettings();
  }, []);

  // Same trap as the users page: the component early-returns a skeleton
  // while `loading`, so re-reading after a save blanked the form the
  // operator had just filled in. The skeleton is for the first load.
  async function loadSettings(silent = false) {
    if (!silent) setLoading(true);
    const result = await adminGetSettings();
    if (result.data) {
      setSettings(result.data);
      setRelay(result.data.wialon_relay);
      setServer(result.data.wialon_server);
      setToken(result.data.wialon_token_set ? "••••••••••••" : "");
    }
    setError(result.error);
    if (!silent) setLoading(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    // Don't send masked token if unchanged
    const tokenToSend = token === "••••••••••••" ? "" : token;

    const result = await adminSaveSettings(relay, server, tokenToSend);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess("Settings saved");
      await loadSettings(true);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div style={{ padding: "24px 28px", maxWidth: "640px" }}>
        <div className="skeleton skeleton--line" style={{ width: "160px", marginBottom: "18px" }} />
        <div className="skeleton-stack" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: "44px" }} />
          ))}
        </div>
        <span className="sr-only" role="status">Loading settings</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold t-primary">Application Settings</h1>
      <p className="mt-1 text-sm t-dim">Configure Wialon connection parameters.</p>

      {error && <div className="mt-4 rounded-md tint-red p-3 text-sm c-red">{error}</div>}
      {success && <div className="mt-4 rounded-md tint-green p-3 text-sm c-green">{success}</div>}

      <form onSubmit={handleSave} className="mt-6 space-y-6">
        <div className="rounded-lg border bd bg-panel p-6">
          <h2 className="text-lg font-medium t-primary">Wialon Connection</h2>

          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="relay" className="block text-sm font-medium t-primary">
                Relay URL
              </label>
              <input id="relay" type="text" value={relay}
                onChange={(e) => setRelay(e.target.value)}
                className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
                placeholder="https://your-relay.workers.dev" />
              <p className="mt-1 text-xs t-dim">Cloudflare Worker that bypasses CORS</p>
            </div>

            <div>
              <label htmlFor="server" className="block text-sm font-medium t-primary">
                Wialon Server
              </label>
              <input id="server" type="text" value={server}
                onChange={(e) => setServer(e.target.value)}
                className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
                placeholder="hst-api.wialon.eu" />
            </div>

            <div>
              <label htmlFor="token" className="block text-sm font-medium t-primary">
                API Token
              </label>
              <input id="token" type="password" value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
                placeholder="Leave blank to keep existing" />
              <p className="mt-1 text-xs t-dim">
                {settings?.wialon_token_set ? "Token is set. Enter a new one to change." : "No token set."}
              </p>
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="btn-primary" style={{ width: "auto" }}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>

      {/* Read-only diagnostic. Answers whether Wialon's geofences already
          arrive in the resource search the Drivers page runs — the flags
          it asks for should already include them — before any import is
          built on the assumption. Writes nothing. */}
      <div className="rounded-lg border bd bg-panel p-6 mt-6">
        <h2 className="text-lg font-medium t-primary">Geofences in Wialon</h2>
        <p className="mt-1 text-sm t-dim">
          Reports what the account&rsquo;s resources actually carry. Nothing is imported or
          changed — this is here so the import can be written against the real shape.
        </p>

        <button type="button" onClick={runProbe} disabled={probing}
          className="btn-sm mt-4" style={{ width: "auto" }}>
          {probing ? "Reading…" : "Check for zones"}
        </button>

        {probeError && <div className="mt-3 rounded-md tint-red p-3 text-sm c-red">{probeError}</div>}

        {probe && (
          <div className="mt-4 space-y-4">
            {probe.length === 0 && <p className="text-sm t-dim">No resources came back.</p>}
            {probe.map((r) => (
              <div key={r.resourceName} className="rounded-md border bd p-3">
                <div className="text-sm t-primary font-medium">{r.resourceName}</div>
                <div className="mt-1 text-sm" style={{ color: r.zoneCount > 0 ? "var(--green)" : "var(--text-dim)" }}>
                  {r.zoneCount > 0 ? `${r.zoneCount} zones` : "no zones in this response"}
                  {r.sampleZoneName ? ` · e.g. ${r.sampleZoneName}` : ""}
                </div>
                {r.sampleZoneFields && (
                  <div className="mt-2 text-xs t-dim font-mono">
                    zone fields: {r.sampleZoneFields.join(", ")}
                  </div>
                )}
                <div className="mt-2 text-xs t-dim font-mono">
                  keys: {r.keys.map((k) => `${k.key}${k.entries != null ? `(${k.entries})` : ""}`).join(" ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
