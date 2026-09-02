"use client";

// What the operator sees when a client-side exception escapes a page.
//
// WHY THIS FILE EXISTS. On 2026-09-02 an operator hit "Application
// error: a client-side exception has occurred (see the browser console
// for more information)" on every page past /login in Chrome. That is
// Next's DEFAULT boundary, which is what you get when an app ships no
// error.tsx — and it is a dead end: it names no error, no page and no
// cause, so the only way to learn anything was to walk someone through
// opening devtools on a phone call. Diagnosing it took a session.
//
// The same lesson as the dashboard's loading skeleton earlier that day:
// a failure state that carries no information is indistinguishable from
// every other failure, and the person in front of it cannot tell you
// what happened. Print what we know, on screen, where they are.
//
// error.message IS available here for client-side exceptions in a
// production build. (Next redacts the message for errors thrown while
// rendering SERVER components, replacing it with a digest — hence the
// digest being shown too, since for that class it is the only handle
// that ties this screen to a server log line.)

import { useEffect, useState } from "react";

/** Did the browser machine-translate this page before it broke?
 *
 *  Chrome stamps the <html> element with translated-ltr / translated-rtl
 *  while its translator is active, and replaces every text node with
 *  nested <font> wrappers. React still holds references to the nodes it
 *  created, so its next update targets a node that has been moved and
 *  the browser throws NotFoundError — a well-known collision, and the
 *  leading suspect for the 2026-09-02 outage.
 *
 *  Checked here rather than assumed because it turns the next report
 *  from "it crashed" into "it crashed AND the page was translated",
 *  which is the difference between a session of investigation and a
 *  glance. Both signals are read: the class is Chrome's own marker, the
 *  <font> tags are the damage itself, and either alone is enough.
 */
function wasTranslated(): boolean {
  if (typeof document === "undefined") return false;
  const html = document.documentElement;
  const marked = /(^|\s)translated-(ltr|rtl)(\s|$)/.test(html.className);
  const fonts = document.getElementsByTagName("font").length > 0;
  return marked || fonts;
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Read in an effect, not during render: this is a client boundary in
  // an app that server-renders, and touching document during render
  // would be a hydration mismatch — which is itself a way to throw from
  // the error page and lose the message entirely.
  const [translated, setTranslated] = useState(false);
  useEffect(() => setTranslated(wasTranslated()), []);

  useEffect(() => {
    // Next logs this too, but not with the page attached, and the page
    // is half the report.
    console.error(`[prism] client exception on ${window.location.pathname}`, error);
  }, [error]);

  return (
    <div style={{ padding: "48px 28px", maxWidth: 720, margin: "0 auto" }}>
      <h1 className="text-2xl font-semibold t-primary">This page stopped</h1>
      <p className="mt-2 text-sm t-dim">
        Something in the page threw an error, so it was unloaded rather than left
        showing figures that may be wrong. Nothing was saved or changed.
      </p>

      {/* The message itself, verbatim and monospaced — it is the thing
          worth screenshotting, so it must be selectable and legible. */}
      <div className="mt-5 rounded-md tint-red p-3">
        <div className="text-xs uppercase c-red" style={{ letterSpacing: ".06em" }}>
          Error
        </div>
        <p
          className="mt-1 text-sm t-primary"
          style={{ fontFamily: "var(--font-mono)", wordBreak: "break-word" }}
        >
          {error.message || "No message was attached to this error."}
        </p>
        {error.digest && (
          <p className="mt-2 text-xs t-dim" style={{ fontFamily: "var(--font-mono)" }}>
            digest {error.digest}
          </p>
        )}
      </div>

      {translated && (
        // Amber, not red: this is a diagnosis of a stale/mangled state,
        // not a second failure. Same reading amber carries for an idle
        // truck and a disabled account.
        <div
          className="mt-3 rounded-md p-3"
          style={{ background: "rgba(255, 179, 0, 0.12)", border: "1px solid var(--line)" }}
        >
          <div className="text-xs uppercase" style={{ color: "var(--amber)", letterSpacing: ".06em" }}>
            Your browser translated this page
          </div>
          <p className="mt-1 text-sm t-dim">
            That is the most likely cause. Machine translation rewrites the page
            underneath the app, which breaks it. Turn it off for this site —
            in Chrome, right-click the page → <strong className="t-primary">Translate to…</strong>{" "}
            → the three dots → <strong className="t-primary">Never translate this site</strong> —
            then reload. The app has its own language switcher in the top bar.
          </p>
        </div>
      )}

      <div className="mt-5" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" onClick={reset} className="btn-primary" style={{ width: "auto" }}>
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary"
          style={{ width: "auto" }}
        >
          Reload the page
        </button>
      </div>

      <p className="mt-5 text-xs t-faint">
        If it keeps happening, send a photo of this screen — the red box is
        everything needed to diagnose it.
      </p>
    </div>
  );
}
