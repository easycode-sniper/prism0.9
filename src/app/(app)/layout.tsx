import { getCurrentProfile } from "@/lib/supabase/auth";
import { Topbar } from "@/components/layout/Topbar";
import { FleetProvider } from "@/components/providers/FleetProvider";
import { NotificationSoundListener } from "@/components/providers/NotificationSoundListener";
import { OperationsStrip } from "@/components/layout/OperationsStrip";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  return (
    <ThemeProvider>
    <I18nProvider>
    <FleetProvider>
      <NotificationSoundListener />
      <div className="aurora" aria-hidden="true">
        <span style={{ width: '700px', height: '480px', left: '-80px', top: '-180px', background: 'var(--aurora-a)', opacity: 'var(--aurora-a-opacity)' }} />
        <span style={{ width: '520px', height: '420px', right: '-60px', top: '-120px', background: 'var(--aurora-b)', opacity: 'var(--aurora-b-opacity)' }} />
      </div>
      <div id="app-shell" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
        <Topbar profile={profile} />
        <OperationsStrip />
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>{children}</main>
      </div>
    </FleetProvider>
    </I18nProvider>
    </ThemeProvider>
  );
}
