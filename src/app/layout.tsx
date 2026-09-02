import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Prism — Fleet Operations",
  description: "Fleet route verification and monitoring",
  // ── Do not let the browser machine-translate this app ──────
  //
  // 2026-09-02: an operator opened the app in Chrome with a French
  // locale, got past /login, and every page after it died with
  // "Application error: a client-side exception has occurred" — which
  // he read IN FRENCH. Next ships that sentence in English only (there
  // is no localisation of it anywhere in the package), so the DOM had
  // been rewritten by Chrome's translator before the message was even
  // shown. The same account in Firefox, which does not auto-translate,
  // was fine.
  //
  // Chrome's translator does not edit text in place: it REPLACES each
  // text node with nested <font> wrappers and hoists inline siblings
  // into them. React still holds references to the nodes it created, so
  // its next update calls removeChild/insertBefore against a node that
  // has moved and the browser throws NotFoundError. This app is
  // unusually exposed — 30-odd bare conditional text nodes of the form
  // {loading ? "Running…" : "Execute"}, on pages that re-render on a
  // poll. /login survived precisely because its only two ternaries are
  // ATTRIBUTES (type, aria-label) and it barely re-renders.
  //
  // Blocking translation is right on its own merits regardless of the
  // crash. This is a dispatch board: truck ids, plate numbers, tonnages
  // and the status words the colour taxonomy is keyed to are DATA, and
  // a browser silently rewriting "IDLE" or reformatting 23 305,1 is
  // wrong even on a page that stays up. Operators who want French have
  // the app's own switcher (lib/i18n) — that translates the chrome and
  // leaves the data alone, which is the distinction a machine
  // translator cannot make.
  other: { google: "notranslate" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`}>
      {/* translate="no" is inherited by every descendant, and is the
          per-element half of the meta tag above: the meta stops Chrome
          OFFERING, this stops a translation started some other way
          (the right-click menu, an extension) from touching the DOM. */}
      <body className="min-h-screen bg-background text-foreground antialiased" translate="no">
        {children}
      </body>
    </html>
  );
}
