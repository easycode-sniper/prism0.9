"use client";

import { useState, useEffect } from "react";
import { adminGetSettings, adminSaveSettings } from "@/lib/supabase/admin-actions";
import type { AppSettings } from "@/lib/supabase/admin-actions";

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [relay, setRelay] = useState("");
  const [server, setServer] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const result = await adminGetSettings();
    if (result.data) {
      setSettings(result.data);
      setRelay(result.data.wialon_relay);
      setServer(result.data.wialon_server);
      setToken(result.data.wialon_token_set ? "••••••••••••" : "");
    }
    setError(result.error);
    setLoading(false);
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
      await loadSettings();
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm t-dim">Loading settings...</div>;
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
                className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-indigo-500 focus:outline-none"
                placeholder="https://your-relay.workers.dev" />
              <p className="mt-1 text-xs t-dim">Cloudflare Worker that bypasses CORS</p>
            </div>

            <div>
              <label htmlFor="server" className="block text-sm font-medium t-primary">
                Wialon Server
              </label>
              <input id="server" type="text" value={server}
                onChange={(e) => setServer(e.target.value)}
                className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-indigo-500 focus:outline-none"
                placeholder="hst-api.wialon.eu" />
            </div>

            <div>
              <label htmlFor="token" className="block text-sm font-medium t-primary">
                API Token
              </label>
              <input id="token" type="password" value={token}
                onChange={(e) => setToken(e.target.value)}
                className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-indigo-500 focus:outline-none"
                placeholder="Leave blank to keep existing" />
              <p className="mt-1 text-xs t-dim">
                {settings?.wialon_token_set ? "Token is set. Enter a new one to change." : "No token set."}
              </p>
            </div>
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50">
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </div>
  );
}
