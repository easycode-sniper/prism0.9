"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import { clearAllCaches } from "@/lib/dashboard/cache";

/** Two letters from the name, falling back to the email's first letter
 *  when there is no name to draw from. Arabic full names work too — the
 *  first letter of each word is a letter there just like anywhere. */
function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 1) {
    const fromName = words
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("");
    if (fromName) return fromName;
  }
  return (email.split("@")[0]?.[0] ?? "?").toUpperCase();
}

/**
 * The operator's identity in the top-right corner: a circular initials
 * avatar that opens a small menu — name, email, sign out. Replaces the
 * bare "Sign Out" button; the sign-out itself is the same server action
 * the old button called, so nothing downstream changes.
 *
 * Signing out empties whatever the app is holding in memory. The
 * dashboard keeps its last answers in a module-level cache so that
 * returning to it is instant; that cache outlives a sign-out, because
 * the redirect is a client-side navigation and the module is never
 * unloaded. Nothing in it is private today — every signed-in user reads
 * the same fleet-wide rows — but the session ending is the right moment
 * to drop it, and doing it here means it stays right if that ever stops
 * being true.
 */
export function ProfileMenu({
  name,
  email,
  action,
}: {
  name: string;
  email: string;
  action: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. Arbitration inside the wrapper
  // handles the toggle button itself: its pointerdown lands within the
  // wrapper, so the button's own onClick stays the only vote.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={wrapRef}>
      <button
        type="button"
        className="profile-avatar"
        aria-label={t("common.account")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initialsOf(name, email)}
      </button>
      {open && (
        <div className="dropdown profile-menu__drop" role="menu" aria-label={t("common.account")}>
          <div className="profile-menu__id">
            <span className="profile-menu__name">{name || "—"}</span>
            {email && <span className="profile-menu__email">{email}</span>}
          </div>
          <div className="profile-menu__sep" />
          <form action={action} onSubmit={() => clearAllCaches()}>
            <button type="submit" role="menuitem" className="profile-menu__item">
              <LogOut size={14} strokeWidth={2} />
              {t("common.signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}