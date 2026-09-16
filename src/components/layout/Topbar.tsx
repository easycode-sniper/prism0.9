import { getCurrentProfile } from "@/lib/supabase/auth";
import { signOut } from "@/lib/supabase/actions";
import { TopbarNav, FleetActiveCount } from "./TopbarNav";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ProfileMenu } from "./ProfileMenu";

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
        <ProfileMenu name={profile?.full_name ?? ""} email={profile?.email ?? ""} action={handleSignOut} />
      </div>
    </header>
  );
}
