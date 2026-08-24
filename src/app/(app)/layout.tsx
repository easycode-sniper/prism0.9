import { getCurrentProfile } from "@/lib/supabase/auth";
import { Topbar } from "@/components/layout/Topbar";
import { FleetProvider } from "@/components/providers/FleetProvider";
import { AlertToaster } from "@/components/providers/AlertToaster";
import { OperationsStrip } from "@/components/layout/OperationsStrip";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  return (
    <I18nProvider>
    <FleetProvider>
      {/* Sound + on-screen toast for any alert, on any page. Replaces
          NotificationSoundListener, which subscribed to the same stream —
          keeping both would play every tone twice. */}
      <AlertToaster />
      <div id="app-shell" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
        <Topbar profile={profile} />
        <OperationsStrip />
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>{children}</main>
      </div>
    </FleetProvider>
    </I18nProvider>
  );
}
