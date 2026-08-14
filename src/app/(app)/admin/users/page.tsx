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

  async function loadUsers() {
    setLoading(true);
    const result = await adminListUsers();
    setUsers(result.data);
    setError(result.error);
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

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

  async function handleRoleChange(userId: string, role: "operator" | "admin") {
    setError(null);
    const result = await adminSetUserRole(userId, role);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  async function handleDisable(userId: string) {
    setError(null);
    const result = await adminDisableUser(userId);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  async function handleEnable(userId: string) {
    setError(null);
    const result = await adminEnableUser(userId);
    if (result.error) { setError(result.error); return; }
    await loadUsers();
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading users...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold text-white">User Management</h1>
      <p className="mt-1 text-sm text-gray-400">Invite, enable, disable, and manage user roles.</p>

      {error && <div className="mt-4 rounded-md bg-red-900/50 p-3 text-sm text-red-300">{error}</div>}
      {success && <div className="mt-4 rounded-md bg-green-900/50 p-3 text-sm text-green-300">{success}</div>}

      {/* Invite Form */}
      <form onSubmit={handleInvite} className="mt-6 rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-medium text-white">Invite User</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="invite-email" className="block text-sm font-medium text-gray-300">Email</label>
            <input id="invite-email" type="email" required value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              placeholder="user@company.com" />
          </div>
          <div>
            <label htmlFor="invite-name" className="block text-sm font-medium text-gray-300">Full Name</label>
            <input id="invite-name" type="text" required value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none"
              placeholder="John Doe" />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-sm font-medium text-gray-300">Role</label>
            <select id="invite-role" value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "operator" | "admin")}
              className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-indigo-500 focus:outline-none">
              <option value="operator">Operator</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <button type="submit" disabled={inviting}
          className="mt-4 rounded-md bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50">
          {inviting ? "Sending..." : "Send Invite"}
        </button>
      </form>

      {/* User List */}
      <div className="mt-8 overflow-hidden rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900 text-left text-xs uppercase text-gray-500">
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Joined</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {users.map((u) => (
              <tr key={u.id} className="bg-gray-900/50">
                <td className="px-4 py-3">
                  <div className="text-white">{u.full_name || "—"}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <select value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as "operator" | "admin")}
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white focus:outline-none">
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  {u.role !== "admin" && (
                    <button onClick={() => handleDisable(u.id)}
                      className="text-xs text-red-400 hover:text-red-300">
                      Disable
                    </button>
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
