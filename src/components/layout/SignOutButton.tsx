"use client";

import { useTranslation } from "@/lib/i18n/I18nProvider";

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  const { t } = useTranslation();
  return (
    <form action={action}>
      <button type="submit" style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--text-dim)', padding: '6px 12px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: '.8rem' }}>
        {t("common.signOut")}
      </button>
    </form>
  );
}
