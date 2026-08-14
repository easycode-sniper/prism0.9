import Link from "next/link";

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold text-white">Admin Panel</h1>
      <p className="mt-2 text-sm text-gray-400">
        Manage users, roles, and application settings.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/admin/users"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">User Management</h3>
          <p className="mt-1 text-sm text-gray-400">
            Invite, disable, and manage user accounts and roles.
          </p>
        </Link>

        <Link
          href="/admin/settings"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">Wialon Settings</h3>
          <p className="mt-1 text-sm text-gray-400">
            Configure Wialon relay, server, and API token.
          </p>
        </Link>
      </div>
    </div>
  );
}
