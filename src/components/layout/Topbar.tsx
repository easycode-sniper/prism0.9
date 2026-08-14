import { getCurrentProfile } from "@/lib/supabase/auth";
import { signOut } from "@/lib/supabase/actions";
import Link from "next/link";

export async function Topbar({ profile }: { profile: Awaited<ReturnType<typeof getCurrentProfile>> }) {
  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <header className="flex h-14 items-center justify-between px-5" style={{ background: "linear-gradient(180deg, var(--panel) 0%, #0d0d18 100%)", borderBottom: "1px solid var(--line)" }}>
      <div className="flex items-center gap-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "linear-gradient(135deg, var(--indigo), var(--purple))" }}>
          <span className="text-sm font-bold text-white">P</span>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-white">Prism</span>
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>Fleet Operations</span>
        </div>

        <nav className="ml-6 flex gap-1 p-1 rounded-lg" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
          <Link href="/dashboard" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>Dashboard</Link>
          <Link href="/dispatch" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>Dispatch</Link>
          <Link href="/live-fleet" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>Live Fleet</Link>
          <Link href="/monitoring" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>Monitoring</Link>
          <Link href="/history" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>History</Link>
          <Link href="/notifications" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>Notifications</Link>
          {profile?.role === "admin" && (
            <Link href="/admin" className="px-4 py-1.5 text-sm font-medium rounded-md" style={{ color: "var(--text-dim)" }}>Admin</Link>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {profile && (
          <span className="text-sm" style={{ color: "var(--text-dim)" }}>
            {profile.full_name || profile.email}
            {profile.role === "admin" && (
              <span className="ml-2 rounded px-1.5 py-0.5 text-xs text-white" style={{ background: "linear-gradient(135deg, var(--indigo), var(--purple))" }}>
                admin
              </span>
            )}
          </span>
        )}
        <form action={handleSignOut}>
          <button type="submit" className="btn-secondary" style={{ padding: "6px 14px", fontSize: "0.8rem" }}>
            Sign Out
          </button>
        </form>
      </div>
    </header>
  );
}
