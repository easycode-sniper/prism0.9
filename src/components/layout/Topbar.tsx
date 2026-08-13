import { getCurrentProfile } from "@/lib/supabase/auth";
import { signOut } from "@/lib/supabase/actions";
import Link from "next/link";

export async function Topbar({ profile }: { profile: Awaited<ReturnType<typeof getCurrentProfile>> }) {
  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
      <div className="flex items-center gap-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
          P
        </div>
        <span className="text-sm font-semibold text-white">Prism</span>

        {/* Navigation */}
        <nav className="ml-6 flex gap-1">
          <Link
            href="/dashboard"
            className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-white"
          >
            Dashboard
          </Link>

          {profile?.role === "admin" && (
            <Link
              href="/admin"
              className="rounded-md px-3 py-1.5 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-white"
            >
              Admin
            </Link>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {profile && (
          <span className="text-sm text-gray-400">
            {profile.full_name || profile.email}
            {profile.role === "admin" && (
              <span className="ml-2 rounded bg-indigo-900 px-1.5 py-0.5 text-xs text-indigo-300">
                admin
              </span>
            )}
          </span>
        )}
        <form action={handleSignOut}>
          <button
            type="submit"
            className="rounded-md border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition hover:bg-gray-800"
          >
            Sign Out
          </button>
        </form>
      </div>
    </header>
  );
}
