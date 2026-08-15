import { getCurrentProfile } from "@/lib/supabase/auth";
import { signOut } from "@/lib/supabase/actions";
import { TopbarNav, LanguageSwitcher, FleetActiveCount } from "./TopbarNav";
import { SignOutButton } from "./SignOutButton";

export async function Topbar({ profile }: { profile: Awaited<ReturnType<typeof getCurrentProfile>> }) {
  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <header id="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: 'linear-gradient(180deg, var(--panel) 0%, #0d0d18 100%)', borderBottom: '1px solid var(--line)', zIndex: 2500 }}>
      <TopbarNav isAdmin={profile?.role === "admin"} />

      <div id="topbar-stats" style={{ display: 'flex', alignItems: 'center', gap: '14px', fontFamily: 'var(--font-mono)', fontSize: '.8rem', color: 'var(--text-dim)' }}>
        <FleetActiveCount />
        <LanguageSwitcher />
        <SignOutButton action={handleSignOut} />
      </div>
    </header>
  );
}
