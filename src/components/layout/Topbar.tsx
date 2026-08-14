import { getCurrentProfile } from "@/lib/supabase/auth";
import { signOut } from "@/lib/supabase/actions";
import Link from "next/link";

export async function Topbar({ profile }: { profile: Awaited<ReturnType<typeof getCurrentProfile>> }) {
  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <header id="topbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: 'linear-gradient(180deg, var(--panel) 0%, #0d0d18 100%)', borderBottom: '1px solid var(--line)', zIndex: 2500 }}>
      <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div className="brand-mark" style={{ width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', background: 'linear-gradient(135deg, var(--indigo), var(--purple))' }}>
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>P</span>
        </div>
        <div>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', fontWeight: 600, letterSpacing: '.02em' }}>Fleet Route Monitor</h1>
          <span style={{ display: 'block', fontSize: '.65rem', color: 'var(--text-dim)', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: '1px' }}>OMD Transport · Amouda Line</span>
        </div>
      </div>

      <nav id="tabs" style={{ display: 'flex', gap: '6px', background: 'var(--panel-2)', padding: '4px', borderRadius: '10px', border: '1px solid var(--line)' }}>
        <Link href="/dashboard" className="tab-btn" data-active="true" style={tabStyle(true)}>🏠 Dashboard</Link>
        <Link href="/dispatch" className="tab-btn" style={tabStyle(false)}>🗺️ Dispatch</Link>
        <Link href="/monitoring" className="tab-btn" style={tabStyle(false)}>🔎 Monitoring</Link>
        <Link href="/live-fleet" className="tab-btn" style={tabStyle(false)}>📡 Live Fleet</Link>
        <Link href="/history" className="tab-btn" style={tabStyle(false)}>📜 History</Link>
        <Link href="/notifications" className="tab-btn" style={tabStyle(false)}>🔔 Notifications</Link>
        {profile?.role === "admin" && (
          <Link href="/admin" className="tab-btn" style={tabStyle(false)}>⚙️ Admin</Link>
        )}
      </nav>

      <div id="topbar-stats" style={{ display: 'flex', alignItems: 'center', gap: '14px', fontFamily: 'var(--font-mono)', fontSize: '.8rem', color: 'var(--text-dim)' }}>
        <span>Active: <strong style={{ color: 'var(--amber)' }}>0</strong> / <span>84</span></span>
        <form action={handleSignOut}>
          <button type="submit" style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--text-dim)', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '.8rem' }}>Sign Out</button>
        </form>
      </div>
    </header>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'linear-gradient(135deg, var(--indigo), var(--purple))' : 'transparent',
    border: 'none',
    color: active ? '#fff' : 'var(--text-dim)',
    fontFamily: 'var(--font-sans)',
    fontSize: '.85rem',
    fontWeight: 600,
    padding: '8px 16px',
    borderRadius: '7px',
    cursor: 'pointer',
    transition: '.15s',
    textDecoration: 'none',
    boxShadow: active ? '0 2px 10px rgba(109,91,255,.35)' : 'none',
    display: 'inline-block',
  };
}
