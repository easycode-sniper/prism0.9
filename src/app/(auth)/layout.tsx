// The sign-in screen needs the language too.
//
// I18nProvider was mounted only in (app)/layout.tsx, so /login rendered
// with no provider at all and every string on it was English whatever the
// operator had chosen. It cannot read the preference from the database —
// that is per-user and nobody is signed in yet — but the provider now
// keeps a copy in localStorage, so it can render in the language this
// browser last used. A browser that has never chosen one gets English,
// which is the only sensible default when there is nothing to go on.
import { I18nProvider } from "@/lib/i18n/I18nProvider";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}
