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
          href="#"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">User Management</h3>
          <p className="mt-1 text-sm text-gray-400">
            Invite, disable, and manage user accounts and roles.
          </p>
        </Link>

        <Link
          href="#"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">Fleet Trucks</h3>
          <p className="mt-1 text-sm text-gray-400">
            Add and manage trucks in the fleet registry.
          </p>
        </Link>

        <Link
          href="#"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">Construction Sites</h3>
          <p className="mt-1 text-sm text-gray-400">
            Manage destinations and site coordinates.
          </p>
        </Link>

        <Link
          href="#"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">Geofences</h3>
          <p className="mt-1 text-sm text-gray-400">
            Upload and manage geofence zones.
          </p>
        </Link>

        <Link
          href="#"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">Wialon Settings</h3>
          <p className="mt-1 text-sm text-gray-400">
            Configure Wialon relay and connection.
          </p>
        </Link>

        <Link
          href="#"
          className="rounded-lg border border-gray-800 bg-gray-900 p-5 transition hover:border-indigo-600 hover:bg-gray-800"
        >
          <h3 className="text-base font-medium text-white">Import KML</h3>
          <p className="mt-1 text-sm text-gray-400">
            Bulk import geofence zones from Wialon KML exports.
          </p>
        </Link>
      </div>

      <p className="mt-8 text-center text-sm text-gray-500">
        More admin features coming soon.
      </p>
    </div>
  );
}
