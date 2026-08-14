import { getCurrentProfile } from "@/lib/supabase/auth";
import { Topbar } from "@/components/layout/Topbar";
import { FleetProvider } from "@/components/providers/FleetProvider";
import { NotificationSoundListener } from "@/components/providers/NotificationSoundListener";
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  return (
    <I18nProvider>
    <FleetProvider>
      <NotificationSoundListener />
      <div id="app-shell" style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw' }}>
        <Topbar profile={profile} />
        <div id="operations-strip" aria-label="Operational status" style={{ display: 'flex', alignItems: 'center', gap: '18px', minHeight: '36px', padding: '7px 20px', background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '.72rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span className="ops-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#657077', boxShadow: '0 0 0 3px rgba(101,112,119,.12)' }}></span>
            <span>Live tracking paused</span>
          </div>
          <span style={{ width: '1px', height: '16px', background: 'var(--line)' }}></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            Active runs <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>0</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            Off route <strong style={{ color: '#d92d42', fontSize: '.78rem' }}>0</strong>
          </div>
          <span style={{ width: '1px', height: '16px', background: 'var(--line)' }}></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            Last update <strong style={{ color: 'var(--text)', fontSize: '.78rem' }}>Not yet synced</strong>
          </div>
        </div>
        <main style={{ flex: 1, position: 'relative', overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>{children}</main>
      </div>
    </FleetProvider>
    </I18nProvider>
  );
}
