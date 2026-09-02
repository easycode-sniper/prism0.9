"use client";

// The last resort: an error thrown by the ROOT LAYOUT itself, which
// error.tsx cannot catch because error.tsx renders inside that layout.
//
// This one replaces the whole document, so it must supply its own <html>
// and <body> — and it cannot rely on globals.css, because the layout
// that imports it is the thing that failed. Every colour here is
// therefore a LITERAL rather than a token, and that is deliberate: this
// is the third documented exception to "all colour resolves through a
// token", alongside Leaflet's injected marker HTML and Chart.js's
// canvas. The values are copied from globals.css and must be kept in
// step by hand:
//
//   --bg #0e100f   --panel #191919   --line #42433d
//   --text #fffce1   --text-dim #95958a   --red #ff2d3f
//
// If this screen is ever reached, the app is comprehensively broken, so
// it does one job: show the message so somebody can act on it.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      {/* This component REPLACES the document, so the root layout's head
          never renders and its notranslate meta goes with it. Repeat it
          here: a translated error page is how the 2026-09-02 outage
          disguised itself in the first place. */}
      <head>
        <meta name="google" content="notranslate" />
      </head>
      {/* Same reasoning as the root layout: never let a machine
          translator touch this page. It is the one screen whose exact
          wording someone will be reading back over a phone. */}
      <body
        translate="no"
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#0e100f",
          color: "#fffce1",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 620, width: "100%" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Prism could not start</h1>
          <p style={{ marginTop: 8, fontSize: ".875rem", color: "#95958a", lineHeight: 1.5 }}>
            The application failed before any page could load. Nothing was saved
            or changed.
          </p>

          <div
            style={{
              marginTop: 20,
              padding: 12,
              borderRadius: 8,
              border: "1px solid #42433d",
              background: "#191919",
            }}
          >
            <div
              style={{
                fontSize: ".7rem",
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "#ff2d3f",
              }}
            >
              Error
            </div>
            <p
              style={{
                marginTop: 4,
                marginBottom: 0,
                fontSize: ".875rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                wordBreak: "break-word",
              }}
            >
              {error.message || "No message was attached to this error."}
            </p>
            {error.digest && (
              <p
                style={{
                  marginTop: 8,
                  marginBottom: 0,
                  fontSize: ".75rem",
                  color: "#95958a",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                digest {error.digest}
              </p>
            )}
          </div>

          {/* Outlined, 100px radius — the .btn-primary shape, rebuilt
              inline because the stylesheet is not available here. */}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "9px 20px",
              borderRadius: 100,
              border: "1px solid #fffce1",
              background: "transparent",
              color: "#fffce1",
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
