"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  adminListUsers,
  adminCreateUser,
  adminSetUserRole,
  adminDisableUser,
  adminEnableUser,
  AdminUser,
} from "@/lib/supabase/admin-actions";
import { formatDate } from "@/lib/format";
import { MIN_PASSWORD_LENGTH } from "@/lib/constants";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New-account form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"operator" | "admin">("operator");
  const [invitePassword, setInvitePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Checked before the round trip so the admin is not made to wait to
    // be told the length. The action checks it again — see there for why
    // this one is not the guard.
    if (invitePassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setInviting(true);

    const email = inviteEmail.trim();
    const result = await adminCreateUser(email, inviteName, inviteRole, invitePassword);
    if (result.error) {
      // The password is deliberately NOT cleared on failure: a rejected
      // email or a duplicate address should not cost the admin the
      // password they had already typed.
      setError(result.error);
    } else {
      // Names the person and the role, because those are the two things
      // worth checking before handing the password over. The password
      // itself is not echoed — it is on screen in the field until this
      // clears it, and repeating it into a success banner only widens
      // where it can be read from.
      setSuccess(`Created ${email} as ${inviteRole}. Give them the password you set — there is no reset email.`);
      setInviteEmail("");
      setInviteName("");
      setInvitePassword("");
      setShowPassword(false);
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
      <p className="mt-1 text-sm t-dim">Create accounts, set passwords, enable, disable, and manage user roles.</p>

      {error && <div className="mt-4 rounded-md tint-red p-3 text-sm c-red">{error}</div>}
      {success && <div className="mt-4 rounded-md tint-green p-3 text-sm c-green">{success}</div>}

      {/* New-account form.

          Called "Create User" and not "Invite User" because nothing is
          sent: the account is created confirmed and enabled, with the
          password typed below, and the admin passes it on themselves.
          The old heading promised an email that never existed. */}
      <form onSubmit={handleCreate} className="mt-6 rounded-lg border bd bg-panel p-6">
        <h2 className="text-lg font-medium t-primary">Create User</h2>
        {/* Two columns rather than three. The password field has to sit
            beside the email at a readable width, and four fields across
            a max-w-4xl card leaves every one of them too narrow to see
            an address in. */}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-medium t-primary">Email</label>
            <input id="invite-email" type="email" required value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
              placeholder="user@company.com" />
          </div>
          <div>
            <label htmlFor="invite-name" className="block text-sm font-medium t-primary">Full Name</label>
            <input id="invite-name" type="text" required value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              autoComplete="off"
              className="mt-1 block w-full rounded-md border bd bg-raised px-3 py-2 t-primary focus:border-[var(--accent)] focus:outline-none"
              placeholder="John Doe" />
          </div>
          <div>
            <label htmlFor="invite-password" className="block text-sm font-medium t-primary">Password</label>
            {/* .signin-password and .signin-reveal are the sign-in
                card's own rules and are reused verbatim: the first is
                only position:relative, the second an absolutely
                positioned icon button that is not scoped to that card.
                Same control, same behaviour, no second implementation
                of the eye to keep in step. */}
            <div className="signin-password mt-1">
              <input
                id="invite-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={invitePassword}
                onChange={(e) => setInvitePassword(e.target.value)}
                // new-password, not off: this tells a password manager
                // to OFFER to generate and store one, which is exactly
                // the right behaviour for an admin setting someone
                // else's credential, and stops the browser autofilling
                // the admin's OWN password into the field.
                autoComplete="new-password"
                aria-describedby="invite-password-hint"
                className="block w-full rounded-md border bd bg-raised px-3 py-2 pr-11 t-primary focus:border-[var(--accent)] focus:outline-none"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              />
              <button
                type="button"
                className="signin-reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} strokeWidth={2} /> : <Eye size={15} strokeWidth={2} />}
              </button>
            </div>
            <p id="invite-password-hint" className="mt-1 text-xs t-dim">
              You set this and tell the user — no email is sent.
            </p>
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
          {inviting ? "Creating…" : "Create user"}
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
