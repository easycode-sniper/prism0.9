"use client";

import { useTranslation } from "@/lib/i18n/I18nProvider";
import { clearAllCaches } from "@/lib/dashboard/cache";

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  const { t } = useTranslation();
  return (
    // Signing out empties whatever the app is holding in memory. The
    // dashboard keeps its last answers in a module-level cache so that
    // returning to it is instant; that cache outlives a sign-out, because
    // the redirect is a client-side navigation and the module is never
    // unloaded. Nothing in it is private today — every signed-in user
    // reads the same fleet-wide rows — but the session ending is the
    // right moment to drop it, and doing it here means it stays right if
    // that ever stops being true.
    <form action={action} onSubmit={() => clearAllCaches()}>
      <button type="submit" style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--text-dim)', padding: '6px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '.8rem' }}>
        {t("common.signOut")}
      </button>
    </form>
  );
}
