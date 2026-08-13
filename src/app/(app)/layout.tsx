import { getCurrentProfile } from "@/lib/supabase/auth";
import { Topbar } from "@/components/layout/Topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  return (
    <div className="flex min-h-screen flex-col">
      <Topbar profile={profile} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
