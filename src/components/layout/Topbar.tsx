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
    <header id="topbar" className="glass topbar">
      <TopbarNav isAdmin={profile?.role === "admin"} />

      <div id="topbar-stats">
        <FleetActiveCount />
        <LanguageSwitcher />
        <SignOutButton action={handleSignOut} />
      </div>
    </header>
  );
}
