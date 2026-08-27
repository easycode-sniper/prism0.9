"use client";

import { useState, useEffect } from "react";
import {
  adminListUsers,
  adminInviteUser,
  adminSetUserRole,
  adminDisableUser,
  adminEnableUser,
  AdminUser,
} from "@/lib/supabase/admin-actions";
import { formatDate } from "@/lib/format";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"operator" | "admin">("operator");
  const [inviting, setInviting] = useState(false);

  // `silent` is the whole point of this parameter. loadUsers() used to
  // set loading on every call, and the component early-returns a
  // skeleton while loading — so changing ONE user's role blanked the
  // entire table for a round trip. The skeleton belongs to the first
  // load, when there is genuinely nothing to show; a refresh behind an
  // optimistic edit must leave the table on screen.
  async function loadUsers(silent = false) {
    if (!silent) setLoading(true);
    const result = await adminListUsers();
    setUsers(result.data);
    setError(result.error);
    if (!silent) setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  /** Patch one row now; the returned function puts it back if the write
   *  fails. Rows are matched by id, so a refresh landing in between
   *  cannot make the rollback restore the wrong user. */
  function patchUser(userId: string, patch: Partial<AdminUser>): () => void {
    let previous: AdminUser | undefined;
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        previous = u;
        return { ...u, ...patch };
      })
    );
    return () => {
      if (!previous) return;
      setUsers((prev) => prev.map((u) => (u.id === userId ? previous! : u)));
    };
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setInviting(true);

    const result = await adminInviteUser(inviteEmail, inviteName, inviteRole);
    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(`Invited ${inviteEmail}`);
      setInviteEmail("");
      setInviteName("");
      await loadUsers();
    }
    setInviting(false);
  }

  // The select is controlled on server state, so without the local patch
  // it snapped back to the old role the moment React re-rendered and
  // only committed when the refetch landed.
  async function handleRoleChange(userId: string, role: "operator" | "admin") {
    setError(null);
    const rollback = patchUser(userId, { role });

    const result = await adminSetUserRole(userId, role);
    if (result.error) { rollback(); setError(result.error); return; }
    await loadUsers(true);
  }

  async function handleDisable(userId: string) {
    setError(null);
    const rollback = patchUser(userId, { disabled: true });

    const result = await adminDisableUser(userId);
    if (result.error) { rollback(); setError(result.error); return; }
    await loadUsers(true);
  }

  async function handleEnable(userId: string) {
    setError(null);
    const rollback = patchUser(userId, { disabled: false });

    const result = await adminEnableUser(userId);
    if (result.error) { rollback(); setError(result.error); return; }
    await loadUsers(true);
  }

  if (loading) {
    return (
      <div style={{ padding: "24px 28px" }}>
        <div className="skeleton skeleton--line" style={{ width: "150px", marginBottom: "18px" }} />
        <div className="skeleton-stack" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton skeleton--row" />
          ))}
        </div>
        <span className="sr-only" role="status">Loading users</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold t-primary">User Management</h1>
      <p className="mt-1 text-sm t-dim">Invite, enable, disable, and manage user roles.</p>

      {error && <div className="mt-4 rounded-md tint-red p-3 text-sm c-red">{error}</div>}
      {success && <div className="mt-4 rounded-md tint-green p-3 text-sm c-green">{success}</div>}

      {/* Invite Form */}
      <form onSubmit={handleInvite} className="mt-6 rounded-lg border bd bg-panel p-6">
        <h2 className="text-lg font-medium t-primary">Invite User</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-medium t-primary">Email</label>
            <input id="invite-email" type="email" required value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
              placeholder="user@company.com" />
          </div>
          <div>
            <label htmlFor="invite-name" className="block text-sm font-medium t-primary">Full Name</label>
            <input id="invite-name" type="text" required value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
              placeholder="John Doe" />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-sm font-medium t-primary">Role</label>
            <select id="invite-role" value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "operator" | "admin")}
              className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none">
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={inviting}
          className="btn-primary mt-4" style={{ width: "auto" }}>
          {inviting ? "Sending..." : "Send Invite"}
        </button>
      </form>

      {/* User List */}
      <div className="mt-8 overflow-hidden rounded-lg border bd">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bd bg-panel text-left text-xs uppercase t-dim">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-token">
            {users.map((u) => (
              <tr key={u.id} className="bg-panel/50">
                <td className="px-4 py-3">
                  <div className="t-primary" style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <span style={{ opacity: u.disabled ? 0.55 : 1 }}>{u.full_name || "—"}</span>
                    {/* Amber, not red: a disabled account is a stale
                        state, not an alert — the same reading amber
                        carries for an idle truck. */}
                    {u.disabled && (
                      <span
                        className="status-pill"
                        style={{ background: "rgba(255, 179, 0, 0.15)", color: "var(--amber)" }}
                      >
                        Disabled
                      </span>
                    )}
                  </div>
                  <div className="text-xs t-dim" style={{ opacity: u.disabled ? 0.55 : 1 }}>{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <select value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as "operator" | "admin")}
                    className="rounded border bd bg-raised px-2 py-1 text-xs t-primary focus:outline-none">
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3 t-dim text-xs">
                  {formatDate(u.created_at)}
                </td>
                <td className="px-4 py-3">
                  {/* Enable was written but never reachable: nothing
                      rendered it, because nothing knew an account could
                      be disabled. */}
                  {u.role !== "admin" && (
                    u.disabled ? (
                      <button onClick={() => handleEnable(u.id)}
                        className="text-xs c-green hover:opacity-80">
                        Enable
                      </button>
                    ) : (
                      <button onClick={() => handleDisable(u.id)}
                        className="text-xs c-red hover:opacity-80">
                        Disable
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
