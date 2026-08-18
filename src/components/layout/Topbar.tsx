import { getCurrentProfile } from "@/lib/supabase/auth";
import { signOut } from "@/lib/supabase/actions";
import { TopbarNav, LanguageSwitcher, ThemeToggle, FleetActiveCount } from "./TopbarNav";
import { SignOutButton } from "./SignOutButton";

export async function Topbar({ profile }: { profile: Awaited<ReturnType<typeof getCurrentProfile>> }) {
  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <header id="topbar" className="glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 20px', margin: '14px 16px 0', zIndex: 2500 }}>
      <TopbarNav isAdmin={profile?.role === "admin"} />

      <div id="topbar-stats" style={{ display: 'flex', alignItems: 'center', gap: '14px', fontFamily: 'var(--font-mono)', fontSize: '.8rem', color: 'var(--text-dim)' }}>
        <FleetActiveCount />
        <LanguageSwitcher />
        <ThemeToggle />
        <SignOutButton action={handleSignOut} />
      </div>
    </header>
  );
}
